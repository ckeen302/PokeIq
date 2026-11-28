"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { displayName, type Death, type Run, type RunMon } from "@/lib/nuzlocke/run";
import { allAreas, allBosses, type GameView } from "@/lib/nuzlocke/view";
import { Modal } from "../tier-list/ui";
import { Sprite, type NuzT } from "./parts";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Where" can be an area or a boss fight: a boss is kept as "boss:<key>". */
export const BOSS_PREFIX = "boss:";

/** Where a Pokémon fell: an area, or a boss fight. */
export function whereFell(view: GameView, where: string | undefined): { area: string } | { boss: string } | null {
  if (!where) return null;
  if (where.startsWith(BOSS_PREFIX)) {
    const b = allBosses(view).find((x) => x.key === where.slice(BOSS_PREFIX.length));
    return b ? { boss: b.name } : null;
  }
  const a = allAreas(view).find((x) => x.id === where);
  return a ? { area: a.name } : null;
}

/** The last place logged, in story order: most likely where the run is now. */
function lastPlace(run: Run, view: GameView): string {
  let last = "";
  for (const s of view.steps) {
    if (s.type === "area" && run.areas[s.area.id]) last = s.area.id;
    if (s.type === "boss" && run.beaten.includes(s.boss.key)) last = `${BOSS_PREFIX}${s.boss.key}`;
  }
  return last;
}

/**
 * Marking a Pokémon dead: a small form, all of it optional (what fainted it, a Pokémon or anything typed; where; its
 * level). It then rests in the graveyard.
 */
export function DeathDialog({ t, run, view, mon, onClose, onConfirm }: { t: NuzT; run: Run; view: GameView; mon: RunMon; onClose(): void; onConfirm(d: Omit<Death, "at">): void }) {
  const name = displayName(mon, view.mons[mon.mon]);
  const [by, setBy] = useState<number | null>(null);
  const [byText, setByText] = useState("");
  const [where, setWhere] = useState(() => lastPlace(run, view));
  const [level, setLevel] = useState(mon.level ? String(mon.level) : "");
  const [focus, setFocus] = useState(false);
  const q = fold(byText.trim());
  const suggestions = useMemo(() => (q.length < 2 || by ? [] : view.dex.filter(([, n]) => fold(n).includes(q)).sort((a, b) => Number(!fold(b[1]).startsWith(q)) - Number(!fold(a[1]).startsWith(q)) || a[0] - b[0]).slice(0, 6)), [q, by, view.dex]);
  const byName = by ? view.dex.find(([id]) => id === by)?.[1] : null;
  const places: { id: string; label: string }[] = [];
  for (const s of view.steps) places.push(s.type === "area" ? { id: s.area.id, label: s.area.name } : { id: `${BOSS_PREFIX}${s.boss.key}`, label: t("death.whereBoss", { boss: s.boss.name }) });
  for (const a of view.extra) places.push({ id: a.id, label: a.name });

  const submit = () => {
    const lv = Number(level);
    onConfirm({ ...(by && { by }), ...(!by && byText.trim() && { byText: byText.trim() }), ...(where && { area: where }), ...(Number.isInteger(lv) && lv >= 1 && lv <= 100 && { level: lv }) });
  };

  return (
    <Modal title={t("death.title", { name })} onClose={onClose} closeLabel={t("death.cancel")} testId="nz-death">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-3 rounded-2xl bg-foreground/[0.04] p-3">
          <Sprite art={view.mons[mon.mon]?.art} dim className="h-14 w-14 shrink-0" />
          <p tabIndex={-1} data-autofocus className="text-[14px] leading-snug text-muted-foreground outline-none">{t("death.lead", { name })}</p>
        </div>

        <div className="relative space-y-2">
          <label htmlFor="nz-death-by" className="block text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("death.by")}
          </label>
          {by && byName ? (
            <div className="flex h-12 items-center gap-2 rounded-2xl border border-foreground/[0.12] bg-background pl-1.5 pr-1.5">
              <Sprite art={by} className="h-10 w-10 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" data-testid="nz-death-by-name">{byName}</span>
              <button type="button" onClick={() => (setBy(null), setByText(""))} aria-label={t("death.byClear")} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : (
            <input
              id="nz-death-by"
              value={byText}
              onChange={(e) => setByText(e.target.value)}
              onFocus={() => setFocus(true)}
              onBlur={() => window.setTimeout(() => setFocus(false), 150)}
              placeholder={t("death.byPlaceholder")}
              maxLength={60}
              autoComplete="off"
              role="combobox"
              aria-expanded={focus && suggestions.length > 0}
              aria-controls="nz-death-list"
              className="h-12 w-full rounded-2xl border border-foreground/[0.12] bg-background px-4 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="nz-death-by"
            />
          )}
          {focus && suggestions.length > 0 && (
            <ul id="nz-death-list" role="listbox" className="nz-pop absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-foreground/[0.1] bg-card p-1 shadow-[0_18px_40px_-14px_hsl(var(--shade)/0.7)]">
              {suggestions.map(([id, n]) => (
                <li key={id} role="option" aria-selected={false}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (setBy(id), setFocus(false))} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 text-left text-[14.5px] font-semibold hover:bg-foreground/[0.06]" data-testid={`nz-death-pick-${id}`}>
                    <Sprite art={id} className="h-9 w-9 shrink-0" />
                    {n}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
          <label className="block space-y-2">
            <span className="block text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("death.where")}</span>
            <select value={where} onChange={(e) => setWhere(e.target.value)} className="h-12 w-full rounded-2xl border border-foreground/[0.12] bg-background px-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-death-where">
              <option value="">{t("death.whereNone")}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-2">
            <span className="block text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("death.level")}</span>
            <input type="number" inputMode="numeric" min={1} max={100} value={level} onChange={(e) => setLevel(e.target.value)} className="h-12 w-full rounded-2xl border border-foreground/[0.12] bg-background px-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-death-level" />
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-12 flex-1 rounded-full bg-foreground/[0.07] text-[15px] font-bold hover:bg-foreground/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("death.cancel")}
          </button>
          <button type="submit" className={cn("h-12 flex-[1.4] rounded-full bg-destructive text-[15px] font-bold text-destructive-foreground shadow-[0_3px_0_hsl(0_70%_32%)] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px")} data-testid="nz-death-confirm">
            {t("death.confirm")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
