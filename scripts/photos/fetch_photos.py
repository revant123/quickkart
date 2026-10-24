#!/usr/bin/env python3
"""Product photos from Wikimedia Commons (freely licensed), with credits.

    python3 scripts/photos/fetch_photos.py search          # candidates + contact sheets to review
    python3 scripts/photos/fetch_photos.py build           # download the picks in photos.json

`search` writes, for each product kind, a contact sheet of up to 8 freely licensed photos
to scripts/photos/.candidates/ (not committed). Look at them and put the chosen file title
in scripts/photos/photos.json. `build` downloads each pick, crops it to the shop tile shape,
saves web/public/img/products/<kind>.webp and writes the credits list the site shows at /credits.

Only these licences are accepted: public domain, CC0, CC BY, CC BY-SA. CC BY and CC BY-SA
require credit (author, licence, link), which the /credits page gives.
"""
import io, json, re, sys, time
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT_DIR = ROOT / 'web/public/img/products'
CREDITS = OUT_DIR / 'credits.json'
PICKS = HERE / 'photos.json'
CAND = HERE / '.candidates'
API = 'https://commons.wikimedia.org/w/api.php'
UA = {'User-Agent': 'QuickKart-student-project/1.0 (https://github.com/revant123/quickkart)'}

# Tile is 1 : 0.82 (see .swatch in web/src/styles.css). 600 px wide covers 2x screens.
TILE_W, TILE_H = 600, 492

OK_LICENCE = re.compile(r'^(public domain|pd\b|cc0|cc[ -]by(-sa)?[ -]\d)', re.I)

# What to search Commons for, per product kind (the noun at the end of sample product names).
QUERIES = {
    'apple': 'red apple fruit', 'atta': 'whole wheat flour atta', 'banana': 'bananas bunch',
    'besan': 'gram flour besan', 'biscuits': 'biscuits', 'butter': 'butter block',
    'carrot': 'carrots', 'cheese': 'cheese slices', 'chips': 'potato chips',
    'chocolate': 'chocolate bar pieces', 'coffee': 'cup of coffee', 'cola': 'cola glass ice',
    'cookies': 'chocolate chip cookies', 'cream': 'fresh cream bowl', 'curd': 'dahi curd bowl',
    'dal': 'toor dal lentils', 'ghee': 'ghee jar', 'juice': 'orange juice glass',
    'lassi': 'lassi glass', 'lemonade': 'lemonade glass', 'mango': 'mangoes',
    'milk': 'glass of milk', 'namkeen': 'namkeen indian snack mixture', 'oil': 'cooking oil bottle',
    'onion': 'red onions', 'paneer': 'paneer', 'peanuts': 'roasted peanuts',
    'poha': 'poha flattened rice', 'popcorn': 'popcorn bowl', 'potato': 'potatoes',
    'rice': 'basmati rice grains', 'salt': 'salt crystals', 'shake': 'milkshake glass',
    'soda': 'soda water glass bubbles', 'spinach': 'spinach leaves', 'sugar': 'white sugar',
    'tea': 'cup of tea chai', 'tomato': 'tomatoes', 'wafers': 'wafer biscuits',
    'water': 'bottled water',
}


def api(**params):
    params |= {'format': 'json', 'formatversion': 2}
    for attempt in range(4):
        r = requests.get(API, params=params, headers=UA, timeout=30)
        if r.status_code == 429:
            time.sleep(2 + attempt * 3)
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def strip_html(s):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s or '')).strip()


def file_infos(search=None, titles=None, width=320, limit=20):
    """Image info + licence for a search or explicit titles. Only photos (jpeg/png/webp)."""
    q = dict(action='query', prop='imageinfo', iiprop='url|size|mime|extmetadata', iiurlwidth=width)
    if search:
        q |= dict(generator='search', gsrsearch=f'{search} filetype:bitmap', gsrnamespace=6, gsrlimit=limit)
    else:
        q |= dict(titles='|'.join(titles))
    pages = (api(**q).get('query') or {}).get('pages') or []
    pages.sort(key=lambda p: p.get('index', 0))
    out = []
    for p in pages:
        ii = (p.get('imageinfo') or [{}])[0]
        if ii.get('mime') not in ('image/jpeg', 'image/png', 'image/webp'):
            continue
        meta = ii.get('extmetadata') or {}
        lic = strip_html((meta.get('LicenseShortName') or {}).get('value'))
        if not OK_LICENCE.match(lic):
            continue
        out.append({
            'title': p['title'],
            'thumb': ii.get('thumburl') or ii['url'],
            'width': ii.get('width'), 'height': ii.get('height'),
            'licence': lic,
            'licence_url': (meta.get('LicenseUrl') or {}).get('value', ''),
            'author': strip_html((meta.get('Artist') or {}).get('value')) or 'Unknown author',
            'page': ii.get('descriptionurl'),
            'attribution_required': (meta.get('AttributionRequired') or {}).get('value') == 'true',
        })
    return out


def get_image(url):
    for attempt in range(4):
        r = requests.get(url, headers=UA, timeout=60)
        if r.status_code == 429:
            time.sleep(2 + attempt * 3)
            continue
        r.raise_for_status()
        return Image.open(io.BytesIO(r.content))
    r.raise_for_status()


def to_tile(img, focus=(0.5, 0.5)):
    img = ImageOps.exif_transpose(img).convert('RGB')
    return ImageOps.fit(img, (TILE_W, TILE_H), Image.Resampling.LANCZOS, centering=focus)


def search():
    CAND.mkdir(exist_ok=True)
    only = sys.argv[2:] or list(QUERIES)
    for noun in only:
        found = [c for c in file_infos(search=QUERIES[noun]) if (c['width'] or 0) >= 600][:8]
        (CAND / f'{noun}.json').write_text(json.dumps(found, indent=1))
        cell_w, cell_h = 300, 246
        sheet = Image.new('RGB', (cell_w * 4, (cell_h + 22) * 2), 'white')
        draw = ImageDraw.Draw(sheet)
        for i, c in enumerate(found):
            try:
                tile = to_tile(get_image(c['thumb'])).resize((cell_w - 6, cell_h - 6))
            except Exception as e:  # noqa: BLE001 - a broken candidate just shows blank
                print(f'  {noun}[{i}] failed: {e}')
                continue
            x, y = (i % 4) * cell_w, (i // 4) * (cell_h + 22)
            sheet.paste(tile, (x + 3, y + 3))
            draw.text((x + 6, y + cell_h), f'{i}: {c["licence"]}', fill='black')
            time.sleep(0.3)
        sheet.save(CAND / f'{noun}.jpg', quality=80)
        print(f'{noun}: {len(found)} candidates')


def build():
    picks = json.loads(PICKS.read_text())
    titles = [p['title'] for p in picks.values()]
    infos = {}
    for i in range(0, len(titles), 40):
        for info in file_infos(titles=titles[i:i + 40], width=1200):
            infos[info['title']] = info
    credits = []
    for noun, pick in sorted(picks.items()):
        info = infos.get(pick['title'])
        if not info:
            sys.exit(f'{noun}: {pick["title"]} not found or not freely licensed')
        tile = to_tile(get_image(info['thumb']), tuple(pick.get('focus', (0.5, 0.5))))
        tile.save(OUT_DIR / f'{noun}.webp', 'WEBP', quality=78, method=6)
        credits.append({'kind': noun, **{k: info[k] for k in ('title', 'author', 'licence', 'licence_url', 'page')}})
        print(f'{noun}: {info["title"]} ({info["licence"]})')
        time.sleep(0.3)
    CREDITS.write_text(json.dumps(credits, indent=1, ensure_ascii=False) + '\n')
    print(f'wrote {len(credits)} photos and {CREDITS.relative_to(ROOT)}')


if __name__ == '__main__':
    {'search': search, 'build': build}[sys.argv[1] if len(sys.argv) > 1 else 'search']()
