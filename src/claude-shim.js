/* Stands in for the Claude Artifact runtime (window.claude) on a normal website.
   The shop and orders pages were written against that runtime; this maps the same
   calls onto the Worker API (worker/index.js). Visitors who are not signed in get null
   for every capability, exactly like a viewer without edit rights. */
(function () {
  function call(method, url, body, type) {
    var opts = { method: method, credentials: "same-origin", headers: { "x-zav": "1" } };
    if (body !== undefined) { opts.body = body; if (type) opts.headers["content-type"] = type; }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.ok) return d;
        var e = (d && d.error) || {};
        throw { code: r.status === 401 ? "not_writer" : r.status === 413 ? "too_large" : e.code || "upstream_error", message: e.message || "Request failed" };
      });
    });
  }

  var me = fetch("/api/me", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : { admin: false }; })
    .catch(function () { return { admin: false }; });

  var assets = {
    upload: function (blob, opts) { return call("POST", "/api/upload", blob, (opts && opts.type) || blob.type || "image/jpeg"); },
    delete: function (id) { return call("DELETE", "/api/upload/" + id); }
  };
  var artifact = {
    publish: function (files) {
      var site = files && files["site.json"];
      if (typeof site !== "string") return Promise.reject({ code: "invalid_content", message: "Nothing to save" });
      return call("PUT", "/api/site", site, "application/json");
    }
  };
  var user = { isOwner: function () { return Promise.resolve(true); }, canEdit: function () { return Promise.resolve(true); }, can: function () { return Promise.resolve(true); } };
  var downloads = {
    save: function (req) {
      var ext = (req.filename.split(".").pop() || "").toLowerCase();
      var type = ext === "pdf" ? "application/pdf" : ext === "csv" ? "text/csv;charset=utf-8" : "application/octet-stream";
      var url = URL.createObjectURL(new Blob([req.data], { type: type }));
      var a = document.createElement("a");
      a.href = url; a.download = req.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return Promise.resolve({ status: "saved" });
    }
  };

  var cache = [], subs = [], timer = null;
  function snapshot() { return { docs: cache.map(function (o) { return { id: o.id, data: function () { var c = Object.assign({}, o); delete c.id; return c; } }; }), size: cache.length, empty: !cache.length }; }
  function refresh() {
    return call("GET", "/api/orders").then(function (list) {
      cache = list; subs.forEach(function (s) { s.next(snapshot()); });
    }).catch(function (e) { subs.forEach(function (s) { if (s.error) s.error({ code: "unavailable", message: String(e && e.message) }); }); });
  }
  var db = {
    collection: function (name) {
      if (name !== "orders") throw new TypeError("Only the orders collection exists here");
      return {
        onSnapshot: function (next, error) {
          var s = { next: next, error: error };
          subs.push(s);
          refresh();
          if (!timer) timer = setInterval(refresh, 15000);
          return function () { subs = subs.filter(function (x) { return x !== s; }); };
        }
      };
    },
    doc: function (path) {
      var id = path.split("/")[1];
      return {
        set: function (d) { return call("PUT", "/api/orders/" + id, JSON.stringify(d), "application/json").then(refresh); },
        update: function (d) {
          var cur = cache.filter(function (o) { return o.id === id; })[0] || {};
          var merged = Object.assign({}, cur, d); delete merged.id;
          return call("PUT", "/api/orders/" + id, JSON.stringify(merged), "application/json").then(refresh);
        },
        delete: function () { return call("DELETE", "/api/orders/" + id).then(refresh); }
      };
    }
  };

  var impl = { assets: assets, artifact: artifact, user: user, downloads: downloads, db: db };
  window.claude = {
    use: function (name) {
      return me.then(function (m) { return m && m.admin && impl[name] ? impl[name] : null; });
    }
  };

  me.then(function (m) {
    if (!m.admin && /\/orders(\.html)?$/.test(location.pathname)) location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
  });
  document.addEventListener("DOMContentLoaded", function () {
    var a = document.getElementById("site-link");
    if (a) { a.href = "/#admin"; a.removeAttribute("target"); }
  });
})();
