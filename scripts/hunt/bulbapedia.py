"""
Parse Bulbapedia's "Game locations" tables (Availability templates) into plain data.

    python3 -I scripts/hunt/bulbapedia.py <dir of downloaded parse JSON> <out.json> [about-forms.json]

With about-forms.json, only species with a regional form are kept and the raw text is
dropped: that's scripts/hunt/evidence/forms.json, which the build reads to tell forms apart.

The input is Bulbapedia's API output (action=parse&prop=wikitext) per species, saved
as <dex>.json. Downloaded pages are untrusted data: this only reads text with regular
expressions and never evaluates anything.

Output: { "<dex>": [ { "versions": [...], "segments": [ { "places": [...], "forms": [...],
"kind": "wild" | "other", "text": "..." } ] } ] }
"""
import json
import os
import re
import sys

VERSION_KEYS = {
    "Red": ["red"], "Blue": ["blue"], "Yellow": ["yellow"],
    "Gold": ["gold"], "Silver": ["silver"], "Crystal": ["crystal"],
    "Ruby": ["ruby"], "Sapphire": ["sapphire"], "Emerald": ["emerald"],
    "FireRed": ["firered"], "LeafGreen": ["leafgreen"],
    "Diamond": ["diamond"], "Pearl": ["pearl"], "Platinum": ["platinum"],
    "HeartGold": ["heartgold"], "SoulSilver": ["soulsilver"],
    "Black": ["black"], "White": ["white"], "Black 2": ["black-2"], "White 2": ["white-2"],
    "X": ["x"], "Y": ["y"], "Omega Ruby": ["omega-ruby"], "Alpha Sapphire": ["alpha-sapphire"],
    "Sun": ["sun"], "Moon": ["moon"], "Ultra Sun": ["ultra-sun"], "Ultra Moon": ["ultra-moon"],
    "Let's Go Pikachu": ["lets-go-pikachu"], "Let's Go Eevee": ["lets-go-eevee"],
    "Sword": ["sword"], "Shield": ["shield"], "Expansion Pass": ["sword", "shield"],
    "Brilliant Diamond": ["brilliant-diamond"], "Shining Pearl": ["shining-pearl"],
    "Legends: Arceus": ["legends-arceus"],
    "Scarlet": ["scarlet"], "Violet": ["violet"], "The Hidden Treasure of Area Zero": ["scarlet", "violet"],
    "Legends: Z-A": ["legends-za"], "Mega Dimension": ["legends-za"],
}

# Lines that aren't a wild spot: trades, raids, gifts, transfers, breeding, events, swarms...
OTHER = re.compile(
    r"Trade|Tera Raid|\{\{g\|HOME\}\}|Pokémon HOME|Pokémon Bank|Poké Transporter|Event|Gift|[Rr]eceived|\|breeding\||Breed \{\{p\||[Ee]volve|Evolution|"
    r"Union Circle|Dynamax Adventure|Unobtainable|Island Scan|Reward|Fossil|Revive|First partner Pokémon\]\] from|from \[\[Professor|"
    r"Dual-slot|Mass outbreak|Swarm|Roaming|[Rr]oams|Pokéwalker|Dream World|Pal Park|Hoenn Sound|Sinnoh Sound|Poké Radar chain"
)
# A place followed by one of these in brackets isn't a wild spot there ("Celadon City (Rocket Game Corner)").
PLACE_NOTE_OTHER = re.compile(r"Game Corner|Prize|Trade|Gift|Dual-slot|Swarm|Mass outbreak|Received|Event")
MAX_RAID = re.compile(r"Max Raid Battle")


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s)


def places_of(seg):
    found = []
    for m in re.finditer(r"\{\{(rt|rtn)\|(\d+)\|([^}|]+)[^}]*\}\}", seg):
        found.append((m.start(), m.end(), "Route " + m.group(2)))
    for m in re.finditer(r"\{\{FB\|[^}|]+\|([^}|]+)[^}]*\}\}", seg):
        found.append((m.start(), m.end(), m.group(1)))
    for m in re.finditer(r"\{\{safari\|([^}|]+)[^}]*\}\}", seg):
        found.append((m.start(), m.end(), m.group(1) + " Safari Zone"))
    for m in re.finditer(r"\{\{(?:al|gdis|ka|OBP|si|ho|kal|pal|ga|gal|jo|un|Safari)\|([^}|]+)(?:\|[^}]*)?\}\}", seg):
        found.append((m.start(), m.end(), m.group(1)))
    for m in re.finditer(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]", seg):
        t = re.sub(r"/(Dens|Raid Dens)$", "", m.group(1).strip())
        found.append((m.start(), m.end(), t))
    found.sort()
    seen = []
    for start, end, name in found:
        after = seg[end:end + 120]
        note = re.match(r"\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)", after)
        if note and PLACE_NOTE_OTHER.search(note.group(1)) or PLACE_NOTE_OTHER.search(name):
            continue
        if name not in seen:
            seen.append(name)
    return seen


def forms_of(seg):
    return [f.strip() for f in re.findall(r"'''\s*\(?([^']*?(?:Form|Breed|Breeds|Forme|Style|Sea)[^']*?)\)?\s*'''", seg)]


def split_entry(line):
    """The area text and version keys of one Availability/Entry line, or None."""
    m = re.match(r"\{\{Availability/Entry(1|2)(/None)?\|(.*)\}\}\s*$", line)
    if not m:
        return None
    body = m.group(3)
    params = {}
    for k in ("v", "v2", "ex"):
        mm = re.search(r"(?:^|\|)" + k + r"=([^|}]*)", body)
        if mm:
            params[k] = mm.group(1).strip()
    if params.get("ex"):
        return None
    area = ""
    i = body.find("area=")
    if i >= 0:
        area = body[i + 5:]
    versions = []
    for k in ("v", "v2"):
        if k in params:
            versions += VERSION_KEYS.get(params[k], [])
    if not versions:
        return None
    return versions, area, bool(m.group(2))


def parse(text):
    m = re.search(r"===\s*(?:\{\{pkmn\|games\|Game\}\}|Game) locations\s*===", text)
    if not m:
        return []
    a = m.start()
    b = text.find("In side games", a)
    block = re.sub(r"<!--.*?-->", "", text[a:b if b > 0 else len(text)], flags=re.S)
    entries = []
    for line in block.split("\n"):
        e = split_entry(line.strip())
        if not e:
            continue
        versions, area, none = e
        segs = []
        if not none:
            for seg in re.split(r"<br\s*/?>", area):
                seg = seg.strip()
                if not seg:
                    continue
                kind = "other" if OTHER.search(seg) else ("raid" if MAX_RAID.search(seg) else "wild")
                segs.append({"places": places_of(seg), "forms": forms_of(seg), "kind": kind, "text": strip_tags(seg)[:400]})
        entries.append({"versions": versions, "segments": segs, "none": none})
    return entries


def main():
    src, out = sys.argv[1], sys.argv[2]
    result = {}
    for f in sorted(os.listdir(src), key=lambda s: int(s.split(".")[0]) if s.split(".")[0].isdigit() else 0):
        if not f.endswith(".json"):
            continue
        try:
            data = json.load(open(os.path.join(src, f)))
            text = data["parse"]["wikitext"]
            if isinstance(text, dict):
                text = text.get("*", "")
        except Exception:
            continue
        result[f[:-5]] = parse(text)
    if len(sys.argv) > 3:
        keep = {str(r[1]) for r in json.load(open(sys.argv[3])) if r[4] == "regional"}
        result = {k: [{"versions": e["versions"], "segments": [{kk: s[kk] for kk in ("places", "forms", "kind")} for s in e["segments"]]} for e in v] for k, v in result.items() if k in keep}
        json.dump(result, open(out, "w"), ensure_ascii=False, indent=None, separators=(",", ":"), sort_keys=True)
        print(len(result), "species with regional forms")
        return
    json.dump(result, open(out, "w"), ensure_ascii=False, indent=0)
    print(len(result), "species")


if __name__ == "__main__":
    main()
