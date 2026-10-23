# Baked By Zav

Bakery website for Baked By Zav: a menu with up to 3 photos per item, a customer cart with per-item notes, bank and QRIS payment details, an invoice PDF, and a private orders page with sales reports.

Built as two single-file pages for Claude Artifacts. Run `python3 build.py` to rebuild `build/` from `src/` and `data/`.

- `build/shop.html`: customer site, with its owner-only editor at `#admin`.
- `build/orders.html`: private order book and reports.
- `src/`: sources. `shop.src.html` and `orders.src.html` contain placeholders (`/*MINIPDF*/`, `/*DEFAULTS*/`, `<!--LOGO_PATHS-->`) that are filled from `minipdf.js`, `widths.json`, `logo-raw.svg` and `data/site.json` when building.
- `data/site.json`: menu and site info snapshot (includes bank details and the QRIS image id, which only works inside the original artifact).

The pages rely on the Artifact runtime (`window.claude`: assets, artifact, db, downloads), so they only save and load orders when published as Artifacts.

## Deploy to Cloudflare

The static site is in `public/` (`index.html` is the shop page, `site.json` its content). `wrangler.jsonc` points Workers static assets at it.

- Workers: `npx wrangler deploy`
- Pages: leave the build command empty and set the build output directory to `public`.

Outside Claude Artifacts the shop page shows the menu, cart, WhatsApp ordering and invoice PDF, but the owner editor, saved photos and the QRIS image do not work, because they depend on the Artifact runtime. Edit `data/site.json` (menu text, prices, bank details), run `python3 build.py` and redeploy to change the content. Use the Artifact version for photos and QRIS.
