#!/usr/bin/env python3
"""
PokéGuessr exact spots: patch-based ground matching for the 3D games
(Diamond / Pearl / Platinum, HeartGold / SoulSilver, Black / White and
Black 2 / White 2) against flat top-down map rips.

A whole-screen match breaks on a tilted 3D camera: building fronts, tree
crowns and people stand up out of the ground and cover what's behind them.
This matcher only trusts the ground:

  - the shot is flattened through a seed camera (the family's fit from
    spot-ds-pairs.json, or for Black / White the median camera of the shots
    already solved in that area, else in the family);
  - the flattened view is cut into small ground patches (paths, grass, water
    and fence edges: enough colour change, not too much), each matched on its
    own in the padded, palette-invariant change map of every candidate rip
    (spot_inv.py's edges);
  - the patch matches vote for the view's offset on the rip, and the ground
    map is fitted to the patches that agree (affine on top of the seed
    camera: no flips, scale 0.75-1.33, a small tilt), so tall objects fall
    out as outliers;
  - the answer is the ground point under the player (the screen's middle).

A placement is kept only with enough agreeing patches and a clear margin over
the best model elsewhere. Validation: the shots already solved (their spot on
a rip) are the answer key; a method that places any of them wrong is dropped.

    python3 scripts/geo/spot_patch.py <cache> known       # the answer key
    python3 scripts/geo/spot_patch.py <cache> match ids…  # candidates for unsolved shots

Needs numpy and opencv-python-headless. Deterministic.
"""
import json
import math
import os
import sys
from multiprocessing import Pool

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spot_inv import cam_matrix, edges, load_rip, load_shot, player_point, seed_params, soften  # noqa: E402

cv2.setNumThreads(1)

PATCH = 24
STEP = 12
# A patch needs this share of change pixels (a flat patch matches anywhere), and no more than this (foliage noise).
DENS = (0.06, 0.45)
PEAKS = 3
MIN_PEAK = 0.45
INLIER_PX = 4.0
MIN_INLIERS = 8
# A second model this far from the best (rip px, at the player) with this share of its inliers makes the match ambiguous.
AMBIG_PX = 24
AMBIG_SHARE = 0.35
TOL_PX = 24


def flatten(shot, c):
    h, w = shot.shape[:2]
    G = cam_matrix(c, w / 2, h / 2)
    corners = cv2.perspectiveTransform(np.array([[[0, 0], [w, 0], [0, h], [w, h]]], np.float64), G)[0]
    gx0, gy0 = np.floor(corners.min(0)).astype(int)
    gx1, gy1 = np.ceil(corners.max(0)).astype(int)
    W, Hh = int(gx1 - gx0), int(gy1 - gy0)
    if W < 32 or Hh < 32 or W > 3 * w or Hh > 3 * h:
        return None
    T = np.array([[1, 0, -gx0], [0, 1, -gy0], [0, 0, 1]], np.float64) @ G
    img = cv2.warpPerspective(shot, T, (W, Hh), flags=cv2.INTER_NEAREST)
    m = cv2.warpPerspective(np.full((h, w), 255, np.uint8), T, (W, Hh), flags=cv2.INTER_NEAREST) > 0
    m = cv2.erode(m.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    # Screen rows: patches only from the lower part of the screen, where the ground is seen nearly top-down.
    rows = cv2.warpPerspective(np.repeat(np.arange(h, dtype=np.float32)[:, None], w, 1), T, (W, Hh), flags=cv2.INTER_NEAREST)
    e, v = edges(img, m)
    pl = cv2.perspectiveTransform(np.array([[player_point(w, h)]], np.float64), T)[0][0]
    return {"e": soften(e), "v": v, "rows": rows, "player": (float(pl[0]), float(pl[1])), "h": h}


def patches(fv):
    e, v, rows = fv["e"], fv["v"], fv["rows"]
    out = []
    H, W = v.shape
    for y in range(0, H - PATCH, STEP):
        for x in range(0, W - PATCH, STEP):
            if v[y : y + PATCH, x : x + PATCH].mean() < 0.98:
                continue
            # The top quarter of the screen is the far background (roofs, tree tops): left out.
            if rows[y + PATCH // 2, x + PATCH // 2] < fv["h"] * 0.25:
                continue
            p = e[y : y + PATCH, x : x + PATCH]
            d = (p > 0.5).mean()
            if not (DENS[0] <= d <= DENS[1]):
                continue
            out.append((x + PATCH / 2, y + PATCH / 2, np.ascontiguousarray(p)))
    return out


def rip_maps(rip):
    if "soft" not in rip:
        rip["soft"] = soften(rip["e"])
    return rip["soft"]


def match_patches(pts, rip):
    R = rip_maps(rip)
    cands = []
    for i, (x, y, p) in enumerate(pts):
        if R.shape[0] < PATCH or R.shape[1] < PATCH:
            continue
        s = cv2.matchTemplate(R[:, :, 0], p[:, :, 0], cv2.TM_CCORR_NORMED) + cv2.matchTemplate(R[:, :, 1], p[:, :, 1], cv2.TM_CCORR_NORMED)
        s /= 2
        for _ in range(PEAKS):
            _, mv, _, ml = cv2.minMaxLoc(s)
            if mv < MIN_PEAK:
                break
            cands.append((i, x, y, ml[0] + PATCH / 2, ml[1] + PATCH / 2, float(mv)))
            cv2.rectangle(s, (ml[0] - 8, ml[1] - 8), (ml[0] + 8, ml[1] + 8), -1.0, -1)
    return cands


def plausible(H):
    if H is None or not np.isfinite(H).all():
        return False
    H = H / H[2, 2]
    A = H[:2, :2]
    if np.linalg.det(A) <= 0:
        return False
    sv = np.linalg.svd(A, compute_uv=False)
    if not (0.75 <= sv[1] and sv[0] <= 1.33 and sv[0] / sv[1] < 1.25):
        return False
    rot = math.degrees(math.atan2(A[1, 0] - A[0, 1], A[0, 0] + A[1, 1]))
    return abs(rot) < 8 and abs(H[2, 0]) < 2e-3 and abs(H[2, 1]) < 2e-3


def fit_affine(src, dst):
    """Least-squares affine (no perspective: the view is already flattened by the seed camera)."""
    A = np.hstack([src, np.ones((len(src), 1))])
    M, *_ = np.linalg.lstsq(A, dst, rcond=None)
    H = np.eye(3)
    H[:2, :] = M.T
    return H


def consensus(cands, player, n_patches):
    """
    Ground-plane consensus: every patch match votes for the view's offset on the
    rip (Hough, 4 px bins); the strongest offsets are refined into an affine
    ground map on their agreeing patches (one match per patch), which must stay
    near a similarity (no flips, scale 0.75-1.33, a small tilt). Tall objects
    and repeated tiles vote for scattered offsets and fall out.
    """
    if len(cands) < 4:
        return None
    src = np.array([[c[1], c[2]] for c in cands], np.float64)
    dst = np.array([[c[3], c[4]] for c in cands], np.float64)
    pid = np.array([c[0] for c in cands])
    off = dst - src
    bins = {}
    for k, (ox, oy) in enumerate(off):
        for bx in (math.floor(ox / 4), math.floor(ox / 4) - 1):
            for by in (math.floor(oy / 4), math.floor(oy / 4) - 1):
                bins.setdefault((bx, by), set()).add(int(pid[k]))
    tops = sorted(bins.items(), key=lambda kv: -len(kv[1]))[:12]
    models = []
    for (bx, by), _ in tops:
        o = np.array([bx * 4 + 4, by * 4 + 4], np.float64)
        ok = np.hypot(*(off - o).T) < 8
        H = None
        for _ in range(4):
            keep = {}
            for k in np.where(ok)[0]:
                if pid[k] not in keep or cands[k][5] > cands[keep[pid[k]]][5]:
                    keep[pid[k]] = k
            ks = list(keep.values())
            if len(ks) < 4:
                break
            H = fit_affine(src[ks], dst[ks])
            if not plausible(H):
                H = None
                break
            proj = src @ H[:2, :2].T + H[:2, 2]
            ok = np.hypot(*(proj - dst).T) < INLIER_PX
        if H is None:
            continue
        n = len(set(pid[ok]))
        at = H[:2, :2] @ np.array(player) + H[:2, 2]
        models.append({"inliers": n, "H": H, "at": (float(at[0]), float(at[1]))})
    if not models:
        return None
    models.sort(key=lambda m: -m["inliers"])
    best = models[0]
    second = max([m["inliers"] for m in models[1:] if math.hypot(m["at"][0] - best["at"][0], m["at"][1] - best["at"][1]) > AMBIG_PX] or [0])
    best["second"] = second
    best["patches"] = n_patches
    best["ok"] = best["inliers"] >= MIN_INLIERS and second <= AMBIG_SHARE * best["inliers"]
    return best


def solve(shot_path, rip_files, seeds):
    shot = load_shot(shot_path)
    if shot is None:
        return []
    shot = shot[:192]
    out = []
    for c in seeds:
        fv = flatten(shot, c)
        if fv is None:
            continue
        pts = patches(fv)
        if len(pts) < MIN_INLIERS:
            continue
        for rk, rf in rip_files:
            rip = load_rip(rf)
            if rip is None:
                continue
            # The rip's own coordinates are native; the padding is implicit (a patch must fall inside the rip).
            cands = match_patches(pts, rip)
            r = consensus(cands, fv["player"], len(pts))
            if r:
                out.append({"rip": rk, "at": r["at"], "inliers": r["inliers"], "second": r["second"], "patches": r["patches"], "ok": bool(r["ok"]), "cam": list(c)})
    out.sort(key=lambda r: (-r["ok"], -r["inliers"]))
    return out


def seeds_for(family, cams, local):
    """The seed cameras: the area's solved cameras (median), then the family's."""
    out = []
    if local:
        a = np.median(np.array(local), 0)
        out.append(tuple(float(v) for v in a))
    if family in cams:
        out.append(seed_params(cams[family]))
    elif not local:
        out.append((1.07, 1.0, 0.001, 0.0))
    return out


def _one(job):
    try:
        return job["id"], solve(job["shot"], job["rips"], [tuple(s) for s in job["seeds"]])
    except Exception as e:  # noqa: BLE001
        return job["id"], [{"error": str(e)}]


def main():
    cache, step = sys.argv[1], sys.argv[2]
    jobs = json.load(open(sys.argv[3]))
    with Pool(int(os.environ.get("PATCH_PROCS", "4"))) as pool:
        res = dict(pool.imap_unordered(_one, jobs, chunksize=1))
    json.dump(res, open(os.path.join(cache, f"patch-{step}.json"), "w"))
    print(f"{step}: {len(res)} shots, {sum(1 for v in res.values() if v and v[0].get('ok'))} placed")


if __name__ == "__main__":
    main()
