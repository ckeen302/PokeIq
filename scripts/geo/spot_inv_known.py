"""
Known answers for the invariant matcher (scripts/geo/spot_inv.py): views
made from the rips themselves, where the truth is known, then matched exactly
as a screenshot is (against every candidate rip of a shot of that place, its
neighbours' included). spots-2d.ts applies the same gate to them as to the
real shots and reports the error per method and per kind of view:

  plain    a window inside the rip, a player-sized block of noise in the middle
  edge     15 to 45 % of the window past the rip's border (one or two sides),
           filled from another place's rip (the next map over, as in game)
  palette  every colour moved: Game Boy / Game Boy Color views get a random
           new palette (each colour to a random one), the others a colour
           correction (per-channel gain, gamma and offset)
  sprites  two to six sprite-sized blocks of random pixels anywhere
  all      edge, palette and sprites together
  wrong    a view of one place matched against an unrelated place's rips
           (no shared rip, not neighbours): any match accepted is wrong

The camera views (cam3d) are the same windows seen through a random camera
near the family's seed (zoom +-10 %, foreshortening +-6 %, perspective
+-40 %, yaw +-3 degrees). Deterministic (fixed seeds).
"""
import json
import math
import os
import random
import zlib
from multiprocessing import Pool

import cv2
import numpy as np

import spot_inv as S

GB = ("rby", "gsc")
KINDS = ("plain", "edge", "palette", "sprites", "all")
VIEW = {"rby": (160, 144), "gsc": (160, 144), "rse": (240, 160), "frlg": (240, 160), "dppt": (256, 192), "hgss": (256, 192), "bw": (256, 192)}


def recolour(img, rnd, family):
    if family in GB:
        cols, inv = np.unique(img.reshape(-1, 3), axis=0, return_inverse=True)
        new = np.array([[rnd.randrange(256) for _ in range(3)] for _ in cols], np.uint8)
        # Keep the colours apart (a palette has distinct shades).
        for i in range(len(new)):
            for _ in range(20):
                if all(np.abs(new[i].astype(int) - new[j].astype(int)).max() > 40 for j in range(i)):
                    break
                new[i] = [rnd.randrange(256) for _ in range(3)]
        return new[inv.reshape(-1)].reshape(img.shape)
    out = img.astype(np.float32) / 255
    for c in range(3):
        g = rnd.uniform(0.7, 1.4)
        a = rnd.uniform(0.75, 1.15)
        b = rnd.uniform(-0.08, 0.08)
        out[:, :, c] = np.clip(a * out[:, :, c] ** g + b, 0, 1)
    return (out * 255).astype(np.uint8)


def sprites(img, rnd, n):
    h, w = img.shape[:2]
    for _ in range(n):
        sw, sh = 16, rnd.choice((16, 24, 32))
        x, y = rnd.randrange(0, max(1, w - sw)), rnd.randrange(0, max(1, h - sh))
        pal = np.array([[rnd.randrange(256) for _ in range(3)] for _ in range(4)], np.uint8)
        blk = pal[np.array([[rnd.randrange(4) for _ in range(sw // 2)] for _ in range(sh // 2)])]
        img[y : y + sh, x : x + sw] = cv2.resize(blk, (sw, sh), interpolation=cv2.INTER_NEAREST)
    return img


def player(img, rnd, cx, cy):
    h, w = img.shape[:2]
    y0, x0 = int(cy) - 20, int(cx) - 8
    blk = np.array([[[rnd.randrange(256) for _ in range(3)] for _ in range(16)] for _ in range(24)], np.uint8)
    ys, xs = slice(max(0, y0), min(h, y0 + 24)), slice(max(0, x0), min(w, x0 + 16))
    img[ys, xs] = blk[: ys.stop - ys.start, : xs.stop - xs.start]
    return img


def canvas(rip, other, rnd, x, y, w, h):
    """The rip's pixels in the window at (x, y), the rest filled from another rip (the next map over)."""
    out = np.zeros((h, w, 3), np.uint8)
    if other is not None and other["w"] > w and other["h"] > h:
        ox, oy = rnd.randrange(other["w"] - w), rnd.randrange(other["h"] - h)
        out[:] = other["rgb"][oy : oy + h, ox : ox + w]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(rip["w"], x + w), min(rip["h"], y + h)
    m = rip["valid"][y0:y1, x0:x1]
    sub = out[y0 - y : y1 - y, x0 - x : x1 - x]
    sub[m] = rip["rgb"][y0:y1, x0:x1][m]
    return out


def window(rip, rnd, w, h, kind):
    """Top-left of a window: inside, or overhanging the border by 15-45 % on one or two sides."""
    if kind in ("edge", "all"):
        for _ in range(50):
            ox = rnd.uniform(0.15, 0.45) * w if rnd.random() < 0.7 else 0
            oy = rnd.uniform(0.15, 0.45) * h if (ox == 0 or rnd.random() < 0.3) else 0
            if (1 - ox / w) * (1 - oy / h) < 0.6:
                continue
            x = int(-ox) if rnd.random() < 0.5 else int(rip["w"] - w + ox)
            y = int(-oy) if rnd.random() < 0.5 else int(rip["h"] - h + oy)
            if ox == 0:
                x = rnd.randrange(0, max(1, rip["w"] - w))
            if oy == 0:
                y = rnd.randrange(0, max(1, rip["h"] - h))
            yield x, y
        return
    for _ in range(50):
        yield rnd.randrange(0, max(1, rip["w"] - w)), rnd.randrange(0, max(1, rip["h"] - h))


def valid_share(rip, x, y, w, h):
    x0, y0, x1, y1 = max(0, x), max(0, y), min(rip["w"], x + w), min(rip["h"], y + h)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return float(rip["valid"][y0:y1, x0:x1].sum()) / (w * h)


def make_view(rip, other, rnd, family, kind, w, h):
    for x, y in window(rip, rnd, w, h, kind):
        # Mostly map in the window (not the void around a rip's content).
        if valid_share(rip, x, y, w, h) < (0.6 if kind in ("edge", "all") else 0.85):
            continue
        img = canvas(rip, other, rnd, x, y, w, h)
        img = player(img, rnd, w / 2, h / 2)
        if kind in ("palette", "all"):
            img = recolour(img, rnd, family)
        if kind in ("sprites", "all"):
            img = sprites(img, rnd, rnd.randrange(2, 7))
        return img, (x, y)
    return None, None


def through_camera(rip, other, rnd, family, kind, cam, w, h):
    """A screen of w x h seen through camera `cam` from a player standing somewhere on the rip."""
    G = S.cam_matrix(cam, w / 2, h / 2)
    pp = S.player_point(w, h)
    pg = cv2.perspectiveTransform(np.array([[pp]], np.float64), G)[0][0]
    corners = cv2.perspectiveTransform(np.array([[[0, 0], [w, 0], [0, h], [w, h]]], np.float64), G)[0]
    gx0, gy0 = corners.min(0)
    gx1, gy1 = corners.max(0)
    gw, gh = int(math.ceil(gx1 - gx0)), int(math.ceil(gy1 - gy0))
    for x, y in window(rip, rnd, gw, gh, kind):
        if valid_share(rip, x, y, gw, gh) < (0.6 if kind in ("edge", "all") else 0.85):
            continue
        ground = canvas(rip, other, rnd, x, y, gw, gh)
        # Screen <- ground: the ground window's (0, 0) is ground (gx0, gy0).
        T = np.array([[1, 0, -gx0], [0, 1, -gy0], [0, 0, 1]], np.float64) @ G
        img = cv2.warpPerspective(ground, np.linalg.inv(T), (w, h), flags=cv2.INTER_NEAREST)
        img = player(img, rnd, pp[0], pp[1])
        if kind in ("palette", "all"):
            img = recolour(img, rnd, family)
        if kind in ("sprites", "all"):
            img = sprites(img, rnd, rnd.randrange(2, 7))
        truth = (x + pg[0] - gx0, y + pg[1] - gy0)
        return img, truth
    return None, None


def task(args):
    family, j, other_job, filler_job, cams, n, seed, mode = args
    rnd = random.Random(seed)
    place = j["place"]
    rips = [(r["rip"], S.load_rip(r["file"])) for r in j["rips"]]
    sw, sh = j["screen"]
    rips = [(k, r) for k, r in rips if r is not None and r["w"] * r["h"] >= 2.5 * sw * sh]
    own = [(k, r) for k, r in rips if any(q["rip"] == k and q["own"] for q in j["rips"])]
    if not own:
        return []
    out = []
    other_place = other_job["place"] if other_job else None
    other_rips = []
    if other_job:
        oj = other_job
        other_rips = [(r["rip"], S.load_rip(r["file"])) for r in oj["rips"]]
        other_rips = [(k, r) for k, r in other_rips if r is not None and r["w"] * r["h"] >= 2.5 * sw * sh and k not in dict(rips)]
    # The next map over, past the border: a third place (not the wrong place a view is also tried on).
    filler = S.load_rip(next((r["file"] for r in filler_job["rips"] if r["own"]), filler_job["rips"][0]["file"])) if filler_job else None
    w, h = VIEW[family]
    if family in GB and rnd.random() < 0.5:
        h = rnd.choice((78, 82, 120))
    for i in range(n):
        kind = KINDS[i % len(KINDS)]
        rk, rip = own[rnd.randrange(len(own))]
        if mode == "flat":
            img, tl = make_view(rip, filler, rnd, family, kind, w, h)
            if img is None:
                continue
            truth = (tl[0] + w / 2, tl[1] + h / 2)
            peaks = S.match_flat(img, rips)
        else:
            z, ry, p, _ = S.seeds_for(family, cams)[1]
            cam = (z * rnd.uniform(0.9, 1.1), ry * rnd.uniform(0.94, 1.06), p * rnd.uniform(0.6, 1.4), rnd.uniform(-3, 3))
            hh = 192 if rnd.random() < 0.5 else 138
            img, truth = through_camera(rip, filler, rnd, family, kind, cam, 256, hh)
            if img is None:
                continue
            peaks = S.match_cam(img, rips, S.seeds_for(family, cams))
        out.append({"family": family, "mode": mode, "kind": kind, "place": place, "rip": rk, "truth": [float(truth[0]), float(truth[1])], "peaks": peaks})
        # The same view against an unrelated place's rips.
        if other_rips and i % 2 == 0:
            if mode == "flat":
                wp = S.match_flat(img, other_rips)
            else:
                wp = S.match_cam(img, other_rips, S.seeds_for(family, cams))
            out.append({"family": family, "mode": mode, "kind": "wrong", "place": other_place, "rip": rk, "truth": None, "peaks": wp})
    return out


def main(cache, argv):
    d = json.load(open(os.path.join(cache, "inv-jobs.json")))
    fams = os.environ.get("INV_FAMILIES", "rby,gsc,rse,frlg,dppt,hgss,bw").split(",")
    flat_n = int(os.environ.get("KNOWN_FLAT", "10"))
    modes = os.environ.get("KNOWN_MODES", "flat,cam").split(",")
    cam_n = int(os.environ.get("KNOWN_CAM", "5"))
    tasks = []
    for fam in fams:
        by = {}
        for j in d["jobs"]:
            if j["family"] == fam and any(r["own"] for r in j["rips"]):
                by.setdefault(j["place"], []).append(j)
        places = sorted(by)
        for i, place in enumerate(places):
            near = {r["place"] for r in by[place][0]["rips"]}
            mine = {r["rip"] for r in by[place][0]["rips"]}
            others = [q for q in places if q not in near and not ({r["rip"] for r in by[q][0]["rips"]} & mine)]
            seed = zlib.crc32(f"{fam}|{place}".encode())
            other = by[others[seed % len(others)]][0] if others else None
            filler = by[others[(seed // 7 + 1) % len(others)]][0] if len(others) > 1 else None
            if filler is other:
                filler = None
            if "flat" in modes:
                tasks.append((fam, by[place][0], other, filler, d["cameras"], flat_n, seed, "flat"))
            if fam in S.DS and "cam" in modes:
                tasks.append((fam, by[place][0], other, filler, d["cameras"], cam_n, seed + 1, "cam"))
    out = []
    with Pool(int(os.environ.get("INV_PROCS", "4"))) as pool:
        for k, res in enumerate(pool.imap_unordered(task, tasks)):
            out.extend(res)
            if (k + 1) % 25 == 0:
                print(f"  {k + 1}/{len(tasks)}", flush=True)
    name = os.environ.get("KNOWN_OUT", "inv-known.json")
    json.dump(out, open(os.path.join(cache, name), "w"))
    print(f"{len(out)} known views")
