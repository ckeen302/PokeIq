"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowRight, Check, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import picker from "@/messages/favorite-picker";
import { typeColor } from "@/lib/pokemon/type-colors";
import { ALL_POOL, FORM_KINDS, POOL_CATEGORIES, formBit, poolMons, typeBit, type PoolConfig } from "@/lib/favorite-picker/pool";
import { BRACKET_MAX, KEEP } from "@/lib/favorite-picker/run";
import { GENERATIONS, TYPES, type Mon } from "@/lib/tier-list/types";
import { PillButton } from "../tier-list/ui";
import { typeName } from "./common";

/** The start screen: which Pokémon take part. */

function Chip({ on, onClick, children, testId, dot }: { on: boolean; onClick(): void; children: ReactNode; testId?: string; dot?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10",
        on ? "border-primary/50 bg-primary/[0.14] text-foreground" : "border-foreground/[0.09] text-muted-foreground hover:border-foreground/20 hover:text-foreground"
      )}
    >
      {dot && <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} aria-hidden />}
      {on && !dot && <Check className="h-3.5 w-3.5" aria-hidden />}
      {children}
    </button>
  );
}

function Group({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div role="group" aria-labelledby={id} className="space-y-2.5">
      <p id={id} className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {hint && <p className="-mt-1 text-[13px] text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

const toggle = (mask: number, bit: number, all: number) => {
  const next = mask ^ bit;
  return next === all ? 0 : next;
};

export function Setup({ mons, pool, onChange, onStart, lastFavorite, onShowLast }: { mons: readonly Mon[]; pool: PoolConfig; onChange(p: PoolConfig): void; onStart(): void; lastFavorite: Mon | null; onShowLast(): void }) {
  const t = useT(picker);
  const count = useMemo(() => poolMons(mons, pool).length, [mons, pool]);
  const allGens = 2 ** GENERATIONS.length - 1;
  const allTypes = 2 ** TYPES.length - 1;
  const filtered = pool.gens || pool.types || pool.cat !== "all" || pool.forms;
  return (
    <section className="rounded-[28px] border border-foreground/[0.08] bg-card p-7 shadow-[0_20px_60px_-40px_hsl(var(--shade)/0.6)] max-sm:rounded-[22px] max-sm:p-5" data-testid="fp-setup">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[26px] font-semibold tracking-tight max-sm:text-[22px]">{t("setup.title")}</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">{t("setup.hint")}</p>
        </div>
        {lastFavorite && (
          <button type="button" onClick={onShowLast} className="inline-flex h-10 items-center gap-2 rounded-full bg-[hsl(var(--warning)/0.14)] px-4 text-sm font-semibold text-foreground hover:bg-[hsl(var(--warning)/0.22)]" data-testid="fp-last">
            <Crown className="h-4 w-4 text-[hsl(var(--warning))]" aria-hidden /> {t("setup.lastResult")}
          </button>
        )}
      </div>

      <div className="mt-7 space-y-6">
        <Group label={t("setup.gens")} id="fp-gens">
          <Chip on={!pool.gens} onClick={() => onChange({ ...pool, gens: 0 })} testId="fp-gen-all">
            {t("setup.all")}
          </Chip>
          {GENERATIONS.map((g) => (
            <Chip key={g} on={!!(pool.gens & (1 << (g - 1)))} onClick={() => onChange({ ...pool, gens: toggle(pool.gens, 1 << (g - 1), allGens) })} testId={`fp-gen-${g}`}>
              {t("setup.genN", { n: g })}
            </Chip>
          ))}
        </Group>
        <Group label={t("setup.types")} id="fp-types">
          <Chip on={!pool.types} onClick={() => onChange({ ...pool, types: 0 })} testId="fp-type-all">
            {t("setup.all")}
          </Chip>
          {TYPES.map((ty) => (
            <Chip key={ty} on={!!(pool.types & typeBit(ty))} dot={typeColor(ty)} onClick={() => onChange({ ...pool, types: toggle(pool.types, typeBit(ty), allTypes) })} testId={`fp-type-${ty}`}>
              {typeName(t, ty)}
            </Chip>
          ))}
        </Group>
        <Group label={t("setup.category")} id="fp-cat">
          {POOL_CATEGORIES.map((c) => (
            <Chip key={c} on={pool.cat === c} onClick={() => onChange({ ...pool, cat: c })} testId={`fp-cat-${c}`}>
              {t(`setup.categories.${c}`)}
            </Chip>
          ))}
        </Group>
        <Group label={t("setup.forms")} hint={t("setup.formsHint")} id="fp-forms">
          {FORM_KINDS.map((f) => (
            <Chip key={f} on={!!(pool.forms & formBit(f))} onClick={() => onChange({ ...pool, forms: pool.forms ^ formBit(f) })} testId={`fp-form-${f}`}>
              {t(`setup.formKinds.${f}`)}
            </Chip>
          ))}
        </Group>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-foreground/[0.07] pt-6">
        <div className="min-w-0">
          <p className={cn("font-display text-lg font-semibold", !count && "text-destructive")} data-testid="fp-count" data-count={count}>
            {count ? t("setup.count", { n: count }) : t("setup.empty")}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t("setup.how", { keep: KEEP, max: BRACKET_MAX })}</p>
        </div>
        <div className="flex items-center gap-2 max-sm:w-full">
          {filtered ? (
            <PillButton onClick={() => onChange(ALL_POOL)} className="max-sm:flex-1">
              {t("setup.reset")}
            </PillButton>
          ) : null}
          <PillButton primary onClick={onStart} disabled={!count} className="h-12 px-6 text-[15px] max-sm:flex-1 max-md:h-12" testId="fp-start">
            {t("setup.start")} <ArrowRight className="h-4 w-4" aria-hidden />
          </PillButton>
        </div>
      </div>
    </section>
  );
}
