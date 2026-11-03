"use client";

import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { ITEM_GROUPS, MAX_MOVES, NATURE_NAMES, NATURES, clampLevel, defaultMoves, moveIndex, natureName, resolveSet } from "@/lib/mass-battle/sets";
import { battleStats } from "@/lib/mass-battle/stats";
import { EV_LABEL, EV_PRESETS, TYPE_NAMES, type EvPreset, type ItemPolicy, type MBMove, type MBSpecies, type SetChoice } from "@/lib/mass-battle/types";
import { cn } from "@/lib/utils";

const STAT_SHORT: Record<string, string> = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
const natureHint = (n: string) => {
  const x = NATURES[n];
  return x ? `${n} +${STAT_SHORT[x[0]]} −${STAT_SHORT[x[1]]}` : n;
};
const EV_SHORT: Record<EvPreset, string> = { random: "85 each", offence: "Max offence", bulk: "Max bulk" };

/**
 * One species' set in the Battle setup's Advanced section: level, up to
 * four moves (its random-battle set's or any it can legally learn),
 * ability, held item (those the battle models), nature, an EV and IV
 * spread and a Tera type. Anything left alone is the default, shown as
 * such; for a group only what applies to all its species is offered.
 */
export function SetEditor({ species, moves, learnset, level, items, value, onChange, group, idPrefix }: {
  /** Null for a group. */
  species: MBSpecies | null;
  moves: MBMove[];
  learnset: number[] | null;
  level: number;
  items: ItemPolicy;
  value: SetChoice | undefined;
  onChange(v: SetChoice | undefined): void;
  group?: boolean;
  idPrefix: string;
}) {
  const v = useMemo(() => value ?? {}, [value]);
  const set = (patch: Partial<SetChoice>) => {
    const next: SetChoice = { ...v, ...patch };
    for (const k of Object.keys(next) as (keyof SetChoice)[]) if (next[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const lv = clampLevel(v.level ?? level);
  const resolved = useMemo(() => (species ? resolveSet(species, { moves }, v, level, items) : null), [species, moves, v, level, items]);
  const defaults = useMemo(() => (species ? defaultMoves(species, moves, lv).map((m) => m.name) : []), [species, moves, lv]);
  const options = useMemo(() => {
    if (!species) return null;
    const rb = (species.randbats ?? []).map((i) => moves[i]).filter(Boolean);
    const lu = species.levelUp.filter(([, at]) => at <= lv).map(([i]) => moves[i]).filter(Boolean);
    const seen = new Set([...rb, ...lu].map((m) => m.name));
    const rest = (learnset ?? []).map((i) => moves[i]).filter((m) => m && !seen.has(m.name));
    return { rb, lu: lu.filter((m) => !rb.some((r) => r.name === m.name)), rest };
  }, [species, moves, learnset, lv]);
  // A link carries ids ("thunderbolt", "hugepower"): shown by their names.
  const byName = useMemo(() => moveIndex(moves), [moves]);
  const toId = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const chosen = (v.moves?.length ? v.moves : defaults).map((m) => byName.get(toId(m))?.name ?? m);
  const ability = species ? species.abilities.find((a) => toId(a) === toId(v.ability ?? "")) ?? species.ability : "";
  const stats = species && resolved ? battleStats(species, resolved) : null;
  const label = "font-pixel text-[9px] uppercase tracking-[0.18em] text-muted-foreground";
  const select = "mt-1 h-10 w-full min-w-0 rounded-md border bg-card px-2 text-sm";
  const mega = species?.form === "mega";
  const moveOption = (m: MBMove) => (
    <option key={m.name} value={m.name}>
      {m.name} · {m.type} {m.bp ? m.bp : "—"}
    </option>
  );

  return (
    <div className="space-y-3 rounded-lg border border-dashed bg-background/40 p-3" data-testid={`${idPrefix}-set`}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label} htmlFor={`${idPrefix}-level`}>Level</label>
          <input
            id={`${idPrefix}-level`}
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={v.level ?? ""}
            placeholder={`${level}`}
            onChange={(e) => set({ level: e.target.value === "" ? undefined : clampLevel(Number(e.target.value)) })}
            className={cn(select, "tabular-nums")}
            data-testid={`${idPrefix}-level`}
          />
        </div>
        <div>
          <label className={label} htmlFor={`${idPrefix}-evs`}>EVs and IVs</label>
          <select id={`${idPrefix}-evs`} value={v.evs ?? "random"} onChange={(e) => set({ evs: e.target.value === "random" ? undefined : (e.target.value as EvPreset) })} className={select} data-testid={`${idPrefix}-evs`}>
            {EV_PRESETS.map((p) => <option key={p} value={p} title={EV_LABEL[p]}>{EV_SHORT[p]}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`${idPrefix}-nature`}>Nature</label>
          <select id={`${idPrefix}-nature`} value={natureName(v.nature)} onChange={(e) => set({ nature: e.target.value === "Hardy" ? undefined : e.target.value })} className={select} data-testid={`${idPrefix}-nature`}>
            {NATURE_NAMES.map((n) => <option key={n} value={n}>{natureHint(n)}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`${idPrefix}-tera`}>Tera type</label>
          <select id={`${idPrefix}-tera`} value={v.tera ?? ""} onChange={(e) => set({ tera: e.target.value || undefined })} className={select} data-testid={`${idPrefix}-tera`}>
            <option value="">No Tera</option>
            {TYPE_NAMES.map((t) => <option key={t} value={t}>{t}{species?.tera.includes(t) ? " (set's)" : ""}</option>)}
          </select>
        </div>
      </div>

      {!group && species && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor={`${idPrefix}-ability`}>Ability</label>
            <select id={`${idPrefix}-ability`} value={ability} onChange={(e) => set({ ability: e.target.value === species.ability ? undefined : e.target.value })} className={select} data-testid={`${idPrefix}-ability`}>
              {species.abilities.map((a) => <option key={a} value={a}>{a}{a === species.ability ? " (default)" : ""}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor={`${idPrefix}-item`}>Held item</label>
            <select
              id={`${idPrefix}-item`}
              value={mega ? "" : v.item ?? (items === "sets" ? species.item : "")}
              disabled={mega}
              onChange={(e) => set({ item: e.target.value === (items === "sets" ? species.item : "") ? undefined : e.target.value })}
              className={select}
              data-testid={`${idPrefix}-item`}
            >
              <option value="">{mega ? "Its Mega Stone" : "None"}</option>
              {ITEM_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((it) => <option key={it} value={it}>{it}{it === species.item ? " (its set's)" : ""}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      )}

      {group && (
        <div>
          <label className={label} htmlFor={`${idPrefix}-item`}>Held item (every species)</label>
          <select id={`${idPrefix}-item`} value={v.item ?? ""} onChange={(e) => set({ item: e.target.value === "" ? undefined : e.target.value })} className={select} data-testid={`${idPrefix}-item`}>
            <option value="">{items === "sets" ? "Each one's random-battle item" : "None"}</option>
            {ITEM_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((it) => <option key={it} value={it}>{it}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {!group && species && options && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className={label}>Moves {v.moves?.length ? "" : `(default: ${species.source === "randbats" ? "its random-battle set" : `learnt by level ${lv}`})`}</span>
            {v.moves?.length ? (
              <button type="button" onClick={() => set({ moves: undefined })} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid={`${idPrefix}-moves-reset`}>
                <RotateCcw className="h-3 w-3" aria-hidden /> Default moves
              </button>
            ) : null}
          </div>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {Array.from({ length: MAX_MOVES }, (_, k) => (
              <select
                key={k}
                aria-label={`Move ${k + 1}`}
                value={chosen[k] ?? ""}
                onChange={(e) => {
                  const next = [...chosen];
                  next[k] = e.target.value;
                  const clean = next.filter((m, i) => m && next.indexOf(m) === i);
                  set({ moves: clean.length ? clean : undefined });
                }}
                className={select}
                data-testid={`${idPrefix}-move-${k}`}
              >
                <option value="">—</option>
                {options.rb.length > 0 && <optgroup label="Random-battle set">{options.rb.map(moveOption)}</optgroup>}
                {options.lu.length > 0 && <optgroup label={`Learnt by level ${lv}`}>{options.lu.map(moveOption)}</optgroup>}
                {options.rest.length > 0 && <optgroup label="Its other legal moves">{options.rest.map(moveOption)}</optgroup>}
                {learnset === null && <option disabled>Loading its learnset…</option>}
              </select>
            ))}
          </div>
          {!chosen.length && <p className="mt-1 text-xs text-destructive">It has no attacking moves the battle plays: pick one.</p>}
        </div>
      )}

      {stats && resolved && (
        <p className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground" data-testid={`${idPrefix}-stats`}>
          Level {resolved.level} · HP {stats.hp} · Atk {stats.atk} · Def {stats.def} · SpA {stats.spa} · SpD {stats.spd} · Spe {stats.spe}
          {resolved.item ? ` · ${resolved.item}` : ""}
          {resolved.tera ? ` · Tera ${resolved.tera}` : ""}
        </p>
      )}
    </div>
  );
}
