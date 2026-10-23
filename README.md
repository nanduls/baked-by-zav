# Baked By Zav

Bakery website for Baked By Zav: a menu with up to 3 photos per item, a customer cart with per-item notes, bank and QRIS payment details, an invoice PDF, and a private orders page with sales reports.

Built as two single-file pages for Claude Artifacts. Run `python3 build.py` to rebuild `build/` from `src/` and `data/`.

- `build/shop.html`: customer site, with its owner-only editor at `#admin`.
- `build/orders.html`: private order book and reports.
- `src/`: sources. `shop.src.html` and `orders.src.html` contain placeholders (`/*MINIPDF*/`, `/*DEFAULTS*/`, `<!--LOGO_PATHS-->`) that are filled from `minipdf.js`, `widths.json`, `logo-raw.svg` and `data/site.json` when building.
- `data/site.json`: menu and site info snapshot (includes bank details and the QRIS image id, which only works inside the original artifact).

The pages rely on the Artifact runtime (`window.claude`: assets, artifact, db, downloads), so they only save and load orders when published as Artifacts.
