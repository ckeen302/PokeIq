"use client";

import { useMemo, useState } from "react";
import { Crosshair, Play } from "lucide-react";
import { TICK_HZ } from "@/lib/mass-battle/constants";
import { fmt } from "@/lib/mass-battle/copy";
import type { PostStats } from "./protocol";

/**
 * The result's stats: the MVP, damage and KOs by species, KOs by move, and
 * a timeline of both armies (standing and HP left) to scrub through and
 * replay from, with a kill cam on the boss going down. Every number is the
 * battle's own (the same seeded battle replays from any moment).
 */

const SIDE = ["#4f9bff", "#ff5a64"] as const;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function PostBattleStats({ post, species, sides, move, start, onReplay, onKillCam }: {
  post: PostStats;
  /** Name per battle species. */
  species: string[];
  /** The two sides' names. */
  sides: [string, string];
  move: (fighter: number, slot: number) => string;
  start: [number, number];
  onReplay: (tick: number) => void;
  onKillCam: (() => void) | null;
}) {
  const tl = post.timeline;
  const samples = Math.floor(tl.length / 5);
  const end = samples ? tl[(samples - 1) * 5] : 0;
  const [at, setAt] = useState(0);
  const W = 300, H = 64;
  const paths = useMemo(() => {
    const out: [string, string][] = [];
    for (const s of [0, 1]) {
      let stand = "", hp = "";
      for (let k = 0; k < samples; k++) {
        const x = end ? (tl[k * 5] / end) * W : 0;
        const yStand = H - (tl[k * 5 + 1 + s] / Math.max(1, start[s])) * (H - 4) - 2;
        const yHp = H - (tl[k * 5 + 3 + s] / 1000) * (H - 4) - 2;
        stand += `${k ? "L" : "M"}${x.toFixed(1)},${yStand.toFixed(1)}`;
        hp += `${k ? "L" : "M"}${x.toFixed(1)},${yHp.toFixed(1)}`;
      }
      out.push([stand, hp]);
    }
    return out;
  }, [tl, samples, end, start]);
  const atTick = Math.round(at * end);
  const k = samples ? Math.min(samples - 1, Math.round(at * (samples - 1))) : 0;
  const maxDealt = Math.max(1, ...post.bySpecies.map((r) => r.dealt));
  const rowCls = "flex items-center justify-between gap-2 text-xs";
  return (
    <div className="space-y-3 text-left" data-testid="mb-stats">
      {post.mvp && (
        <div className="rounded-lg bg-[#ffd84a]/10 px-3 py-2 ring-1 ring-[#ffd84a]/30" data-testid="mb-mvp">
          <p className="font-pixel text-[9px] uppercase tracking-wider text-[#ffe680]/80">MVP</p>
          <p className="font-display text-sm font-bold text-white">
            {species[post.mvp.fighter]} <span className="font-normal text-white/60">({sides[post.mvp.side]})</span>
          </p>
          <p className="text-xs text-white/70">{fmt(post.mvp.kos)} KOs · {fmt(post.mvp.dealt)} damage</p>
        </div>
      )}
      <div>
        <p className="mb-1 font-pixel text-[9px] uppercase tracking-wider text-white/50">Damage by species</p>
        <ul className="space-y-1" data-testid="mb-stats-species">
          {post.bySpecies.slice(0, 6).map((r) => (
            <li key={`${r.fighter}-${r.side}`} className="space-y-0.5">
              <div className={rowCls}>
                <span className="min-w-0 truncate text-white/85">{species[r.fighter]}{r.count > 1 ? ` ×${fmt(r.count)}` : ""}</span>
                <span className="shrink-0 tabular-nums text-white/60">{fmt(r.dealt)} · {fmt(r.kos)} KOs</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.dealt / maxDealt) * 100)}%`, background: SIDE[r.side] }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      {post.byMove.length > 0 && (
        <div>
          <p className="mb-1 font-pixel text-[9px] uppercase tracking-wider text-white/50">KOs by move</p>
          <ul className="space-y-0.5" data-testid="mb-stats-moves">
            {post.byMove.slice(0, 6).map((r) => (
              <li key={`${r.fighter}-${r.slot}-${r.side}`} className={rowCls}>
                <span className="min-w-0 truncate text-white/85"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: SIDE[r.side] }} aria-hidden />{species[r.fighter]}&apos;s {move(r.fighter, r.slot)}</span>
                <span className="shrink-0 tabular-nums text-white/60">{fmt(r.kos)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {samples > 1 && (
        <div data-testid="mb-timeline">
          <p className="mb-1 font-pixel text-[9px] uppercase tracking-wider text-white/50">Timeline</p>
          <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full overflow-visible rounded-md bg-white/5" preserveAspectRatio="none" role="img" aria-label="Pokémon standing on each side over the battle">
              {paths.map(([stand, hp], s) => (
                <g key={s}>
                  <path d={hp} fill="none" stroke={SIDE[s]} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                  <path d={stand} fill="none" stroke={SIDE[s]} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                </g>
              ))}
              {post.bossKoTick >= 0 && end > 0 && <line x1={(post.bossKoTick / end) * W} x2={(post.bossKoTick / end) * W} y1={0} y2={H} stroke="#ffd84a" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              <line x1={at * W} x2={at * W} y1={0} y2={H} stroke="white" strokeOpacity={0.8} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <input type="range" min={0} max={1000} value={Math.round(at * 1000)} onChange={(e) => setAt(Number(e.target.value) / 1000)} className="mt-1 w-full accent-[#ffd84a]" aria-label="Moment of the battle" data-testid="mb-scrub" />
          <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums text-white/70">
            <span>{clock(atTick / TICK_HZ)}</span>
            <span><span style={{ color: SIDE[0] }}>{fmt(tl[k * 5 + 1] ?? 0)}</span> · <span style={{ color: SIDE[1] }}>{fmt(tl[k * 5 + 2] ?? 0)}</span> standing</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => onReplay(atTick)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-semibold text-white hover:bg-white/10" data-testid="mb-replay-from">
              <Play className="h-3.5 w-3.5" aria-hidden /> Replay from {clock(atTick / TICK_HZ)}
            </button>
            {onKillCam && (
              <button type="button" onClick={onKillCam} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#ffd84a]/40 bg-[#ffd84a]/10 px-3 text-xs font-semibold text-[#ffe680] hover:bg-[#ffd84a]/15" data-testid="mb-killcam">
                <Crosshair className="h-3.5 w-3.5" aria-hidden /> Kill cam
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
