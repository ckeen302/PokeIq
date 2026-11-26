"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Plus, RotateCcw, Share2 } from "lucide-react";
import { useT } from "@/i18n/client";
import msgs from "@/messages/catch-rate";
import { blockedIn, GAMES, lowLevelBonus, STATUSES, SWSH_CAP, type BallId, type GameId, type Status } from "@/lib/catch-rate/formula";
import { DEFAULT_INPUTS, encodeInputs, MAX_LEVEL, type Inputs } from "@/lib/catch-rate/link";
import { rank, type Ranking } from "@/lib/catch-rate/rank";
import { typeColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";
import { BattleScene } from "./BattleScene";
import { Bag, type Within } from "./Bag";
import type { Place } from "./Backdrop";
import { HpBar } from "./HpBar";
import { nameOf, PokemonPicker, rateBand, type Names } from "./PokemonPicker";
import { SituationButton, SituationSheet, type DarkKind } from "./Situation";
import { pct } from "./format";

type T = ReturnType<typeof useT<typeof msgs.en>>;
/** A translator for keys built at run time (status and game ids). */
const dyn = (t: T) => t as unknown as (key: string, values?: Record<string, string | number>) => string;

const STATUS_COLOUR: Record<Exclude<Status, "none">, string> = { sleep: "#a3a5b8", freeze: "#6fd3f0", paralysis: "#f2cf35", poison: "#bf6ad6", burn: "#f6824a" };

/** Each game's two colours (its box art and logo), for its chip. */
const GAME_COLOURS: Record<GameId, [string, string]> = {
  sv: ["#e8323c", "#8a3fd1"],
  swsh: ["#00a3e8", "#e6007e"],
  usum: ["#f08a1c", "#6d5ae0"],
  sm: ["#f4a72a", "#3d7fe0"],
  oras: ["#d23a2a", "#2f62c8"],
  xy: ["#2569d6", "#d8304a"],
  bw: ["#26262e", "#aeb2c0"],
  hgss: ["#d8a51c", "#98a2b8"],
  dppt: ["#3f7fe0", "#e57fa8"],
  rse: ["#d0453a", "#3a66c8"],
};

export interface CatchRateAppProps extends Names {
  initial: Inputs | null;
  ballNames: Record<BallId, string>;
}

export default function CatchRateApp({ initial, ballNames, names, alt }: CatchRateAppProps) {
  const t = useT(msgs);
  const locale = t.locale;
  const [inputs, setInputs] = useState<Inputs>(initial ?? DEFAULT_INPUTS);
  const [touched, setTouched] = useState(false);
  const [n, setN] = useState<Within>(5);
  const [chosen, setChosen] = useState<BallId | null>(null);
  const [shot, setShot] = useState(0);
  const [kind, setKind] = useState<DarkKind>("night");
  const [sheet, setSheet] = useState(false);
  const [note, setNote] = useState("");
  const local = useMemo(() => ({ names, alt }), [names, alt]);
  const r = useMemo(() => rank(inputs), [inputs]);
  const sceneRef = useRef<HTMLDivElement>(null);
  const sheetButton = useRef<HTMLDivElement>(null);

  const set = useCallback((patch: Partial<Inputs>) => {
    setInputs((i) => ({ ...i, ...patch }));
    setTouched(true);
  }, []);

  // The address keeps the inputs (once they're changed), so a reload or a copied link opens the same encounter.
  useEffect(() => {
    if (!touched) return;
    const h = setTimeout(() => window.history.replaceState(window.history.state, "", `${window.location.pathname}?${encodeInputs(inputs)}`), 250);
    return () => clearTimeout(h);
  }, [inputs, touched]);

  // The ball in hand: the one picked in the bag, or the best (it follows the best until one is picked).
  const available = r.balls.map((b) => b.ball);
  const throwing = chosen && (available.includes(chosen) || chosen === "master") ? chosen : r.best.ball;
  const throwResult = throwing === "master" ? r.master! : (r.balls.find((b) => b.ball === throwing) ?? r.best);

  // Picking a ball puts it in hand and throws it; on a phone the scene scrolls back into view first.
  const pick = (b: BallId) => {
    setChosen(b);
    const el = sceneRef.current;
    const box = el?.getBoundingClientRect();
    const away = box && (box.top < 40 || box.bottom > window.innerHeight);
    if (el && away) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      setTimeout(() => setShot((s) => s + 1), smooth ? 450 : 0);
    } else setShot((s) => s + 1);
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?${encodeInputs(inputs)}`;
    if (window.matchMedia("(pointer: coarse)").matches && navigator.share) {
      try {
        await navigator.share({ title: `${nameOf(r.species, local)}: ${pct(r.best.chance, locale)}`, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote(t("share.copied"));
    } catch {
      setNote(t("share.failed"));
    }
    setTimeout(() => setNote(""), 2400);
  };
  const reset = () => {
    setInputs(DEFAULT_INPUTS);
    setChosen(null);
    setTouched(false);
    window.history.replaceState(window.history.state, "", window.location.pathname);
  };
  const closeSheet = useCallback(() => {
    setSheet(false);
    sheetButton.current?.querySelector<HTMLButtonElement>("[data-testid=cr-situation-open]")?.focus({ preventScroll: true });
  }, []);

  // The screen reader hears the best ball once the inputs settle, not on every step of a drag.
  const liveText = t("results.live", { ball: ballNames[r.best.ball], pct: pct(r.best.chance, locale) });
  const [live, setLive] = useState(liveText);
  useEffect(() => {
    const h = setTimeout(() => setLive(liveText), 700);
    return () => clearTimeout(h);
  }, [liveText]);

  const species = r.species;
  const newer = species.gen > r.game.gen ? species.gen : null;
  const g = r.game.gen;
  const hasDusk = g >= 4;
  const dark = inputs.dark && hasDusk;
  const water = inputs.water || (inputs.fishing && g <= 8);
  const place: Place = water ? (dark ? "seaNight" : "sea") : dark ? kind : "day";
  const blocked = blockedIn(r.game, r.target, inputs);
  const sp = nameOf(species, local);
  const touchedAny = touched || !!initial;

  return (
    <div className="mt-6 max-sm:mt-5" data-testid="catch-rate-app">
      <GameStrip game={inputs.game} onPick={(id) => set({ game: id })} t={t} />
      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:gap-6">
        <div className="relative min-w-0 scroll-mt-20 lg:sticky lg:top-[72px]" ref={sceneRef}>
          <BattleScene
            place={place}
            darkGrass={g === 5 && inputs.darkGrass}
            speciesId={species.id}
            speciesName={sp}
            status={inputs.status}
            ball={throwing}
            ballName={ballNames[throwing]}
            th={throwResult.first}
            expected={throwResult.expected}
            shot={shot}
            blocked={
              blocked ? (
                <span className="text-[#ff8a95]" role="status" data-testid="cr-blocked">
                  {t("trainer.blocked", { badges: inputs.badges, max: SWSH_CAP[inputs.badges] })}
                </span>
              ) : null
            }
            hud={<Hud r={r} inputs={inputs} set={set} names={local} newer={newer} t={t} />}
          />
          <div className="mt-3 flex gap-2" ref={sheetButton}>
            <SituationButton r={r} inputs={inputs} set={set} kind={kind} setKind={setKind} open={sheet} onOpen={() => setSheet((o) => !o)} />
            <button
              type="button"
              onClick={share}
              className="inline-flex h-14 shrink-0 items-center gap-2 rounded-2xl border border-foreground/[0.09] bg-card px-4 text-[14px] font-semibold shadow-[0_10px_30px_-24px_hsl(var(--shade)/0.8)] transition-colors hover:border-foreground/[0.2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:w-14 max-sm:justify-center max-sm:px-0"
              aria-label={note || t("share.button")}
              data-testid="cr-share"
            >
              {note ? <Check className="h-[18px] w-[18px] text-[hsl(var(--success))]" aria-hidden /> : <Share2 className="h-[18px] w-[18px]" aria-hidden />}
              <span className="max-sm:hidden">{note || t("share.button")}</span>
            </button>
            {touchedAny && (
              <button
                type="button"
                onClick={reset}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-foreground/[0.09] bg-card text-muted-foreground shadow-[0_10px_30px_-24px_hsl(var(--shade)/0.8)] transition-colors hover:border-foreground/[0.2] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("share.reset")}
                title={t("share.reset")}
                data-testid="cr-reset"
              >
                <RotateCcw className="h-[18px] w-[18px]" aria-hidden />
              </button>
            )}
          </div>
          <SituationSheet r={r} inputs={inputs} set={set} kind={kind} setKind={setKind} open={sheet} onClose={closeSheet} />
        </div>
        <div className="min-w-0 scroll-mt-20" data-testid="cr-results">
          <Bag r={r} inputs={inputs} ballNames={ballNames} n={n} setN={setN} throwing={throwing} onPick={pick} />
        </div>
      </div>
      <p className="sr-only" aria-live="polite" data-testid="cr-live">
        {live}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The game picker

function GameStrip({ game, onPick, t }: { game: GameId; onPick(id: GameId): void; t: T }) {
  const td = dyn(t);
  const current = GAMES.find((x) => x.id === game) ?? GAMES[0];
  return (
    <div role="group" aria-labelledby="cr-game" data-testid="cr-games">
      <p className="mb-2 flex items-baseline gap-2 text-[12px]">
        <span id="cr-game" className="font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {t("game.label")}
        </span>
        <span className="min-w-0 truncate font-medium text-foreground/80" data-testid="cr-game-name">
          {td(`game.full.${current.id}`)} · {t("game.gen", { n: current.gen })}
        </span>
      </p>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto lg:gap-1 px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {GAMES.map((x) => {
          const [a, b] = GAME_COLOURS[x.id];
          const on = x.id === game;
          return (
            <button
              key={x.id}
              type="button"
              aria-pressed={on}
              aria-label={td(`game.full.${x.id}`)}
              onClick={() => onPick(x.id)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full pl-1 pr-3.5 text-[13px] lg:h-9 lg:gap-1.5 lg:pr-3 font-semibold transition-[background-color,box-shadow,transform,color] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                on ? "text-white [text-shadow:0_1px_1px_rgb(0_0_0/0.35)]" : "border border-foreground/[0.1] bg-card text-foreground/75 hover:border-foreground/[0.22] hover:text-foreground"
              )}
              style={on ? { background: `linear-gradient(120deg, ${a}, ${b})`, boxShadow: `0 8px 20px -8px ${a}, inset 0 -3px 0 rgb(0 0 0 / 0.18), inset 0 1px 0 rgb(255 255 255 / 0.3)` } : undefined}
              data-testid={`cr-game-${x.id}`}
            >
              <span
                className={cn("flex h-8 w-8 items-center justify-center rounded-full font-display text-[12px] lg:h-7 lg:w-7 lg:text-[11px] font-bold italic text-white [text-shadow:0_1px_1px_rgb(0_0_0/0.4)]", on ? "bg-white/20 ring-1 ring-white/40" : "")}
                style={on ? undefined : { background: `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)` }}
                aria-hidden
              >
                {x.gen}
              </span>
              {td(`game.short.${x.id}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The wild Pokémon's info box

function Hud({ r, inputs, set, names, newer, t }: { r: Ranking; inputs: Inputs; set(p: Partial<Inputs>): void; names: Names; newer: number | null; t: T }) {
  const td = dyn(t);
  const low = lowLevelBonus(inputs.level, r.game.gen);
  const hpOf = (f: number) => Math.max(1, Math.round(f * r.target.maxHp));
  const toPermille = (hp: number) => Math.max(1, Math.min(1000, Math.round((hp / r.target.maxHp) * 1000)));
  const presets: [string, number, string][] = [
    [t("hp.full"), r.target.maxHp, "full"],
    [t("hp.half"), hpOf(0.5), "half"],
    [t("hp.red"), hpOf(0.15), "red"],
    [t("hp.one"), 1, "one"],
  ];
  const types = r.species.types;
  const band = rateBand(r.target.rate);
  const clampLv = (v: number) => Math.min(MAX_LEVEL, Math.max(1, v));
  const lvBtn = "flex h-8 w-8 items-center justify-center rounded-lg bg-[#1d1b33]/[0.07] text-[#1d1b33] transition-colors hover:bg-[#1d1b33]/[0.14] active:scale-95 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]";
  const st = inputs.status;
  return (
    <div className="absolute inset-x-3 top-3 z-20 md:left-4 md:right-auto md:top-4 md:w-[380px]" data-testid="cr-hud" aria-label={t("pokemon.label")} role="group">
      <div className="relative rounded-[20px] bg-[#fbfaf5]/[0.96] py-3 pl-4 pr-3 text-[#1d1b33] shadow-[0_5px_0_rgb(24_20_60/0.35),0_24px_44px_-18px_rgb(0_0_0/0.65)] ring-1 ring-black/10 backdrop-blur [color-scheme:light]">
        <span className="absolute inset-y-3 left-0 w-[5px] rounded-r-full" style={{ background: `linear-gradient(180deg, ${typeColor(types[0])}, ${typeColor(types[1] ?? types[0])})` }} aria-hidden />
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <PokemonPicker species={r.species} names={names} onPick={(id) => set({ id })} />
            {st !== "none" && (
              <span className="shrink-0 rounded-md px-1.5 py-0.5 font-display text-[11px] font-bold italic leading-none text-black/80" style={{ background: STATUS_COLOUR[st] }} aria-hidden>
                {td(`status.abbr.${st}`)}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label={t("level.label")}>
            <span className="font-display text-[13px] font-bold italic text-[#1d1b33]/60" aria-hidden>
              Lv
            </span>
            <button type="button" className={lvBtn} onClick={() => set({ level: clampLv(inputs.level - 1) })} disabled={inputs.level <= 1} aria-label={t("level.down")} data-testid="cr-level-down">
              <Minus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_LEVEL}
              value={inputs.level}
              aria-label={t("level.label")}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && e.target.value !== "") set({ level: clampLv(Math.round(v)) });
              }}
              className="h-8 w-10 rounded-lg bg-transparent text-center font-display text-[20px] font-bold tabular-nums outline-none [appearance:textfield] focus:bg-[#1d1b33]/[0.07] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              data-testid="cr-level"
            />
            <button type="button" className={lvBtn} onClick={() => set({ level: clampLv(inputs.level + 1) })} disabled={inputs.level >= MAX_LEVEL} aria-label={t("level.up")} data-testid="cr-level-up">
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {types.map((ty) => (
            <span key={ty} className="rounded-full px-2 py-[3px] text-[10px] font-bold uppercase leading-none tracking-wide text-white [text-shadow:0_1px_1px_rgb(0_0_0/0.35)]" style={{ background: typeColor(ty) }}>
              {t(`typeNames.${ty}` as "typeNames.normal")}
            </span>
          ))}
          <span className="text-[11.5px] text-[#1d1b33]/60">
            {t("pokemon.catchRate")}{" "}
            <b className="font-display text-[13px] tabular-nums text-[#1d1b33]" data-testid="cr-species-rate">
              {r.target.rate}
            </b>
            <span className={cn("ml-1 font-semibold", band === "easy" ? "text-[#0f8a52]" : band === "medium" ? "text-[#a86a00]" : "text-[#d01e56]")}>· {t(`pokemon.${band}`)}</span>
          </span>
          {low > 1 && <span className="rounded-full bg-[#0f8a52]/[0.12] px-1.5 py-px text-[10.5px] font-bold text-[#0f8a52]">{t("level.lowBonus", { n: new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(low) })}</span>}
        </div>
        <div className="mt-2.5">
          <HpBar hp={r.target.hp} max={r.target.maxHp} onChange={(hp) => set({ hp: toPermille(hp) })} locale={t.locale} />
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {presets.map(([label, hp, key]) => (
            <button
              key={key}
              type="button"
              aria-pressed={r.target.hp === hp}
              aria-label={key === "one" ? `${label}: ${t("hp.oneHint")}` : undefined}
              onClick={() => set({ hp: toPermille(hp) })}
              className={cn("tap mp-dense h-7 rounded-full px-2.5 text-[11.5px] font-semibold transition-colors max-sm:h-8 max-sm:px-3 max-sm:text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]", r.target.hp === hp ? "bg-[#1d1b33] text-white" : "bg-[#1d1b33]/[0.06] text-[#1d1b33]/70 hover:bg-[#1d1b33]/[0.12]")}
              data-testid={`cr-hp-${key}`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto font-display text-[17px] font-bold tabular-nums tracking-wide" data-testid="cr-hp-value">
            {t("hp.value", { hp: r.target.hp, max: r.target.maxHp })}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1 border-t border-[#1d1b33]/[0.08] pt-2" role="group" aria-label={t("status.label")}>
          {STATUSES.map((s) => {
            const on = st === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                aria-label={td(`status.names.${s}`)}
                title={td(`status.names.${s}`)}
                onClick={() => set({ status: s })}
                className={cn(
                  "tap mp-dense h-8 min-w-0 flex-1 rounded-lg font-display text-[11.5px] font-bold italic tracking-wide max-sm:h-9 max-sm:text-[12.5px] transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]",
                  on ? (s === "none" ? "bg-[#1d1b33] text-white" : "text-black/85 shadow-[inset_0_-2px_0_rgb(0_0_0/0.2)]") : "bg-[#1d1b33]/[0.05] text-[#1d1b33]/55 hover:bg-[#1d1b33]/[0.1] hover:text-[#1d1b33]"
                )}
                style={on && s !== "none" ? { background: STATUS_COLOUR[s] } : undefined}
                data-testid={`cr-status-${s}`}
              >
                {s === "none" ? td("status.names.none") : td(`status.abbr.${s}`)}
              </button>
            );
          })}
        </div>
      </div>
      {newer && (
        <p className="mt-2 inline-block rounded-full bg-[#2a2200]/80 px-3 py-1 text-[12px] font-semibold text-[#ffd34d] backdrop-blur" data-testid="cr-newer">
          {t("pokemon.newer", { gen: newer })}
        </p>
      )}
    </div>
  );
}
