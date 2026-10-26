#!/usr/bin/env python3
"""Precise centre points for the pincodes near QuickKart stores, from OpenStreetMap.

India Post's directory (build_pincodes.py) covers every pincode but can be 10-40 km off.
That's fine for "which city is this?", not for a 7 km delivery radius. So for pincodes
within 30 km of a store (or in a store's district) we ask OpenStreetMap's Nominatim
geocoder, which tested at 0.1-2 km off in cities.

Nominatim's usage policy: at most 1 request per second, a real User-Agent, no repeated
bulk runs. Results are saved to osm_points.csv (in the repo) and the script skips pincodes
it already has, so this runs once, not on every build. Data (c) OpenStreetMap contributors, ODbL.

    python3 scripts/pincodes/refine_osm.py
"""
import csv, json, math, re, sys, time
from pathlib import Path
import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / 'osm_points.csv'
UA = {'User-Agent': 'QuickKart-student-project/1.0 (https://github.com/revant123/quickkart)'}

def km(a, b):
    (la1, lo1), (la2, lo2) = a, b
    h = math.sin(math.radians(la2 - la1) / 2) ** 2 + math.cos(math.radians(la1)) * math.cos(math.radians(la2)) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))

stores = json.loads((HERE / 'stores.json').read_text())
sql = (ROOT / 'api/migrations/0006_india_pincodes.sql').read_text()
rows = re.findall(r"\('(\d{6})','((?:[^']|'')*)','((?:[^']|'')*)','((?:[^']|'')*)',([\d.]+),([\d.]+)(?:,(?:true|false))?\)", sql)
points = {r[0]: dict(city=r[2], state=r[3], lat=float(r[4]), lng=float(r[5])) for r in rows}
store_districts = {(points[s['pincode']]['state'], points[s['pincode']]['city']) for s in stores if s['pincode'] in points}

wanted = sorted(p for p, v in points.items()
                if (v['state'], v['city']) in store_districts
                or any(km((v['lat'], v['lng']), (s['lat'], s['lng'])) <= 30 for s in stores))
done = set()
if OUT.exists():
    done = {r['pincode'] for r in csv.DictReader(OUT.open())}
# Nearest to a store first: if the run is stopped early, the most useful ones are done
nearest = lambda p: min(km((points[p]['lat'], points[p]['lng']), (s['lat'], s['lng'])) for s in stores)
todo = sorted((p for p in wanted if p not in done), key=nearest)
print(f'{len(wanted)} pincodes near stores, {len(done)} already done, {len(todo)} to fetch (~{len(todo) * 1.1 / 60:.0f} min)', flush=True)

new_file = not OUT.exists()
with OUT.open('a', newline='') as f:
    w = csv.writer(f)
    if new_file:
        w.writerow(['pincode', 'lat', 'lng', 'osm_name'])
    for i, pin in enumerate(todo):
        for attempt in range(5):
            r = requests.get('https://nominatim.openstreetmap.org/search', headers=UA, timeout=30,
                             params={'postalcode': pin, 'country': 'in', 'format': 'json', 'limit': 1})
            if r.status_code in (429, 503):
                time.sleep(30 * (attempt + 1))
                continue
            break
        res = r.json() if r.ok else []
        if res:
            w.writerow([pin, res[0]['lat'], res[0]['lon'], res[0]['display_name'][:120]])
        else:
            w.writerow([pin, '', '', ''])  # no match: remembered so it isn't asked again
        f.flush()
        if i % 100 == 0:
            print(f'{i}/{len(todo)}', flush=True)
        time.sleep(1.1)  # policy: max 1 request per second
print('done', flush=True)
