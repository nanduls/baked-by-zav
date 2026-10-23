// Cloudflare Worker: static site + a small owner API.
// Bindings: ZAV (KV namespace), ASSETS (static files in public/), ADMIN_PASSWORD (secret).

const enc = new TextEncoder();
const SESSION_DAYS = 30;
const MAX_IMAGE = 6 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, headers || {}),
  });
}
const fail = (status, code, message) => json({ error: { code, message } }, status);

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function cookie(req, name) {
  const m = (req.headers.get("cookie") || "").split(/;\s*/).map((c) => c.split("=")).find((p) => p[0] === name);
  return m ? m.slice(1).join("=") : "";
}
async function sessionToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return exp + "." + (await hmac(env.ADMIN_PASSWORD + "|zav-session", String(exp)));
}
async function isAdmin(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const t = cookie(req, "zav_session"), i = t.indexOf(".");
  if (i < 1) return false;
  const exp = Number(t.slice(0, i));
  if (!exp || exp < Date.now() / 1000) return false;
  return same(t.slice(i + 1), await hmac(env.ADMIN_PASSWORD + "|zav-session", String(exp)));
}
function sniff(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return "";
}
function cleanSite(d) {
  if (!d || typeof d !== "object" || !d.info || typeof d.info !== "object" || !Array.isArray(d.menu)) return null;
  if (d.menu.length > 300) return null;
  return { info: d.info, menu: d.menu };
}

async function listOrders(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.ZAV.list({ prefix: "order:", cursor });
    const docs = await Promise.all(page.keys.map((k) => env.ZAV.get(k.name, "json").then((v) => (v ? Object.assign({ id: k.name.slice(6) }, v) : null))));
    docs.forEach((d) => d && out.push(d));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // ---- public ----
    if (path === "/site.json" && method === "GET") {
      const saved = await env.ZAV.get("site");
      if (saved) return new Response(saved, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" } });
      const r = await env.ASSETS.fetch(new Request(url.origin + "/site.default.json"));
      return new Response(r.body, { status: r.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" } });
    }
    if (path.startsWith("/_blob/") && method === "GET") {
      const id = path.slice(7);
      if (!/^[0-9a-f]{32}$/.test(id)) return new Response("Not found", { status: 404 });
      const { value, metadata } = await env.ZAV.getWithMetadata("img:" + id, "arrayBuffer");
      if (value) return new Response(value, { headers: { "content-type": (metadata && metadata.type) || sniff(value) || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
      const r = await env.ASSETS.fetch(new Request(url.origin + "/_blob/" + id));
      if (!r.ok) return new Response("Not found", { status: 404 });
      const buf = await r.arrayBuffer();
      return new Response(buf, { headers: { "content-type": sniff(buf) || "image/jpeg", "cache-control": "public, max-age=86400" } });
    }
    if (path === "/api/me" && method === "GET") return json({ admin: await isAdmin(req, env) });
    if (path === "/api/login" && method === "POST") {
      if (!env.ADMIN_PASSWORD) return fail(503, "not_configured", "ADMIN_PASSWORD is not set on this Worker.");
      let body = {};
      try { body = await req.json(); } catch (e) {}
      const given = await hmac("cmp", String((body && body.password) || ""));
      if (!same(given, await hmac("cmp", env.ADMIN_PASSWORD))) {
        await new Promise((r) => setTimeout(r, 600));
        return fail(401, "bad_password", "That password is not right.");
      }
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return json({ admin: true }, 200, { "set-cookie": "zav_session=" + (await sessionToken(env)) + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + SESSION_DAYS * 86400 + secure });
    }
    if (path === "/api/logout" && method === "POST") {
      return json({ admin: false }, 200, { "set-cookie": "zav_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" });
    }

    // ---- owner only ----
    if (path.startsWith("/api/")) {
      if (!(await isAdmin(req, env))) return fail(401, "not_writer", "Sign in first.");
      if (method !== "GET" && req.headers.get("x-zav") !== "1") return fail(403, "bad_request", "Missing request header.");

      if (path === "/api/site" && method === "PUT") {
        const text = await req.text();
        if (text.length > 400000) return fail(413, "too_large", "Site data is too large.");
        let d = null;
        try { d = cleanSite(JSON.parse(text)); } catch (e) {}
        if (!d) return fail(400, "invalid_content", "Site data is not valid.");
        await env.ZAV.put("site", JSON.stringify(d));
        return json({ ok: true });
      }
      if (path === "/api/upload" && method === "POST") {
        const buf = await req.arrayBuffer();
        if (buf.byteLength > MAX_IMAGE) return fail(413, "too_large", "Pictures can be up to 6 MB.");
        const type = sniff(buf) || (IMAGE_TYPES.indexOf(req.headers.get("content-type")) >= 0 ? req.headers.get("content-type") : "");
        if (!IMAGE_TYPES.includes(type)) return fail(400, "decode", "That is not a picture this site can store.");
        const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
        await env.ZAV.put("img:" + id, buf, { metadata: { type } });
        return json({ id, url: "/_blob/" + id, sizeBytes: buf.byteLength, contentType: type });
      }
      let m = /^\/api\/upload\/([0-9a-f]{32})$/.exec(path);
      if (m && method === "DELETE") { await env.ZAV.delete("img:" + m[1]); return json({ ok: true }); }

      if (path === "/api/orders" && method === "GET") return json(await listOrders(env));
      m = /^\/api\/orders\/([A-Za-z0-9_-]{1,64})$/.exec(path);
      if (m && method === "PUT") {
        const text = await req.text();
        if (text.length > 100000) return fail(413, "too_large", "Order is too large.");
        let d = null;
        try { d = JSON.parse(text); } catch (e) {}
        if (!d || typeof d !== "object" || Array.isArray(d)) return fail(400, "invalid_content", "Order is not valid.");
        delete d.id;
        await env.ZAV.put("order:" + m[1], JSON.stringify(d));
        return json({ ok: true });
      }
      if (m && method === "DELETE") { await env.ZAV.delete("order:" + m[1]); return json({ ok: true }); }
      return fail(404, "not_found", "No such route.");
    }

    return env.ASSETS.fetch(req);
  },
};
