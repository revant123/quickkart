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
UA = {'User-Agent': 'QuickKart-student-project/1.0 (https://github.com/revant123/quickkart; educational demo)'}

# Tile is 1 : 0.82 (see .swatch in web/src/styles.css). 600 px wide covers 2x screens.
TILE_W, TILE_H = 600, 492

OK_LICENCE = re.compile(r'^(public domain|pd\b|cc0|cc[ -]by(-sa)?[ -]\d)', re.I)

# What to search Commons for, per product kind (the noun at the end of sample product
# names). CirrusSearch syntax: intitle: matches the file name, which describes the photo
# far better than full-text search (that also matches licence boilerplate). Queries are
# tried in order until there are enough candidates.
QUERIES = {
    'apple': ['intitle:"red apple"', 'intitle:apples'],
    'atta': ['intitle:"whole wheat flour"', 'intitle:"wholemeal flour"', 'intitle:"wheat flour"'],
    'banana': ['intitle:"bunch of bananas"', 'intitle:bananas'],
    'besan': ['intitle:"gram flour"', 'intitle:"chickpea flour"', 'intitle:"besan flour"'],
    'biscuits': ['intitle:biscuits plate', 'intitle:biscuits'],
    'butter': ['intitle:butter intitle:block', 'intitle:butter'],
    'carrot': ['intitle:carrots'],
    'cheese': ['intitle:"cheddar cheese"', 'intitle:cheese'],
    'chips': ['intitle:"potato chips"', 'intitle:crisps'],
    'chocolate': ['intitle:"chocolate bar"', 'intitle:chocolate'],
    'coffee': ['intitle:"cup of coffee"', 'intitle:coffee cup'],
    'cola': ['intitle:cola glass', 'intitle:cola'],
    'cookies': ['intitle:"chocolate chip cookies"', 'intitle:cookies'],
    'cream': ['intitle:"whipped cream"', 'intitle:cream bowl'],
    'curd': ['intitle:"plain yogurt"', 'intitle:"greek yogurt"', 'intitle:"natural yogurt"', 'intitle:"bowl of yogurt"'],
    'dal': ['intitle:"toor dal"', 'intitle:dal lentils', 'intitle:lentils'],
    'ghee': ['intitle:ghee'],
    'juice': ['intitle:"orange juice"'],
    'lassi': ['intitle:lassi'],
    'lemonade': ['intitle:"homemade lemonade"', 'intitle:"fresh lemonade"', 'intitle:limonada', 'intitle:"lemon water"'],
    'mango': ['intitle:mangoes', 'intitle:mango fruit'],
    'milk': ['intitle:"glass of milk"', 'intitle:milk glass'],
    'namkeen': ['intitle:"bombay mix"', 'intitle:chivda', 'intitle:"aloo bhujia"', 'intitle:"indian snack" mixture'],
    'oil': ['intitle:"cooking oil"', 'intitle:"vegetable oil"', 'intitle:"sunflower oil"'],
    'onion': ['intitle:"red onions"', 'intitle:onions'],
    'paneer': ['incategory:Paneer', 'intitle:"paneer cubes"', 'intitle:"cottage cheese" cubes'],
    'peanuts': ['intitle:"roasted peanuts"', 'intitle:peanuts'],
    'poha': ['intitle:poha', 'intitle:"flattened rice"'],
    'popcorn': ['intitle:"bowl of popcorn"', 'intitle:popcorn bowl', 'intitle:"popped popcorn"'],
    'potato': ['intitle:potatoes'],
    'rice': ['intitle:"basmati rice"', 'intitle:rice grains'],
    'salt': ['intitle:"table salt"', 'intitle:salt'],
    'shake': ['intitle:milkshake'],
    'soda': ['intitle:"glass of soda"', 'intitle:"carbonated water" glass', 'intitle:"sparkling water" glass'],
    'spinach': ['intitle:spinach leaves', 'intitle:spinach'],
    'sugar': ['intitle:"white sugar"', 'intitle:sugar cubes', 'intitle:sugar'],
    'tea': ['intitle:"cup of tea"', 'intitle:chai', 'intitle:tea cup'],
    'tomato': ['intitle:tomatoes'],
    'wafers': ['intitle:"wafer biscuits"', 'intitle:"cream wafers"', 'intitle:"wafer cookies"', 'intitle:"vanilla wafers"'],
    'water': ['intitle:"bottled water"', 'intitle:"water bottle"'],
}


def api(**params):
    params |= {'format': 'json', 'formatversion': 2}
    for attempt in range(6):
        r = requests.get(API, params=params, headers=UA, timeout=30)
        if r.status_code == 429:  # be polite: wait as long as asked, then longer
            time.sleep(int(r.headers.get('Retry-After', 0) or 0) + 5 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def strip_html(s):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s or '')).strip()


# Wikimedia pre-renders thumbnails at standard widths (e.g. 330, 960, 1280 px); other
# widths are generated on demand and are rate-limited much harder, so only use these.
SHEET_WIDTH, BUILD_WIDTH = 330, 960


def file_infos(search=None, titles=None, width=SHEET_WIDTH, limit=20):
    """Image info + licence for a search or explicit titles. Only photos (jpeg/png/webp)."""
    q = dict(action='query', prop='imageinfo', iiprop='url|size|mime|extmetadata', iiurlwidth=width)
    if search:
        q |= dict(generator='search', gsrsearch=f'{search} filetype:bitmap filew:>700', gsrnamespace=6, gsrlimit=limit)
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
    for attempt in range(6):
        r = requests.get(url, headers=UA, timeout=60)
        if r.status_code == 429:
            time.sleep(int(r.headers.get('Retry-After', 0) or 0) + 5 * (attempt + 1))
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
        if not sys.argv[2:] and (CAND / f'{noun}.jpg').exists():
            continue  # resumable: already done in an earlier run
        try:
            search_one(noun)
        except requests.HTTPError as e:
            print(f'{noun}: rate limited ({e.response.status_code}); pausing 90 s, rerun to retry it', flush=True)
            time.sleep(90)


def search_one(noun):
    """Candidates and a contact sheet for one product kind."""
    found, seen = [], set()
    for query in QUERIES[noun]:
        for c in file_infos(search=query, limit=30):
            if c['title'] not in seen and (c['width'] or 0) >= 700:
                seen.add(c['title'])
                found.append(c)
        time.sleep(3)
        if len(found) >= 8:
            break
    found = found[:8]
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
        time.sleep(1.5)
    sheet.save(CAND / f'{noun}.jpg', quality=80)
    print(f'{noun}: {len(found)} candidates', flush=True)


def build():
    picks = json.loads(PICKS.read_text())
    titles = [p['title'] for p in picks.values()]
    infos = {}
    for i in range(0, len(titles), 40):
        for info in file_infos(titles=titles[i:i + 40], width=BUILD_WIDTH):
            infos[info['title']] = info
    credits = []
    for noun, pick in sorted(picks.items()):
        info = infos.get(pick['title'])
        if not info:
            sys.exit(f'{noun}: {pick["title"]} not found or not freely licensed')
        target = OUT_DIR / f'{noun}.webp'
        if not target.exists() or '--force' in sys.argv:  # resumable after a rate limit
            tile = to_tile(get_image(info['thumb']), tuple(pick.get('focus', (0.5, 0.5))))
            tile.save(target, 'WEBP', quality=78, method=6)
            time.sleep(2)
        credits.append({'kind': noun, **{k: info[k] for k in ('title', 'author', 'licence', 'licence_url', 'page')}})
        print(f'{noun}: {info["title"]} ({info["licence"]})', flush=True)
    CREDITS.write_text(json.dumps(credits, indent=1, ensure_ascii=False) + '\n')
    print(f'wrote {len(credits)} photos and {CREDITS.relative_to(ROOT)}')


if __name__ == '__main__':
    {'search': search, 'build': build}[sys.argv[1] if len(sys.argv) > 1 else 'search']()
