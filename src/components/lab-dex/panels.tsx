"use client";

import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "@/components/ui/Link";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { typeColor } from "@/lib/pokemon/type-colors";
import { defensiveProfile, type PokemonType } from "@/lib/pokemon/type-matrix";
import { ROLES, percentileParts, standings, type RoleTable } from "@/lib/lab-dex/roles";
import { sortBadge, type SortKey } from "@/lib/lab-dex/sequence";
import type { LabDetails, LabEvoNode, LabMon } from "@/lib/lab-dex/types";
import { cn } from "@/lib/utils";
import { GEN_NUMERALS, REGIONS, ROLE_TEXT, S, SORT_TEXT, STAT_LABELS, STAT_SHORT } from "./strings";

/**
 * The Professor's Lab's panels, in the site's design language: who's on the
 * table (number, name, genus, types, size, region, Pokédex entry,
 * abilities, evolution line, matchups) and their numbers (base stats on a
 * hexagon and in bars; battle roles ranked against every Pokémon).
 */

export const glass = "relative rounded-xl border border-cyan-200/[0.14] bg-[#040814]/[0.82] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-md";

export function Corners({ className }: { className?: string }) {
  const c = "pointer-events-none absolute h-3 w-3 border-cyan-200/70";
  return (
    <div className={cn("pointer-events-none absolute inset-0", className)} aria-hidden>
      <span className={cn(c, "left-0 top-0 rounded-tl-[6px] border-l-2 border-t-2")} />
      <span className={cn(c, "right-0 top-0 rounded-tr-[6px] border-r-2 border-t-2")} />
      <span className={cn(c, "bottom-0 left-0 rounded-bl-[6px] border-b-2 border-l-2")} />
      <span className={cn(c, "bottom-0 right-0 rounded-br-[6px] border-b-2 border-r-2")} />
    </div>
  );
}

export const dexNo = (n: number) => `No.${String(n).padStart(4, "0")}`;

/** Where a Pokémon is from: a regional form's region, else its species' debut region. */
export function regionOf(m: LabMon): string {
  if (m.formKind === "regional") {
    const prefix = m.name.split(" ")[0];
    const r = { Alolan: "Alola", Galarian: "Galar", Hisuian: "Hisui", Paldean: "Paldea" }[prefix];
    if (r) return r;
  }
  return REGIONS[m.gen - 1] ?? "";
}

/** Headline size for a name (long names step down so they stay on one or two lines). */
function nameSize(name: string, phone: boolean) {
  const n = name.length;
  if (phone) return n > 18 ? "text-[26px]" : n > 12 ? "text-[30px]" : "text-[36px]";
  return n > 22 ? "text-[34px]" : n > 16 ? "text-[42px]" : n > 11 ? "text-[54px]" : "text-[68px]";
}

export function Heading({ mon, scanning, sort, phone = false }: { mon: LabMon; scanning: boolean; sort: SortKey; phone?: boolean }) {
  const badge = sortBadge(mon, sort);
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="hud-label !text-cyan-200/80">{S.specimen}</span>
        <span className="h-px w-8 bg-cyan-200/40" />
        <span className="font-pixel text-[11px] tracking-[0.14em] text-cyan-100">{dexNo(mon.species)}</span>
        <span className="ml-2 rounded-sm border border-cyan-200/30 px-1.5 py-[3px] font-pixel text-[8px] uppercase tracking-[0.16em] text-cyan-200/80" data-testid="lab-scan-state">
          {scanning ? S.materialising : S.scanComplete}
        </span>
      </div>
      <h1
        className={cn("mt-3 font-display font-bold uppercase leading-[0.92] tracking-[0.01em] text-white [text-shadow:0_2px_30px_rgba(0,0,0,0.75)]", nameSize(mon.name, phone))}
        data-testid="lab-name"
      >
        {mon.name}
      </h1>
      <p className="mt-2 text-[15px] font-medium text-white/75 [text-shadow:0_1px_12px_rgba(0,0,0,0.8)]">{mon.genus}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {mon.types.map((t) => <TypeBadge key={t} type={t} size={phone ? "md" : "lg"} />)}
        {badge !== null && (
          <span className="ml-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 font-display text-[12px] font-semibold uppercase tracking-wider text-white/85" data-testid="lab-sort-value">
            {SORT_TEXT[sort]} <b className="ml-1 tabular-nums text-white">{badge}</b>
          </span>
        )}
      </div>
    </div>
  );
}

function Section({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-cyan-200/10 px-4 py-3", className)}>
      <h2 className="hud-label !text-[9px] !text-cyan-200/70">{label}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Height, weight, region; the Pokédex entry; abilities; the evolution line; matchups. */
export function InfoCard({ mon, details, inView, onPick }: { mon: LabMon; details: LabDetails | null | undefined; inView: (id: number) => boolean; onPick: (id: number) => void }) {
  const col = typeColor(mon.types[0]);
  return (
    <div className={cn(glass, "overflow-hidden")} data-testid="lab-info">
      <div className="grid grid-cols-3 divide-x divide-cyan-200/10 py-3">
        {[
          [S.height, `${mon.heightM.toFixed(1)} m`],
          [S.weight, mon.weightKg == null ? S.unknown : `${mon.weightKg.toFixed(1)} kg`],
          [S.region, `${regionOf(mon)} · Gen ${GEN_NUMERALS[mon.gen - 1]}`],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 px-4">
            <p className="hud-label !text-[9px]">{k}</p>
            <p className="mt-1.5 truncate font-display text-[15px] font-semibold text-white" title={v}>{v}</p>
          </div>
        ))}
      </div>
      <Section label={S.entry}>
        {details === undefined ? (
          <div className="space-y-1.5" aria-hidden>
            <div className="h-3 w-full animate-pulse rounded bg-white/10" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-white/10" />
          </div>
        ) : details?.entry ? (
          <blockquote className="border-l-2 pl-3 text-[13.5px] leading-relaxed text-white/85" style={{ borderColor: col }} data-testid="lab-entry">
            {details.entry.text}
            {details.entry.games.length > 0 && <footer className="mt-1 font-pixel text-[8px] uppercase tracking-[0.14em] text-white/40">{details.entry.games.join(" · ")}</footer>}
          </blockquote>
        ) : (
          <p className="text-[13px] text-white/50">—</p>
        )}
      </Section>
      {details?.abilities && details.abilities.length > 0 && (
        <Section label={S.abilities}>
          <ul className="space-y-1.5">
            {details.abilities.map((a) => (
              <li key={a.name} className="text-[12.5px] leading-snug text-white/70">
                <span className="font-semibold text-white">{a.name}</span>
                {a.hidden && <span className="ml-1.5 rounded-sm border border-white/15 px-1 py-px font-pixel text-[7.5px] uppercase tracking-[0.14em] text-white/55">{S.hidden}</span>}
                {a.effect && <span className="text-white/60"> · {a.effect}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section label={S.evolution}>
        {details === undefined ? (
          <div className="h-14 animate-pulse rounded bg-white/5" aria-hidden />
        ) : details?.evolution ? (
          <EvolutionStrip root={details.evolution} current={mon.isForm ? mon.species : mon.id} inView={inView} onPick={onPick} />
        ) : (
          <p className="text-[12.5px] text-white/55">{S.noEvolution}</p>
        )}
      </Section>
      <Section label={S.matchups}>
        <Matchups types={mon.types} />
      </Section>
    </div>
  );
}

/** The evolution line as columns of stages (branches stack), each a button that takes the wheel there. */
export function EvolutionStrip({ root, current, inView, onPick }: { root: LabEvoNode; current: number; inView: (id: number) => boolean; onPick: (id: number) => void }) {
  const stages: LabEvoNode[][] = [];
  const walk = (n: LabEvoNode, d: number) => {
    (stages[d] ??= []).push(n);
    n.children.forEach((c) => walk(c, d + 1));
  };
  walk(root, 0);
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1" data-testid="lab-evolution">
      {stages.map((stage, d) => (
        <div key={d} className="flex items-center gap-1">
          {d > 0 && <ChevronRight className="h-4 w-4 shrink-0 text-cyan-200/40" aria-hidden />}
          <div className="flex flex-col gap-1">
            {stage.map((n) => {
              const here = n.id === current;
              const ok = inView(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  disabled={here || !ok}
                  onClick={() => onPick(n.id)}
                  title={!ok ? S.notInView : n.conditions.join(", ") || n.name}
                  aria-label={S.evoJump(n.name)}
                  aria-current={here ? "true" : undefined}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-md border px-1 py-0.5 pr-2 text-left transition-colors",
                    here ? "border-cyan-200/50 bg-cyan-200/10" : "border-white/10 bg-white/[0.03] hover:border-cyan-200/40 hover:bg-white/[0.07]",
                    !ok && !here && "opacity-45"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/sizes/art/256/${n.id}.webp`} alt="" width={32} height={32} loading="lazy" className="h-8 w-8 object-contain" />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[11.5px] font-semibold uppercase tracking-wide text-white">{n.name}</span>
                    {n.conditions[0] && <span className="block max-w-[110px] truncate text-[10px] leading-tight text-white/50">{n.conditions[0]}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const MULT: Record<number, string> = { 4: "×4", 2: "×2", 0.5: "×½", 0.25: "×¼", 0: "×0" };

export function Matchups({ types }: { types: string[] }) {
  const prof = defensiveProfile(types as PokemonType[]);
  const rows: [string, [string, number][]][] = [
    [S.weakTo, [...prof].filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1])],
    [S.resists, [...prof].filter(([, v]) => v > 0 && v < 1).sort((a, b) => a[1] - b[1])],
    [S.immune, [...prof].filter(([, v]) => v === 0)],
  ];
  return (
    <div className="space-y-2" data-testid="lab-matchups">
      {rows.map(([label, list]) =>
        list.length ? (
          <div key={label} className="grid grid-cols-[64px_1fr] items-start gap-2">
            <span className="pt-1 font-pixel text-[8.5px] uppercase tracking-[0.14em] text-white/50">{label}</span>
            <div className="flex flex-wrap gap-1">
              {list.map(([t, v]) => (
                <span key={t} className="inline-flex items-center gap-1">
                  <TypeBadge type={t} size="sm" />
                  {v !== 2 && v !== 0.5 && <span className="font-display text-[10px] font-bold text-white/80">{MULT[v]}</span>}
                </span>
              ))}
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}

/** Six base stats on a hexagon: HP at the top, then clockwise Attack, Defense, Speed, Sp. Def, Sp. Atk. */
export function Radar({ stats, color, size = 200 }: { stats: number[]; color: string; size?: number }) {
  const order = [0, 1, 2, 5, 4, 3];
  const R = 92, C = 110, MAX = 160;
  const pt = (k: number, v: number) => {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    const r = (Math.min(MAX, v) / MAX) * R;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
  };
  const ring = (f: number) => order.map((_, k) => pt(k, MAX * f).join(",")).join(" ");
  const shape = order.map((i, k) => pt(k, stats[i]).join(",")).join(" ");
  return (
    <svg viewBox="0 0 220 220" style={{ width: size, height: size }} className="overflow-visible" role="img" aria-label={stats.map((v, i) => `${STAT_LABELS[i]} ${v}`).join(", ")}>
      <defs>
        <radialGradient id="lab-radar-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0.5" />
        </radialGradient>
        <filter id="lab-radar-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill={f === 1 ? "rgba(126,232,255,0.04)" : "none"} stroke="rgba(126,232,255,0.22)" strokeWidth={f === 1 ? 1.2 : 0.8} strokeDasharray={f === 1 ? undefined : "2 3"} />
      ))}
      {order.map((_, k) => {
        const [x, y] = pt(k, MAX);
        return <line key={k} x1={C} y1={C} x2={x} y2={y} stroke="rgba(126,232,255,0.16)" strokeWidth={0.8} />;
      })}
      <polygon points={shape} fill="url(#lab-radar-fill)" stroke={color} strokeWidth={2} strokeLinejoin="round" filter="url(#lab-radar-glow)" className="transition-all duration-500" />
      {order.map((i, k) => {
        const [x, y] = pt(k, stats[i]);
        return <circle key={k} cx={x} cy={y} r={3} fill="#fff" stroke={color} strokeWidth={1.5} />;
      })}
      {order.map((i, k) => {
        const [x, y] = pt(k, MAX * 1.2);
        return (
          <g key={`l${k}`}>
            <text x={x} y={y - 5} textAnchor="middle" className="fill-cyan-100/60 font-pixel" fontSize="8.5" letterSpacing="1">{STAT_SHORT[i]}</text>
            <text x={x} y={y + 8} textAnchor="middle" className="fill-white font-display" fontSize="12" fontWeight="700">{stats[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function BaseStats({ mon, radar = 200 }: { mon: LabMon; radar?: number }) {
  const col = typeColor(mon.types[0]);
  return (
    <div data-testid="lab-stats">
      <div className="flex justify-center">
        <Radar stats={mon.stats} color={col} size={radar} />
      </div>
      <div className="mt-2 space-y-[7px]">
        {mon.stats.map((v, i) => (
          <div key={i} className="grid grid-cols-[62px_34px_1fr] items-center gap-2">
            <span className="font-pixel text-[9px] uppercase tracking-[0.12em] text-white/60">{STAT_LABELS[i]}</span>
            <span className="text-right font-display text-[14px] font-bold tabular-nums text-white">{v}</span>
            <span className="relative h-[7px] overflow-hidden rounded-full bg-white/[0.07]">
              <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, (v / 200) * 100)}%`, background: `linear-gradient(90deg, ${col}99, ${col})`, boxShadow: `0 0 10px ${col}88` }} />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-end justify-between border-t border-cyan-200/10 pt-3">
        <span className="hud-label">{S.total}</span>
        <span className="font-display text-[30px] font-bold leading-none tabular-nums text-white" data-testid="lab-total">{mon.bst}</span>
      </div>
    </div>
  );
}

/** The five battle roles (the owner's formulas), each ranked against every Pokémon: the score, a bar, the real percentile; the best one lit. */
export function Roles({ mon, table, withForms }: { mon: LabMon; table: RoleTable; withForms: boolean }) {
  const col = typeColor(mon.types[0]);
  const { roles, best } = standings(mon, table);
  return (
    <div data-testid="lab-roles">
      <ul className="space-y-2.5">
        {ROLES.map((r, i) => {
          const s = roles[i];
          const pc = percentileParts(s);
          const isBest = r.key === best;
          return (
            <li
              key={r.key}
              className={cn("rounded-lg border px-3 py-2.5 transition-colors", isBest ? "border-transparent" : "border-white/[0.06] bg-white/[0.02]")}
              style={isBest ? { background: `linear-gradient(90deg, ${col}2e, ${col}0d)`, boxShadow: `inset 0 0 0 1px ${col}99, 0 0 24px -8px ${col}` } : undefined}
              data-testid={`lab-role-${r.param}`}
              data-best={isBest ? "1" : undefined}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-display text-[13.5px] font-bold uppercase tracking-wide text-white">
                    {ROLE_TEXT[r.key].name}
                    {isBest && <span className="rounded-sm px-1.5 py-px font-pixel text-[7.5px] uppercase tracking-[0.14em] text-[#04121c]" style={{ background: col }}>{S.bestRole}</span>}
                  </p>
                  <p className="text-[10.5px] text-white/50">{ROLE_TEXT[r.key].formula}</p>
                </div>
                <span className="font-display text-[20px] font-bold tabular-nums leading-none text-white">{s.score}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="relative h-[6px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.max(2, s.bar * 100)}%`, background: isBest ? col : `${col}b0`, boxShadow: isBest ? `0 0 10px ${col}` : undefined }} />
                </span>
                <span className={cn("w-[86px] text-right font-pixel text-[8.5px] uppercase tracking-[0.1em]", pc.side === "top" ? "text-white/85" : "text-white/45")} data-testid="lab-role-pct">
                  {pc.side === "top" ? S.top(pc.value) : S.bottom(pc.value)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[10.5px] leading-snug text-white/45">{withForms ? S.rolesNoteForms : S.rolesNote}</p>
    </div>
  );
}

export function OpenInDex({ mon, className }: { mon: LabMon; className?: string }) {
  return (
    <Link
      href={`/pokemon/${mon.slug}`}
      className={cn("inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] transition-transform active:translate-y-[2px] active:shadow-[0_2px_0_hsl(var(--primary-shadow))]", className)}
      data-testid="lab-open-dex"
    >
      {S.openInDex} <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

export type StatsTab = "stats" | "roles";

export function StatsTabs({ tab, onTab, idBase }: { tab: StatsTab; onTab: (t: StatsTab) => void; idBase: string }) {
  const tabs: [StatsTab, string][] = [["stats", S.baseStats], ["roles", S.roles]];
  return (
    <div role="tablist" aria-label={S.baseStats} className="flex rounded-lg border border-white/10 bg-black/30 p-1">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          id={`${idBase}-tab-${k}`}
          aria-selected={tab === k}
          aria-controls={`${idBase}-panel`}
          onClick={() => onTab(k)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              e.stopPropagation();
              const next = k === "stats" ? "roles" : "stats";
              onTab(next);
              document.getElementById(`${idBase}-tab-${next}`)?.focus();
            }
          }}
          data-testid={`lab-tab-${k}`}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 font-display text-[12px] font-semibold uppercase tracking-wider transition-colors",
            tab === k ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
