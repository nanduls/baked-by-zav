"""Build the two single-file pages in build/ from src/ and data/."""
import re, json, os, shutil
svg = open('src/logo-raw.svg').read().replace('rgb(97.98584%, 83.518982%, 8.998108%)', 'currentColor')
logo = re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S).group(1)
mini = open('src/minipdf.js').read().replace('/*WIDTHS*/', open('src/widths.json').read())
site = json.load(open('data/site.json'))

shop = open('src/shop.src.html').read()
shop = shop.replace('<!--LOGO_PATHS-->', logo).replace('/*DEFAULTS*/', json.dumps(site, ensure_ascii=False)).replace('/*MINIPDF*/', mini)
open('build/shop.html', 'w').write(shop)

orders = open('src/orders.src.html').read().replace('/*MINIPDF*/', mini)
open('build/orders.html', 'w').write(orders)

# Static site for Cloudflare (or any static host): only the public shop page.
os.makedirs('public', exist_ok=True)
shutil.copy('build/shop.html', 'public/index.html')
shutil.copy('data/site.json', 'public/site.json')
print('built build/shop.html, build/orders.html and public/')
