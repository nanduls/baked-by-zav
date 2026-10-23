// End-to-end check of the Cloudflare version without Cloudflare: runs worker/index.js in Node
// with an in-memory KV and a static ASSETS binding, then drives it with headless Chromium.
// Run `python3 build.py` first. Needs Playwright (PLAYWRIGHT_PATH can point at it).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import worker from "../worker/index.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const PUB = path.resolve("public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };

const store = new Map();
const env = {
  ADMIN_PASSWORD: "test-pass",
  ZAV: {
    async get(k, type) { const v = store.get(k); if (!v) return null; return type === "json" ? JSON.parse(v.value) : v.value; },
    async getWithMetadata(k) { const v = store.get(k); return v ? { value: v.value, metadata: v.metadata } : { value: null, metadata: null }; },
    async put(k, value, opts) { store.set(k, { value, metadata: opts && opts.metadata }); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  },
  ASSETS: {
    async fetch(req) {
      let p = new URL(req.url).pathname;
      if (p === "/orders") p = "/orders.html";
      if (p === "/") p = "/index.html";
      const f = path.join(PUB, p);
      if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response("nf", { status: 404 });
      return new Response(fs.readFileSync(f), { headers: { "content-type": TYPES[path.extname(f)] || "application/octet-stream" } });
    },
  },
};
const server = http.createServer(async (rq, rs) => {
  const chunks = []; for await (const c of rq) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request("http://localhost:8799" + rq.url, { method: rq.method, headers: rq.headers, body: ["GET", "HEAD"].includes(rq.method) ? undefined : body }), env);
  const hs = {}; r.headers.forEach((v, k) => (hs[k] = v));
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : []; if (sc.length) hs["set-cookie"] = sc;
  rs.writeHead(r.status, hs); rs.end(Buffer.from(await r.arrayBuffer()));
}).listen(8799);

const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

try {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await b.newContext({ viewport: { width: 400, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  // visitor
  await p.goto("http://localhost:8799/");
  await p.waitForSelector(".item");
  ok((await p.locator(".item").count()) > 5, "public shop shows the menu");
  ok(await p.locator("#nav-admin").isHidden(), "visitor has no Admin link");
  ok((await (await ctx.request.get("http://localhost:8799/api/orders")).status()) === 401, "orders API refuses visitors");
  ok((await (await ctx.request.put("http://localhost:8799/api/site", { data: "{}" })).status()) === 401, "site save refuses visitors");

  // orders page redirects to login
  await p.goto("http://localhost:8799/orders");
  await p.waitForURL(/login\.html/);
  ok(true, "orders page sends visitors to sign in");
  await p.fill("#pw", "wrong"); await p.click("#go");
  await p.waitForSelector("#err:not([hidden])");
  ok(true, "wrong password is refused");
  await p.fill("#pw", "test-pass"); await p.click("#go");
  await p.waitForURL(/\/orders/);
  await p.waitForSelector("#app:not([hidden])");
  ok(true, "signed in and orders page opens");

  // add an order
  await p.click("#open-add");
  await p.fill("#paste", "Hello Zav, I'd like to order:\n\n2 × Butter Croissant (Rp 64.000)\n   Note: warm\n\nTotal: Rp 64.000\n\nName: Rina\nPick-up date: Friday, 23 October 2026\n\nPayment: QRIS");
  await p.click("#read"); await p.click("#save");
  await p.waitForSelector(".order");
  ok((await p.textContent(".o-name")) === "Rina", "order saved and listed");
  await p.selectOption(".order select", "paid");
  await p.waitForFunction(() => document.querySelector(".order").dataset.s === "paid");
  ok(true, "status change persists");
  await p.reload(); await p.waitForSelector(".order");
  ok((await p.locator(".order").count()) === 1 && (await p.locator(".order").getAttribute("data-s")) === "paid", "order survives reload");
  await p.click('.tab[data-v="report"]');
  ok((await p.locator(".tile .v").first().textContent()) === "Rp 64.000", "report shows revenue");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#dl-csv")]);
  ok(dl.suggestedFilename().endsWith(".csv"), "CSV downloads");
  const [dl2] = await Promise.all([p.waitForEvent("download"), p.click("#dl-pdf")]);
  ok(dl2.suggestedFilename().endsWith(".pdf"), "PDF report downloads");

  // shop admin
  await p.goto("http://localhost:8799/#admin");
  await p.waitForSelector("#admin:not([hidden])");
  ok(true, "shop admin opens when signed in");
  await p.fill("#f-i2-name", "Seeded Rye Loaf");
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.locator('#adm-menu .adm-item >> nth=0 >> .empty').click()]);
  await fc.setFiles({ name: "a.png", mimeType: "image/png", buffer: png });
  await p.waitForFunction(() => document.querySelectorAll("#adm-menu .adm-item")[0].querySelectorAll(".adm-slot .thumb").length === 1);
  ok(true, "photo uploads");
  await p.click("#save");
  await p.waitForFunction(() => /Saved/.test(document.getElementById("adm-status").textContent));
  const saved = await (await ctx.request.get("http://localhost:8799/site.json")).json();
  ok(saved.menu[1].name === "Seeded Rye Loaf", "menu edit saved");
  const id = saved.menu[0].photos[0];
  const img = await ctx.request.get("http://localhost:8799/_blob/" + id);
  ok(img.status() === 200 && /^image\//.test(img.headers()["content-type"]), "uploaded photo is served");

  // visitor in a fresh context sees the saved menu and photo
  const v = await b.newPage({ viewport: { width: 400, height: 900 } });
  await v.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await v.goto("http://localhost:8799/");
  await v.waitForSelector(".item h4");
  ok((await v.locator(".item h4", { hasText: "Seeded Rye Loaf" }).count()) === 1, "visitors see the saved menu");
  ok((await v.locator(".item img").count()) >= 1, "visitors see the photo");

  console.log("page errors:", errs.length ? errs : "none");
  await b.close();
} finally { server.close(); }
