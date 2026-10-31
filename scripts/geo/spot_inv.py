#!/usr/bin/env python3
"""
PokéGuessr exact spots: the palette-invariant matcher.

The template matcher in spot-match.ts compares brightness and needs the whole
screenshot to sit inside the map rip. Both fail often: the camera follows the
player, so near a map's edge the screen shows past the rip's border (narrow
routes are mostly edge), and the shots and the rips differ in palette and
colour correction (Game Boy Color palettes, seasons, a rip's recolouring).

This matcher compares where colour changes instead of the colours:
  - the shot goes back to its native pixels (sampling block centres);
  - both images become a two-channel "colour change" map (a pixel differs from
    its right / lower neighbour by more than EDGE_TOL in some channel), which
    a palette swap or a colour curve leaves alone;
  - the rip is padded by one screen on every side, with a validity mask (its
    own transparent void is invalid too), and the correlation is a masked
    normalised cross-correlation over the valid overlap only, with at least
    MIN_COVER of the shot inside the rip;
  - each peak gets a colour score: a colour transfer fitted per shot (each
    shot colour to the mean rip colour under it, on half the pixels) and
    tested on the other half;
  - the DS games (3D, a tilted camera) are flattened through a camera, which
    is searched per shot (zoom x foreshortening x perspective x small yaw)
    around a seed: the per-game fit from spot-ds-pairs.json, or for Black /
    White a fit found the same way from its own shots.

Input: the jobs file (npx tsx scripts/geo/spots-2d.ts jobs). Output: every
shot's best peaks on every candidate rip (inv-matches.json), and the
known-answer tests (inv-known.json). The gate and the trip onto our map are in
spots-2d.ts.

    python3 scripts/geo/spot_inv.py <cache> match [ids...]
    python3 scripts/geo/spot_inv.py <cache> known

Needs numpy and opencv-python-headless. Deterministic.
"""
import json
import math
import os
import sys
from multiprocessing import Pool

import cv2
import numpy as np

EDGE_TOL = 24
MIN_COVER = 0.55
PEAKS = 6
NMS_PX = 10
# A peak needs at least this share of change pixels in both the shot and the rip window (open sea has nothing to match).
MIN_DENSITY = 0.03

cv2.setNumThreads(1)


# --------------------------------------------------------------------------- images


def read_rgba(path):
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None, None
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        a = img[:, :, 3]
        rgb = (img[:, :, :3].astype(np.uint16) * (a[:, :, None] > 0)).astype(np.uint8)
        return rgb, a > 0
    return img[:, :, :3], np.ones(img.shape[:2], bool)


def native_scale(img, maxk):
    """The largest k such that the image is k x k blocks of one colour (the same rule as spot-match.ts)."""
    h, w = img.shape[:2]
    for k in range(maxk, 1, -1):
        if h % k or w % k:
            continue
        b = img.reshape(h // k, k, w // k, k, 3)
        bad = (b != b[:, :1, :, :1]).any(axis=(1, 3, 4)).sum()
        if bad <= (h // k) * (w // k) / 500:
            return k
    return 1


def to_native(img, k):
    """Block centres."""
    if k == 1:
        return img
    h, w = img.shape[:2]
    return img[k // 2 :: k, k // 2 :: k][: h // k, : w // k]


def edges(img, valid=None, tol=EDGE_TOL):
    """Two channels: colour change to the right, colour change downwards; and where that's defined."""
    a = img.astype(np.int16)
    dx = np.abs(a[:-1, 1:] - a[:-1, :-1]).max(2) > tol
    dy = np.abs(a[1:, :-1] - a[:-1, :-1]).max(2) > tol
    e = np.dstack([dx, dy]).astype(np.float32)
    if valid is None:
        return e, np.ones(e.shape[:2], np.float32)
    v = valid[:-1, :-1] & valid[1:, :-1] & valid[:-1, 1:]
    e *= v[:, :, None]
    return e, v.astype(np.float32)


_rip_cache = {}


def load_rip(path):
    if path in _rip_cache:
        return _rip_cache[path]
    rgb, valid = read_rgba(path)
    if rgb is None:
        _rip_cache[path] = None
        return None
    k = native_scale(rgb, 4)
    rgb = np.ascontiguousarray(rgb[::k, ::k]) if k > 1 else rgb
    valid = valid[::k, ::k] if k > 1 else valid
    e, v = edges(rgb, valid)
    r = {"rgb": rgb, "valid": valid, "e": e, "v": v, "scale": k, "h": rgb.shape[0], "w": rgb.shape[1]}
    if len(_rip_cache) > 12:
        _rip_cache.clear()
    _rip_cache[path] = r
    return r


def load_shot(path):
    rgb, _ = read_rgba(path)
    if rgb is None:
        return None
    k = native_scale(rgb, 12)
    return to_native(rgb, k)


# --------------------------------------------------------------------------- masked NCC


def padded(rip, ph, pw):
    """The rip's change map padded by (ph, pw) on every side, with its validity."""
    H, W = rip["e"].shape[:2]
    P = np.zeros((H + 2 * ph, W + 2 * pw, 2), np.float32)
    V = np.zeros((H + 2 * ph, W + 2 * pw), np.float32)
    P[ph : ph + H, pw : pw + W] = rip["e"]
    V[ph : ph + H, pw : pw + W] = rip["v"]
    return P, V, np.ascontiguousarray(P.sum(2))


def boxsum(I, h, w):
    """Sums of every h x w window (the same layout as matchTemplate's output)."""
    S = cv2.integral(I, sdepth=cv2.CV_64F)
    return (S[h:, w:] - S[:-h, w:] - S[h:, :-w] + S[:-h, :-w]).astype(np.float32)


def mncc(P, V, Ps, T, Mt, min_cover=MIN_COVER):
    """
    Masked NCC of a binary two-channel template T (validity Mt) over a padded
    binary map P (validity V): only entries valid in both count. Returns the
    score map and the coverage map (share of the template's valid entries
    over valid rip).
    """
    Tm = T * Mt[:, :, None]
    mt = lambda I, K: cv2.matchTemplate(I, K, cv2.TM_CCORR)
    if Mt.min() >= 1:
        # An all-valid template: its mask's correlations are box sums.
        n = 2 * boxsum(V, *Mt.shape)
        sr = boxsum(Ps, *Mt.shape)
    else:
        n = 2 * mt(V, Mt)
        sr = mt(Ps, Mt)
    st = mt(V, np.ascontiguousarray(Tm.sum(2)))
    sx = mt(P, Tm)
    nn = np.maximum(n, 1)
    cov = sx - st * sr / nn
    vt = st - st * st / nn
    vr = sr - sr * sr / nn
    ncc = cov / np.sqrt(np.maximum(vt * vr, 1e-6))
    cover = n / max(1.0, 2 * Mt.sum())
    # A correlation above 1 is rounding on a near-constant window (float32 sums): no evidence either way.
    bad = (cover < min_cover) | (st < MIN_DENSITY * nn) | (sr < MIN_DENSITY * nn) | (ncc > 1.001)
    ncc[bad] = -1
    return ncc, cover


def selfsim(shot, mask=None, lo=16, hi=64, step=8):
    """
    How well the view matches itself moved by a whole number of tiles (lo to hi
    px either way): a view of open sea, plain grass or a wall of identical trees
    repeats, so it would fit many places equally well. 1 = a perfect repeat.
    """
    T, M = edges(shot, mask)
    h, w = M.shape
    best = 0.0
    for dy in range(-hi, hi + 1, step):
        for dx in range(-hi, hi + 1, step):
            if max(abs(dx), abs(dy)) < lo:
                continue
            ys, xs = slice(max(0, dy), min(h, h + dy)), slice(max(0, dx), min(w, w + dx))
            ys2, xs2 = slice(max(0, -dy), min(h, h - dy)), slice(max(0, -dx), min(w, w - dx))
            if (ys.stop - ys.start) * (xs.stop - xs.start) < 0.4 * h * w:
                continue
            m = (M[ys, xs] * M[ys2, xs2]) > 0
            a, b = T[ys, xs][m].ravel(), T[ys2, xs2][m].ravel()
            if a.size < 50 or a.std() < 1e-6 or b.std() < 1e-6:
                continue
            best = max(best, float(np.corrcoef(a, b)[0, 1]))
    return round(best, 4)


def peaks(ncc, k=PEAKS, r=NMS_PX):
    out = []
    m = ncc.copy()
    for _ in range(k):
        _, mx, _, (x, y) = cv2.minMaxLoc(m)
        if mx <= -0.5:
            break
        out.append((x, y, float(mx)))
        m[max(0, y - r) : y + r + 1, max(0, x - r) : x + r + 1] = -1
    return out


def colour_score(shot, mask, rip, x, y):
    """
    The shot's colours carried onto the rip's by a transfer fitted on half the
    overlap (each shot colour to the mean rip colour under it, on a
    checkerboard), and the share of the other half that then agrees within
    EDGE_TOL. (x, y): the shot's top-left on the rip (may be negative).
    """
    h, w = shot.shape[:2]
    x0, y0 = max(0, -x), max(0, -y)
    x1, y1 = min(w, rip["w"] - x), min(h, rip["h"] - y)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return 0.0
    s = shot[y0:y1, x0:x1].reshape(-1, 3).astype(np.int32)
    r = rip["rgb"][y0 + y : y1 + y, x0 + x : x1 + x].reshape(-1, 3).astype(np.float32)
    ok = (rip["valid"][y0 + y : y1 + y, x0 + x : x1 + x] & mask[y0:y1, x0:x1]).reshape(-1)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    even = ((yy + xx) % 2 == 0).reshape(-1)
    key = (s[:, 0] >> 3) * 1024 + (s[:, 1] >> 3) * 32 + (s[:, 2] >> 3)
    _, inv = np.unique(key, return_inverse=True)
    fit = ok & even
    test = ok & ~even
    n = np.bincount(inv[fit], minlength=inv.max() + 1).astype(np.float32)
    mean = np.stack([np.bincount(inv[fit], weights=r[fit, c], minlength=inv.max() + 1) for c in range(3)], 1) / np.maximum(n, 1)[:, None]
    known = n[inv] > 0
    t = test & known
    if t.sum() < 50:
        return 0.0
    agree = np.abs(mean[inv[t]] - r[t]).max(1) <= EDGE_TOL
    return float(agree.mean())


# --------------------------------------------------------------------------- flat (2D) matching


def match_flat(shot, rips, mask=None, keep=PEAKS):
    """Every candidate rip's best peaks for a flat (top-down) shot. Spot = the view's middle."""
    h, w = shot.shape[:2]
    T, Mt = edges(shot, mask)
    out = []
    for rk, rip in rips:
        if rip is None:
            continue
        P, V, Ps = padded(rip, h, w)
        if P.shape[0] < T.shape[0] or P.shape[1] < T.shape[1]:
            continue
        ncc, cover = mncc(P, V, Ps, T, Mt)
        for x, y, sc in peaks(ncc, keep):
            rx, ry = x - w, y - h
            out.append(
                {
                    "rip": rk,
                    "x": rx,
                    "y": ry,
                    "spot": [rx + w / 2, ry + h / 2],
                    "edge": round(sc, 4),
                    "cover": round(float(cover[y, x]), 3),
                    "colour": round(colour_score(shot, mask if mask is not None else np.ones((h, w), bool), rip, rx, ry), 4),
                }
            )
    return out


# --------------------------------------------------------------------------- DS camera (3D games)
#
# Screen -> ground, about the view's middle (u0, v0): a = u - u0, b = v - v0,
#   X' = zx a / (1 + p b),  Y' = zx ry b / (1 + p b),  then a small yaw.
# zx is the zoom, ry the foreshortening (the pitch's cos), p the perspective
# (a row nearer the top covers more ground). The spot is the ground under
# the view's middle (the player, on a full top screen).


def cam_matrix(c, u0, v0):
    zx, ry, p, yaw = c
    A = np.array([[zx, 0, -zx * u0], [0, zx * ry, -zx * ry * v0], [0, p, 1 - p * v0]], np.float64)
    t = math.radians(yaw)
    R = np.array([[math.cos(t), -math.sin(t), 0], [math.sin(t), math.cos(t), 0], [0, 0, 1]])
    return R @ A


def seed_params(H):
    """The seed homography (screen -> ground about the player) as (zx, ry, p, yaw)."""
    H = np.array(H, np.float64)
    H = H / H[2, 2]
    zx = H[0, 0]
    return (float(zx), float(H[1, 1] / zx), float(H[2, 1]), 0.0)


def player_point(w, h):
    """Where the player stands on a DS top-screen shot: the screen's middle (a shot cropped to fewer rows keeps the top)."""
    return (w / 2, 96.0 if h >= 120 else h / 2)


def warp(shot, c, blur=True):
    """The shot seen top-down through camera c: change map, validity, and where the view's middle and the player land in it."""
    h, w = shot.shape[:2]
    G = cam_matrix(c, w / 2, h / 2)
    corners = cv2.perspectiveTransform(np.array([[[0, 0], [w, 0], [0, h], [w, h]]], np.float64), G)[0]
    if not np.isfinite(corners).all():
        return None
    gx0, gy0 = np.floor(corners.min(0)).astype(int)
    gx1, gy1 = np.ceil(corners.max(0)).astype(int)
    W, Hh = int(gx1 - gx0), int(gy1 - gy0)
    if W < 32 or Hh < 32 or W > 3 * w or Hh > 3 * h:
        return None
    T = np.array([[1, 0, -gx0], [0, 1, -gy0], [0, 0, 1]], np.float64) @ G
    img = cv2.warpPerspective(shot, T, (W, Hh), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)
    m = cv2.warpPerspective(np.full((h, w), 255, np.uint8), T, (W, Hh), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT) > 0
    m = cv2.erode(m.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    e, v = edges(img, m)
    if blur:
        e = soften(e)
    pl = cv2.perspectiveTransform(np.array([[player_point(w, h)]], np.float64), T)[0][0]
    return {"e": e, "v": v, "rgb": img, "mask": m, "origin": (-gx0, -gy0), "player": (float(pl[0]), float(pl[1])), "w": W, "h": Hh}


def soften(e):
    """Change maps for a resampled view: a pixel either way is near enough."""
    k = np.array([[0.25, 0.5, 0.25]], np.float32)
    k = (k.T @ k) * 1.0
    return np.dstack([cv2.filter2D(e[:, :, i], -1, k, borderType=cv2.BORDER_CONSTANT) for i in range(2)]).clip(0, 1)


def mncc_general(P, V, Ps, P2s, T, Mt, min_cover=MIN_COVER):
    """Masked NCC for non-binary maps (softened)."""
    Tm = T * Mt[:, :, None]
    mt = lambda I, K: cv2.matchTemplate(I, K, cv2.TM_CCORR)
    n = 2 * mt(V, Mt)
    st = mt(V, np.ascontiguousarray(Tm.sum(2)))
    stt = mt(V, np.ascontiguousarray((Tm * Tm).sum(2)))
    sr = mt(Ps, Mt)
    srr = mt(P2s, Mt)
    sx = mt(P, Tm)
    nn = np.maximum(n, 1)
    cov = sx - st * sr / nn
    vt = stt - st * st / nn
    vr = srr - sr * sr / nn
    ncc = cov / np.sqrt(np.maximum(vt * vr, 1e-6))
    cover = n / max(1.0, 2 * Mt.sum())
    bad = (cover < min_cover) | (st < MIN_DENSITY * nn) | (sr < MIN_DENSITY * nn)
    ncc[bad] = -1
    return ncc, cover


def padded_soft(rip, ph, pw):
    key = ("pads", ph, pw)
    if key in rip:
        return rip[key]
    if "es" not in rip:
        rip["es"] = soften(rip["e"]) * rip["v"][:, :, None]
    H, W = rip["e"].shape[:2]
    P = np.zeros((H + 2 * ph, W + 2 * pw, 2), np.float32)
    V = np.zeros((H + 2 * ph, W + 2 * pw), np.float32)
    P[ph : ph + H, pw : pw + W] = rip["es"]
    V[ph : ph + H, pw : pw + W] = rip["v"]
    rip[key] = (P, V, np.ascontiguousarray(P.sum(2)), np.ascontiguousarray((P * P).sum(2)))
    return rip[key]


def drop_pads(rips):
    for _, rip in rips:
        if rip is None:
            continue
        for k in [k for k in rip if isinstance(k, tuple)]:
            del rip[k]
        rip.pop("es", None)


PAD = 420  # camera templates vary in size (a Black / White view flattens to about 300 x 200): one generous padding for all


def cam_global(wv, rip, keep=4):
    P, V, Ps, P2s = padded_soft(rip, PAD, PAD)
    if wv["h"] >= PAD or wv["w"] >= PAD or P.shape[0] < wv["h"] or P.shape[1] < wv["w"]:
        return []
    ncc, cover = mncc_general(P, V, Ps, P2s, wv["e"], wv["v"])
    return [(x - PAD, y - PAD, s, float(cover[y, x])) for x, y, s in peaks(ncc, keep, 12)]


def cam_local(wv, rip, x, y, r=10):
    """Best score of the warped view within r px of top-left (x, y) on the rip."""
    P, V, Ps, P2s = padded_soft(rip, PAD, PAD)
    x0, y0 = x + PAD - r, y + PAD - r
    if x0 < 0 or y0 < 0 or y0 + wv["h"] + 2 * r > P.shape[0] or x0 + wv["w"] + 2 * r > P.shape[1]:
        return None
    sl = (slice(y0, y0 + wv["h"] + 2 * r), slice(x0, x0 + wv["w"] + 2 * r))
    ncc, cover = mncc_general(P[sl], V[sl], Ps[sl], P2s[sl], wv["e"], wv["v"])
    _, mx, _, (px, py) = cv2.minMaxLoc(ncc)
    return mx, x0 - PAD + px, y0 - PAD + py, float(cover[py, px])


STEPS = [0.04, 0.06, 0.0005, 3.0]  # zx (relative), ry (relative), p, yaw (degrees)
BOUNDS = [(0.6, 1.7), (0.6, 1.5), (-0.0005, 0.004), (-8, 8)]


def refine(shot, rip, c, x, y, rounds=3):
    """Coordinate descent on the camera around one candidate: keeps the view's middle where it was."""
    wv = warp(shot, c)
    if wv is None:
        return None
    spot = (x + wv["origin"][0], y + wv["origin"][1])
    r = cam_local(wv, rip, x, y, 12)
    if r is None:
        return None
    best = (r[0], c, r[1] + wv["origin"][0], r[2] + wv["origin"][1], r[3], wv)
    step = list(STEPS)
    for _ in range(rounds):
        improved = True
        while improved:
            improved = False
            for i in range(4):
                for sgn in (-1, 1):
                    c2 = list(best[1])
                    c2[i] = c2[i] * (1 + sgn * step[i]) if i < 2 else c2[i] + sgn * step[i]
                    if not (BOUNDS[i][0] <= c2[i] <= BOUNDS[i][1]):
                        continue
                    w2 = warp(shot, tuple(c2))
                    if w2 is None:
                        continue
                    tx, ty = int(round(best[2] - w2["origin"][0])), int(round(best[3] - w2["origin"][1]))
                    r2 = cam_local(w2, rip, tx, ty, 6)
                    if r2 and r2[0] > best[0] + 1e-4:
                        best = (r2[0], tuple(c2), r2[1] + w2["origin"][0], r2[2] + w2["origin"][1], r2[3], w2)
                        improved = True
        step = [s / 2 for s in step]
    return best


def match_cam(shot, rips, seeds, top=3):
    """
    The camera search: every seed camera over every rip (global), the best
    `top` candidates refined (camera and place together), then the best
    camera run over every rip again (so its runner-up is under the same
    camera). Spot = the ground under the view's middle.
    """
    cands = []
    for ci, c in enumerate(seeds):
        wv = warp(shot, c)
        if wv is None:
            continue
        for rk, rip in rips:
            if rip is None:
                continue
            for x, y, s, cov in cam_global(wv, rip):
                cands.append((s, rk, c, x, y))
    cands.sort(key=lambda t: -t[0])
    picked = []
    for s, rk, c, x, y in cands:
        if any(p[1] == rk and abs(p[3] - x) < 24 and abs(p[4] - y) < 24 for p in picked):
            continue
        picked.append((s, rk, c, x, y))
        if len(picked) >= top:
            break
    ripmap = dict(rips)
    out = []
    refined = []
    for s, rk, c, x, y in picked:
        r = refine(shot, ripmap[rk], c, x, y)
        if r is None:
            continue
        sc, c2, sx, sy, cov, wv = r
        refined.append((sc, rk, c2, sx, sy, cov, wv))
    refined.sort(key=lambda t: -t[0])
    for sc, rk, c2, sx, sy, cov, wv in refined:
        tlx, tly = int(round(sx - wv["origin"][0])), int(round(sy - wv["origin"][1]))
        out.append(
            {
                "rip": rk,
                "x": tlx,
                "y": tly,
                "spot": [tlx + wv["player"][0], tly + wv["player"][1]],
                "edge": round(float(sc), 4),
                "cover": round(cov, 3),
                "colour": round(colour_score(wv["rgb"], wv["mask"], ripmap[rk], tlx, tly), 4),
                "cam": [round(v, 6) for v in c2],
                "refined": True,
            }
        )
    if refined:
        c2 = refined[0][2]
        wv = refined[0][6]
        for rk, rip in rips:
            if rip is None:
                continue
            for x, y, s, cov in cam_global(wv, rip, PEAKS):
                out.append(
                    {
                        "rip": rk,
                        "x": x,
                        "y": y,
                        "spot": [x + wv["player"][0], y + wv["player"][1]],
                        "edge": round(float(s), 4),
                        "cover": round(cov, 3),
                        "colour": round(colour_score(wv["rgb"], wv["mask"], rip, x, y), 4),
                        "cam": [round(v, 6) for v in c2],
                    }
                )
    drop_pads(rips)
    return out


def seeds_for(family, cams):
    if family in cams:
        z, ry, p, _ = seed_params(cams[family])
    else:
        z, ry, p = BW_SEED
    return [(z * f, ry, p, 0.0) for f in CAM_ZOOMS]


# The seed cameras tried over every rip before refining (the refinement moves the zoom on from there).
CAM_ZOOMS = tuple(float(v) for v in os.environ.get("INV_CAM_ZOOMS", "1.0").split(","))

# Black / White: no pairs to fit; found by the camera search on its own shots (see `bwseed`).
BW_SEED = (1.0, 1.0, 0.0015)


# --------------------------------------------------------------------------- the run

DS = ("dppt", "hgss", "bw")


def run_place(args):
    jobs, cams, max_view = args
    out = []
    rips = {}
    for j in jobs:
        shot = load_shot(j["shot"])
        if shot is None:
            out.append({"id": j["id"], "why": "no shot"})
            continue
        h, w = shot.shape[:2]
        sw, sh = j["screen"]
        res = {"id": j["id"], "native": [w, h], "selfsim": selfsim(shot)}
        if w * h > max_view * sw * sh:
            res["why"] = "map"
            out.append(res)
            continue
        cand = []
        for r in j["rips"]:
            if r["rip"] not in rips:
                rips[r["rip"]] = load_rip(r["file"])
            rp = rips[r["rip"]]
            if rp is not None and rp["w"] * rp["h"] >= 2.5 * sw * sh:
                cand.append((r["rip"], rp))
        if not cand:
            res["why"] = "no rip"
            out.append(res)
            continue
        modes = os.environ.get("INV_MODES", "flat,cam").split(",")
        if "flat" in modes:
            res["flat"] = match_flat(shot, cand)
        if "cam" in modes and j["family"] in DS and not j["cut"] and w <= sw + 4 and h <= sh + 4:
            res["cam"] = match_cam(shot, cand, seeds_for(j["family"], cams))
        out.append(res)
    return out


def main_match(cache, ids):
    d = json.load(open(os.path.join(cache, "inv-jobs.json")))
    fams = os.environ.get("INV_FAMILIES")
    jobs = [j for j in d["jobs"] if (not ids or j["id"] in ids) and (not fams or j["family"] in fams.split(","))]
    by = {}
    for j in jobs:
        by.setdefault((j["place"], j["family"]), []).append(j)
    tasks = [(v, d["cameras"], d["maxViewScreens"]) for v in by.values()]
    # Big groups first, so the pool ends together.
    tasks.sort(key=lambda t: -len(t[0]) * len(t[0][0]["rips"]))
    out_path = os.path.join(cache, os.environ.get("INV_OUT", "inv-matches.json"))
    done = {}
    if os.path.exists(out_path) and not ids:
        done = {r["id"]: r for r in json.load(open(out_path))}
        tasks = [t for t in tasks if any(j["id"] not in done for j in t[0])]
    n = 0
    with Pool(int(os.environ.get("INV_PROCS", "4"))) as pool:
        for res in pool.imap_unordered(run_place, tasks):
            for r in res:
                done[r["id"]] = r
            n += 1
            if n % 20 == 0 or n == len(tasks):
                print(f"  {n}/{len(tasks)} places", flush=True)
                json.dump(list(done.values()), open(out_path, "w"))
    json.dump(list(done.values()), open(out_path, "w"))


def _selfsim_one(j):
    shot = load_shot(j["shot"])
    if shot is None:
        return j["id"], None
    sw, sh = j["screen"]
    h, w = shot.shape[:2]
    if w * h > 1.6 * sw * sh:
        return j["id"], None
    return j["id"], selfsim(shot)


def main_selfsim(cache):
    """Every view's self-similarity (selfsim.json), for the gate."""
    d = json.load(open(os.path.join(cache, "inv-jobs.json")))
    path = os.path.join(cache, "selfsim.json")
    done = json.load(open(path)) if os.path.exists(path) else {}
    todo = [j for j in d["jobs"] if j["id"] not in done]
    with Pool(int(os.environ.get("INV_PROCS", "4"))) as pool:
        for k, (i, v) in enumerate(pool.imap_unordered(_selfsim_one, todo, chunksize=8)):
            done[i] = v
            if k % 200 == 0:
                json.dump(done, open(path, "w"))
    json.dump(done, open(path, "w"))


if __name__ == "__main__":
    cache, step = sys.argv[1], sys.argv[2]
    if step == "selfsim":
        main_selfsim(cache)
    elif step == "match":
        main_match(cache, set(sys.argv[3:]))
    elif step == "known":
        import spot_inv_known

        spot_inv_known.main(cache, sys.argv[3:])
