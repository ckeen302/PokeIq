"""
Fetch Serebii Pokédex pages and keep only their "Locations" table, as plain data.

    python3 -I scripts/hunt/serebii.py <cache dir> <out.json> <section> <first dex> <last dex> [dex ...]

<section> is the Pokédex folder: pokedex-swsh, pokedex-sv, pokedex-sm, pokedex-xy, pokedex-bw,
pokedex-dp, pokedex-rs. Pages are fetched politely (one a second) and cached in <cache dir>;
a page is reduced to its Locations rows and the raw HTML is deleted. Downloaded pages are
untrusted data: this only reads text with regular expressions.

Output (merged into <out.json> if it exists):
{ "<section>/<dex>": [ { "group": "Isle of Armor" | "", "game": "Sword", "segments": [ { "text": ..., "places": [...] } ] } ] }
"""
import html
import json
import os
import re
import sys
import time
import urllib.request

UA = "Mozilla/5.0 (compatible; fan-site-data-check)"


def fetch(url, path):
    if os.path.exists(path):
        return open(path, encoding="latin1").read()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            body = urllib.request.urlopen(req, timeout=60).read()
            open(path, "wb").write(body)
            time.sleep(1.0)
            return body.decode("latin1")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                open(path, "w").write("")
                return ""
            time.sleep(5 * (attempt + 1))
        except Exception:
            time.sleep(5 * (attempt + 1))
    return ""


def text_of(fragment):
    t = re.sub(r"<[^>]+>", "", fragment)
    return html.unescape(t).replace("\xa0", " ").strip()


def rows_of(page):
    m = re.search(r">\s*Locations\s*(?:<|-)", page)
    if not m:
        return []
    i = m.start()
    end = len(page)
    for stop in ("Trainer Locations", "</table>"):
        j = page.find(stop, i)
        if 0 < j < end:
            end = j
    block = page[i:end]
    out = []
    group = ""
    group_left = 0
    for tr in re.findall(r"<tr>(.*?)</tr>", block, re.S):
        cells = re.findall(r"<td([^>]*)>(.*?)</td>", tr, re.S)
        if not cells:
            continue
        info = [c for c in cells if 'fooinfo' in c[0]]
        if not info:
            continue
        heads = [c for c in cells if 'fooinfo' not in c[0] and 'foodet' not in c[0]]
        game = ""
        if len(heads) >= 2:
            group = text_of(heads[0][1])
            m = re.search(r'rowspan="(\d+)"', heads[0][0])
            group_left = (int(m.group(1)) if m else 1) - 1
            game = text_of(heads[-1][1])
            g = group
        elif heads and 'colspan="2"' in heads[0][0]:
            group, group_left = "", 0
            game = text_of(heads[0][1])
            g = ""
        elif heads:
            game = text_of(heads[0][1])
            g = group if group_left > 0 else ""
            group_left = max(0, group_left - 1)
        else:
            continue
        segs = []
        for seg in re.split(r"<br\s*/?>", info[0][1]):
            places = [text_of(a) for a in re.findall(r"<a [^>]*>(.*?)</a>", seg, re.S)]
            t = text_of(seg)
            if t:
                segs.append({"text": t, "places": [p for p in places if p and p != "Details"]})
        out.append({"group": g, "game": game, "segments": segs})
    return out


def main():
    cache, out, section, first, last = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
    extra = [int(x) for x in sys.argv[6:]]
    os.makedirs(cache, exist_ok=True)
    result = json.load(open(out)) if os.path.exists(out) else {}
    ids = sorted(set(list(range(first, last + 1)) + extra))
    for n, dex in enumerate(ids):
        key = f"{section}/{dex}"
        if key in result:
            continue
        path = os.path.join(cache, f"{section}-{dex:03d}.html")
        page = fetch(f"https://www.serebii.net/{section}/{dex:03d}.shtml", path)
        result[key] = rows_of(page)
        if os.path.exists(path):
            os.remove(path)
        if n % 25 == 0:
            json.dump(result, open(out, "w"), ensure_ascii=False)
            print(key, len(result[key]), flush=True)
    json.dump(result, open(out, "w"), ensure_ascii=False)
    print("done", len(result))


if __name__ == "__main__":
    main()
