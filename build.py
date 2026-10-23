"""Build the pages from src/ and data/.

build/shop.html, build/orders.html   single-file pages for Claude Artifacts
public/                              static site for Cloudflare (served by the Worker in worker/)
"""
import re, json, os, shutil
svg = open('src/logo-raw.svg').read().replace('rgb(97.98584%, 83.518982%, 8.998108%)', 'currentColor')
logo = re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S).group(1)
mini = open('src/minipdf.js').read().replace('/*WIDTHS*/', open('src/widths.json').read())
site = json.load(open('data/site.json'))

shop = open('src/shop.src.html').read()
shop = shop.replace('<!--LOGO_PATHS-->', logo).replace('/*DEFAULTS*/', json.dumps(site, ensure_ascii=False)).replace('/*MINIPDF*/', mini)
orders = open('src/orders.src.html').read().replace('/*MINIPDF*/', mini)

os.makedirs('build', exist_ok=True)
open('build/shop.html', 'w').write(shop)
open('build/orders.html', 'w').write(orders)

SKELETON = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
            '<script src="/claude-shim.js"></script></head><body>')

def page(body, robots=False):
    head = SKELETON + ('<meta name="robots" content="noindex">' if robots else '')
    return head + body + '</body></html>'

os.makedirs('public', exist_ok=True)
open('public/index.html', 'w').write(page(shop))
open('public/orders.html', 'w').write(page(orders, robots=True))
shutil.copy('src/claude-shim.js', 'public/claude-shim.js')
shutil.copy('src/login.html', 'public/login.html')
json.dump(site, open('public/site.default.json', 'w'), ensure_ascii=False)
print('built build/ and public/')
