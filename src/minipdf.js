/* Minimal PDF writer (no dependencies). Implements only the jsPDF calls the invoice uses. */
(function () {
  var WIDTHS = /*WIDTHS*/;
  var K = 72 / 25.4;               // mm -> pt
  var PH = 297, PW = 210;          // A4 in mm
  var FONTS = {
    "helvetica,normal": ["F1", "Helvetica", "h"],
    "helvetica,bold": ["F2", "Helvetica-Bold", "hb"],
    "helvetica,italic": ["F3", "Helvetica-Oblique", "h"],
    "times,bolditalic": ["F4", "Times-BoldItalic", "tbi"]
  };
  function num(n) { return (Math.round(n * 1000) / 1000).toString(); }
  function enc(s) {
    var o = "";
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c > 255) c = 63;
      var ch = String.fromCharCode(c);
      if (ch === "\\" || ch === "(" || ch === ")") ch = "\\" + ch;
      o += ch;
    }
    return o;
  }
  function Pdf() {
    this.pages = [[]]; this.cur = 0;
    this.fill = [0, 0, 0]; this.stroke = [0, 0, 0]; this.tcol = [0, 0, 0];
    this.font = FONTS["helvetica,normal"]; this.size = 12; this.lw = 0.2;
    this.images = [];
  }
  var P = Pdf.prototype;
  function col(c) { return num(c[0] / 255) + " " + num(c[1] / 255) + " " + num(c[2] / 255); }
  P.op = function (s) { this.pages[this.cur].push(s); };
  P.setFillColor = function (r, g, b) { this.fill = [r, g, b]; };
  P.setDrawColor = function (r, g, b) { this.stroke = [r, g, b]; };
  P.setTextColor = function (r, g, b) { this.tcol = [r, g, b]; };
  P.setFontSize = function (s) { this.size = s; };
  P.setLineWidth = function (w) { this.lw = w; };
  P.setFont = function (name, style) { this.font = FONTS[name + "," + (style || "normal")] || this.font; };
  P.rect = function (x, y, w, h) {
    this.op(col(this.fill) + " rg " + num(x * K) + " " + num((PH - y - h) * K) + " " + num(w * K) + " " + num(h * K) + " re f");
  };
  P.line = function (x1, y1, x2, y2) {
    this.op(col(this.stroke) + " RG " + num(this.lw * K) + " w " + num(x1 * K) + " " + num((PH - y1) * K) + " m " + num(x2 * K) + " " + num((PH - y2) * K) + " l S");
  };
  P.width = function (s) {
    var t = WIDTHS[this.font[2]], w = 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); w += t[c > 255 ? 63 : c] || 0; }
    return w * this.size / 1000 / K;  // mm
  };
  P.splitTextToSize = function (text, maxW) {
    var self = this, out = [];
    String(text).split(/\r?\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = "";
      if (!words.length) { out.push(""); return; }
      words.forEach(function (w) {
        while (self.width(w) > maxW && w.length > 1) {     // break very long words
          var n = w.length;
          while (n > 1 && self.width(w.slice(0, n)) > maxW) n--;
          if (line) { out.push(line); line = ""; }
          out.push(w.slice(0, n)); w = w.slice(n);
        }
        var t = line ? line + " " + w : w;
        if (line && self.width(t) > maxW) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  };
  P.text = function (t, x, y, o) {
    var lines = Array.isArray(t) ? t : [t], lh = this.size * 1.2 / K, self = this;
    lines.forEach(function (ln, i) {
      var xx = x, w = self.width(ln);
      if (o && o.align === "right") xx = x - w; else if (o && o.align === "center") xx = x - w / 2;
      self.op("BT " + col(self.tcol) + " rg /" + self.font[0] + " " + num(self.size) + " Tf " + num(xx * K) + " " + num((PH - (y + i * lh)) * K) + " Td (" + enc(ln) + ") Tj ET");
    });
  };
  P.addPage = function () { this.pages.push([]); this.cur = this.pages.length - 1; };
  P.getNumberOfPages = function () { return this.pages.length; };
  P.setPage = function (n) { this.cur = n - 1; };
  P.addImage = function (dataUrl, x, y, w, h) {
    var m = /^data:image\/jpe?g;base64,(.*)$/.exec(dataUrl);
    if (!m) throw new Error("jpeg only");
    var bin = atob(m[1]), b = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    var pw = 0, ph = 0, nc = 3;
    for (i = 2; i < b.length - 9;) {
      if (b[i] !== 0xFF) { i++; continue; }
      var mk = b[i + 1];
      if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) {
        ph = b[i + 5] * 256 + b[i + 6]; pw = b[i + 7] * 256 + b[i + 8]; nc = b[i + 9]; break;
      }
      i += 2 + b[i + 2] * 256 + b[i + 3];
    }
    if (!pw || !ph) throw new Error("bad jpeg");
    this.images.push({ bytes: b, w: pw, h: ph, nc: nc });
    var name = "Im" + this.images.length;
    this.op("q " + num(w * K) + " 0 0 " + num(h * K) + " " + num(x * K) + " " + num((PH - y - h) * K) + " cm /" + name + " Do Q");
  };
  P.build = function () {
    var chunks = [], len = 0, offs = [];
    function put(s) {
      var b;
      if (typeof s === "string") { b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; } else b = s;
      chunks.push(b); len += b.length;
    }
    var fontList = Object.keys(FONTS).map(function (k) { return FONTS[k]; });
    var nPages = this.pages.length, nImg = this.images.length;
    // objects: 1 catalog, 2 pages, 3..(2+F) fonts, then images, then per page (page, content)
    var fBase = 3, iBase = fBase + fontList.length, pBase = iBase + nImg, total = pBase + nPages * 2 - 1;
    var fontRes = fontList.map(function (f, i) { return "/" + f[0] + " " + (fBase + i) + " 0 R"; }).join(" ");
    var imgRes = this.images.map(function (_, i) { return "/Im" + (i + 1) + " " + (iBase + i) + " 0 R"; }).join(" ");
    function obj(n, body) { offs[n] = len; put(n + " 0 obj\n"); put(body); put("\nendobj\n"); }
    put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    var kids = []; for (var p = 0; p < nPages; p++) kids.push((pBase + p * 2) + " 0 R");
    obj(2, "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + nPages + " >>");
    fontList.forEach(function (f, i) { obj(fBase + i, "<< /Type /Font /Subtype /Type1 /BaseFont /" + f[1] + " /Encoding /WinAnsiEncoding >>"); });
    this.images.forEach(function (im, i) {
      offs[iBase + i] = len;
      put((iBase + i) + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h + " /ColorSpace /" + (im.nc === 1 ? "DeviceGray" : "DeviceRGB") + " /BitsPerComponent 8 /Filter /DCTDecode /Length " + im.bytes.length + " >>\nstream\n");
      put(im.bytes); put("\nendstream\nendobj\n");
    });
    for (p = 0; p < nPages; p++) {
      var pn = pBase + p * 2, cn = pn + 1, content = this.pages[p].join("\n");
      obj(pn, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + num(PW * K) + " " + num(PH * K) + "] /Resources << /Font << " + fontRes + " >> /XObject << " + imgRes + " >> >> /Contents " + cn + " 0 R >>");
      obj(cn, "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
    }
    var xref = len;
    put("xref\n0 " + (total + 1) + "\n0000000000 65535 f \n");
    for (var n = 1; n <= total; n++) put(("0000000000" + offs[n]).slice(-10) + " 00000 n \n");
    put("trailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF");
    var out = new Uint8Array(len), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  };
  P.output = function () { var b = this.build(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  P.save = function (name) {
    var url = URL.createObjectURL(new Blob([this.build()], { type: "application/pdf" }));
    var a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };
  window.jspdf = { jsPDF: Pdf };
})();
