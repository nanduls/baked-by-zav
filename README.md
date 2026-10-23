# Baked By Zav

Bakery website for Baked By Zav: a menu with up to 3 photos per item, a customer cart with per-item notes, bank and QRIS payment details, an invoice PDF, and a private orders page with sales reports.

Built as two single-file pages for Claude Artifacts. Run `python3 build.py` to rebuild `build/` from `src/` and `data/`.

- `build/shop.html`: customer site, with its owner-only editor at `#admin`.
- `build/orders.html`: private order book and reports.
- `src/`: sources. `shop.src.html` and `orders.src.html` contain placeholders (`/*MINIPDF*/`, `/*DEFAULTS*/`, `<!--LOGO_PATHS-->`) that are filled from `minipdf.js`, `widths.json`, `logo-raw.svg` and `data/site.json` when building.
- `data/site.json`: menu and site info snapshot (includes bank details and the QRIS image id, which only works inside the original artifact).

The pages rely on the Artifact runtime (`window.claude`: assets, artifact, db, downloads), so they only save and load orders when published as Artifacts.

## Deploy to Cloudflare (with the owner pages working)

The Cloudflare version is one Worker (`worker/index.js`) that serves the static site in `public/` and a small owner API. The shop's admin view (menu, photos, site info, payment details) and the private orders page work there, behind a password.

Menu edits, photos, bank details, QRIS and orders are stored in Cloudflare KV, not in this repository. `data/site.json` is only the starting content, with bank details left blank.

One-time setup:

```
npm install -g wrangler        # or use npx wrangler
npx wrangler login
npx wrangler kv namespace create ZAV
```

Paste the `id` it prints into `wrangler.jsonc` (replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`). Then set the owner password and deploy:

```
npx wrangler secret put ADMIN_PASSWORD
python3 build.py
npx wrangler deploy
```

If you connect the repository to Cloudflare for automatic builds, use Workers Builds (not Pages) with build command `python3 build.py` and deploy command `npx wrangler deploy`, and add `ADMIN_PASSWORD` under the Worker's Variables and Secrets.

Using it:

- Shop: `/`. Owner sign in: `/login.html`, then the shop opens with an Admin link. Orders: `/orders`.
- `public/claude-shim.js` lets the same page code run outside Claude Artifacts. It maps the Artifact calls onto the Worker API and only enables them after sign in.
- Sessions last 30 days. Change the password by setting the secret again; every session is signed out.
- Run `python3 build.py && npm test` to check the whole flow locally (needs Playwright). It runs the Worker with an in-memory store, so no Cloudflare account is needed.

The Artifact version still builds into `build/` and keeps working as before.
