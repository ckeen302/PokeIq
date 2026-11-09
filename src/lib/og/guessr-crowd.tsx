/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { C, ogCard } from "./card";
import { crowdColor, type GeoCrowdRound } from "@/lib/geo-crowd";
import { dailyNumber } from "@/lib/daily";
import type { GeoRegionInfo } from "@/lib/geo-types";

/**
 * The share card of a Daily round's crowd map (/api/geo/crowd/card): the map
 * around the answer with everyone's pins as a heat cloud and the answer's
 * flag. Only drawn once the route's spoiler guard has said yes. Never a
 * place's name, never a trainer's.
 */

const VIS_W = 480;
const VIS_H = 380;
/** The frame never zooms closer than this share of the map's width. */
const MIN_SPAN = 0.16;

const fmt = (n: number) => n.toLocaleString("en-US");

const FLAG = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="-15 -15 30 30"><circle r="13" fill="#120f24" stroke="#fff" stroke-width="2"/><path d="M-4 7V-7" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M-3 -7h10l-2.5 3.2L7 -0.6h-10z" fill="#ffd23c"/></svg>'
).toString("base64")}`;

let world: Promise<Buffer> | null = null;
const worldMap = () => (world ??= readFile(join(process.cwd(), "public/geo/maps/world.webp")));

/**
 * The part of the map to show (its own 0–1): the answer and the busiest cells
 * that hold most pins, with room around them, at the card's proportions.
 */
export function crowdFrame(crowd: GeoCrowdRound, flag: [number, number], map: { width: number; height: number }): [number, number, number, number] {
  const pts: [number, number][] = [flag];
  let held = 0;
  for (const [x, y, n] of crowd.cells) {
    if (held >= crowd.pins * 0.8) break;
    pts.push([x, y]);
    held += n;
  }
  let [x0, y0, x1, y1] = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  // In map pixels, padded, then widened to the card's shape.
  const cx = ((x0 + x1) / 2) * map.width;
  const cy = ((y0 + y1) / 2) * map.height;
  let w = Math.max((x1 - x0) * map.width * 1.4, MIN_SPAN * map.width);
  let h = Math.max((y1 - y0) * map.height * 1.4, (w * VIS_H) / VIS_W);
  w = Math.max(w, (h * VIS_W) / VIS_H);
  h = (w * VIS_H) / VIS_W;
  if (w > map.width) [w, h] = [map.width, (map.width * VIS_H) / VIS_W];
  if (h > map.height) [h, w] = [map.height, (map.height * VIS_W) / VIS_H];
  x0 = Math.min(Math.max(0, cx - w / 2), map.width - w) / map.width;
  y0 = Math.min(Math.max(0, cy - h / 2), map.height - h) / map.height;
  x1 = x0 + w / map.width;
  y1 = y0 + h / map.height;
  return [x0, y0, x1, y1];
}

async function CrowdVisual({ crowd, flag, region }: { crowd: GeoCrowdRound; flag: [number, number]; region: GeoRegionInfo }) {
  const [bx0, by0, bx1, by1] = region.map.box;
  const size = { width: bx1 - bx0, height: by1 - by0 };
  const [fx0, fy0, fx1, fy1] = crowdFrame(crowd, flag, size);
  const left = Math.round(bx0 + fx0 * size.width);
  const top = Math.round(by0 + fy0 * size.height);
  const width = Math.max(1, Math.round((fx1 - fx0) * size.width));
  const height = Math.max(1, Math.round((fy1 - fy0) * size.height));
  const jpeg = await sharp(await worldMap()).extract({ left, top, width, height }).resize(VIS_W, VIS_H).jpeg({ quality: 82 }).toBuffer();
  const src = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const sx = VIS_W / (fx1 - fx0);
  const sy = VIS_H / (fy1 - fy0);
  const at = (x: number, y: number): [number, number] => [(x - fx0) * sx, (y - fy0) * sy];
  // A cell's glow: a few cells across, bigger and hotter the busier it is.
  const cellPx = Math.max(crowd.cw * sx, crowd.ch * sy);
  const [ax, ay] = at(...flag);
  return (
    <div style={{ display: "flex", position: "relative", width: VIS_W + 6, height: VIS_H + 6, borderRadius: 18, border: `3px solid ${C.edge}`, overflow: "hidden", boxShadow: "0 30px 60px rgba(0,0,0,0.55)", background: "#165c96" }}>
      <img src={src} width={VIS_W} height={VIS_H} />
      <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: VIS_W, height: VIS_H, background: "rgba(8,7,26,0.28)" }} />
      {[...crowd.cells].reverse().map(([x, y, n], i) => {
        const share = n / Math.max(1, crowd.max);
        const r = Math.max(10, Math.min(70, cellPx * (1.1 + 1.6 * Math.sqrt(share))));
        const [px, py] = at(x, y);
        if (px < -r || py < -r || px > VIS_W + r || py > VIS_H + r) return null;
        const color = crowdColor(share);
        const alpha = Math.round((0.55 + 0.4 * share) * 255)
          .toString(16)
          .padStart(2, "0");
        return (
          <div
            key={i}
            style={{ display: "flex", position: "absolute", left: px - r, top: py - r, width: r * 2, height: r * 2, borderRadius: r, backgroundImage: `radial-gradient(circle, ${color}${alpha} 0%, ${color}00 70%)` }}
          />
        );
      })}
      <img src={FLAG} width={34} height={34} style={{ position: "absolute", left: ax - 17, top: ay - 17 }} />
      <div style={{ display: "flex", position: "absolute", left: 12, top: 12, padding: "6px 12px", borderRadius: 8, background: "rgba(0,0,0,0.65)", fontFamily: "Silkscreen", fontSize: 18, color: "#fff" }}>
        Crowd map
      </div>
    </div>
  );
}

export async function guessrCrowdCard({ date, crowd, flag, region, headers }: { date: string; crowd: GeoCrowdRound; flag: [number, number]; region: GeoRegionInfo; headers: Record<string, string> }) {
  return ogCard(
    {
      eyebrow: `PokéGuessr · Daily #${dailyNumber(date)}`,
      title: ["Where everyone", [`pinned round ${crowd.round}`, C.green]],
      titleSize: 60,
      subtitle: `${fmt(crowd.pins)} trainers dropped a pin. The flag is where it really was.`,
      accent: C.green,
      visual: await CrowdVisual({ crowd, flag, region }),
      footer: "Play today's Daily →",
    },
    headers
  );
}
