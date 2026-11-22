"use client";

/* eslint-disable @next/next/no-img-element -- remote Pokémon pictures */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Crown, Maximize2, Minus, Network, Plus, RotateCcw, Shuffle, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import tierList from "@/messages/tier-list";
import { BRACKET_SIZES, SEEDINGS, finishingOrder, resolveBracket, roundLabel, type BracketSize, type Seeding } from "@/lib/tier-list/bracket";
import type { BracketState } from "@/lib/tier-list/state";
import { artUrl, isPixelUrl, type ArtStyle } from "@/lib/tier-list/art";
import { bracketGeometry, drawBracket, loadPictures, pageFonts } from "@/lib/tier-list/render";
import type { Mon } from "@/lib/tier-list/types";
import { Tile } from "./Tile";
import { PillButton, Segmented, Field, useShowOnChange } from "./ui";
import type { TierListT } from "./names";

interface Props {
  bracket: BracketState;
  entrants: string[];
  poolSize: number;
  byKey: ReadonlyMap<string, Mon>;
  art: ArtStyle;
  shiny: boolean;
  title: string;
  moving: ReadonlySet<string>;
  light: boolean;
  onTileDown(e: React.PointerEvent<HTMLElement>, key: string, from: string): void;
  onSetup(patch: Partial<Pick<BracketState, "size" | "seeding" | "seed" | "manual">>): void;
  onStart(): void;
  onPick(side: 0 | 1): void;
  onUndo(): void;
  onRestart(): void;
}

export function useRoundName() {
  const t = useT(tierList);
  return useCallback(
    (r: number, count: number) => {
      const l = roundLabel(r, count);
      return l.kind === "final" ? t("bracket.final") : l.kind === "semi" ? t("bracket.semi") : l.kind === "quarter" ? t("bracket.quarter") : t("bracket.round", { n: l.n });
    },
    [t]
  );
}

/** Bracket mode: the setup, then two big cards head to head, the full bracket on demand, and the champion. */
export function BracketMode(p: Props) {
  const t = useT(tierList);
  const [view, setView] = useState(false);
  const res = useMemo(() => resolveBracket(p.entrants, p.bracket.picks), [p.entrants, p.bracket.picks]);
  const phase = !p.bracket.started ? "setup" : view ? "view" : res.champion ? "champion" : "match";
  const ref = useShowOnChange<HTMLDivElement>(phase);
  return (
    <div ref={ref} className="scroll-mt-20">
      {phase === "setup" ? (
        <Setup {...p} />
      ) : phase === "view" ? (
        <BracketView {...p} onBack={() => setView(false)} />
      ) : phase === "champion" ? (
        <Champion {...p} res={res} onView={() => setView(true)} />
      ) : (
        <Matchup {...p} res={res} onView={() => setView(true)} t={t} />
      )}
    </div>
  );
}

function Setup(p: Props) {
  const t = useT(tierList);
  const sizes: { value: BracketSize; label: string; disabled?: boolean; testId?: string }[] = [
    ...BRACKET_SIZES.map((n) => ({ value: n as BracketSize, label: t("bracket.sizeN", { n }), disabled: n > p.poolSize, testId: `bracket-size-${n}` })),
    { value: 0, label: t("bracket.sizeAll"), testId: "bracket-size-all" },
  ];
  const tooFew = p.poolSize < 2;
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="bracket-setup">
      <h2 className="font-display text-2xl font-semibold tracking-tight">{t("bracket.setup")}</h2>
      <Field label={t("bracket.size")}>
        <div>
          <Segmented wrap label={t("bracket.size")} value={p.bracket.size > p.poolSize ? 0 : p.bracket.size} onChange={(v) => p.onSetup({ size: v })} options={sizes} />
        </div>
      </Field>
      <Field label={t("bracket.seeding")}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="max-w-full">
            <Segmented wrap label={t("bracket.seeding")} value={p.bracket.seeding} onChange={(v: Seeding) => p.onSetup({ seeding: v })} options={SEEDINGS.map((s) => ({ value: s, label: t(`bracket.seedings.${s}`), testId: `bracket-seeding-${s}` }))} />
          </div>
          {(p.bracket.seeding === "random" || (p.bracket.size !== 0 && p.bracket.size < p.poolSize)) && (
            <PillButton onClick={() => p.onSetup({ seed: Math.random().toString(36).slice(2, 8) })} testId="bracket-reshuffle">
              <Shuffle className="h-4 w-4" aria-hidden /> {t("bracket.reshuffle")}
            </PillButton>
          )}
        </div>
      </Field>
      <Field label={t("bracket.entrants")}>
        {p.bracket.seeding === "manual" && <p className="-mt-1 text-sm text-muted-foreground">{t("bracket.manualHint")}</p>}
        <div className="tlm-scroll max-h-[40vh] overflow-y-auto rounded-2xl bg-foreground/[0.03] p-2" data-scroll>
          <div className="flex flex-wrap gap-1.5" data-drop="seeds" data-drop-kind="list" data-testid="bracket-entrants">
            {p.entrants.slice(0, 256).map((k, i) => {
              const m = p.byKey.get(k);
              return m ? (
                <div key={k} className="relative" data-tile={k}>
                  <Tile mon={m} art={p.art} shiny={p.shiny} size={56} from="seeds" moving={p.moving.has(k)} onPointerDown={p.bracket.seeding === "manual" ? p.onTileDown : undefined} />
                  <span className="pointer-events-none absolute left-1 top-0.5 font-display text-[12px] font-bold text-muted-foreground" aria-label={t("bracket.seedN", { n: i + 1 })}>
                    {i + 1}
                  </span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      </Field>
      {tooFew ? (
        <p className="text-sm text-muted-foreground">{t("bracket.tooFew")}</p>
      ) : (
        <PillButton primary onClick={p.onStart} className="h-12 px-8 text-[15px]" testId="bracket-start">
          {t("bracket.start")}
        </PillButton>
      )}
    </div>
  );
}

function Matchup(p: Props & { res: ReturnType<typeof resolveBracket>; onView(): void; t: TierListT }) {
  const { res, t } = p;
  const name = useRoundName();
  const cur = res.current!;
  const match = res.rounds[cur.round][cur.index];
  const a = match.a ? p.byKey.get(match.a) : undefined;
  const b = match.b ? p.byKey.get(match.b) : undefined;
  const prog = res.progress[cur.round];
  const pick = p.onPick;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      pick(e.key === "ArrowLeft" ? 0 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick]);
  const doneAll = res.progress.reduce((s, r) => s + r.done, 0);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5" data-testid="bracket-matchup">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-semibold tracking-tight" data-testid="bracket-round">{name(cur.round, res.rounds.length)}</p>
          <p className="text-sm text-muted-foreground" data-testid="bracket-progress">{t("bracket.progress", { done: prog.done + 1, total: prog.total })}</p>
        </div>
        <div className="flex gap-2">
          <PillButton onClick={p.onUndo} disabled={!doneAll} testId="bracket-undo">
            <Undo2 className="h-4 w-4" aria-hidden /> <span className="max-sm:sr-only">{t("bracket.undo")}</span>
          </PillButton>
          <PillButton onClick={p.onView} testId="bracket-view">
            <Network className="h-4 w-4" aria-hidden /> <span className="max-sm:sr-only">{t("bracket.view")}</span>
          </PillButton>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(prog.done / Math.max(1, prog.total)) * 100}%` }} />
      </div>
      <div className="relative grid grid-cols-2 gap-4 max-sm:gap-2.5" key={`${cur.round}-${cur.index}`}>
        {[a, b].map((m, side) =>
          m ? (
            <button
              key={side}
              type="button"
              onClick={() => pick(side as 0 | 1)}
              className="tlm-duel-card tlm-rise group relative flex aspect-[4/5] flex-col items-center justify-end overflow-hidden rounded-[28px] border border-foreground/[0.08] bg-foreground/[0.04] p-5 text-center hover:border-primary/60 hover:shadow-[0_20px_50px_-20px_hsl(var(--primary)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:rounded-[20px] max-sm:p-3"
              aria-label={t("bracket.pickA", { name: m.n })}
              data-testid={side ? "bracket-pick-b" : "bracket-pick-a"}
              style={{ animationDelay: `${side * 60}ms` }}
            >
              <span className="absolute left-4 top-3 rounded-full bg-foreground/[0.07] px-2.5 py-1 font-display text-[13px] font-semibold text-muted-foreground max-sm:left-2.5 max-sm:top-2" aria-hidden>
                {side ? "→" : "←"}
              </span>
              <img src={artUrl(m, p.art, p.shiny)} alt="" draggable={false} className={cn("pointer-events-none absolute inset-x-[8%] top-[8%] h-[70%] w-[84%] object-contain drop-shadow-[0_16px_24px_rgb(0_0_0/0.35)] transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transition-none", isPixelUrl(artUrl(m, p.art, p.shiny)) && "[image-rendering:pixelated]")} />
              <span className="relative font-display text-[26px] font-semibold leading-tight tracking-tight max-sm:text-[17px]">{m.n}</span>
            </button>
          ) : (
            <div key={side} />
          )
        )}
        <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-foreground/[0.1] bg-card font-display text-lg font-bold uppercase text-muted-foreground shadow-lg max-sm:h-10 max-sm:w-10 max-sm:text-sm" aria-hidden>
          {t("bracket.vs")}
        </span>
      </div>
      <p className="text-center text-sm text-muted-foreground max-md:hidden">{t("bracket.pickHint")}</p>
    </div>
  );
}

function Champion(p: Props & { res: ReturnType<typeof resolveBracket>; onView(): void }) {
  const t = useT(tierList);
  const order = finishingOrder(p.res);
  const champ = p.byKey.get(p.res.champion!);
  const runner = order[1] ? p.byKey.get(order[1]) : undefined;
  if (!champ) return null;
  const src = artUrl(champ, p.art, p.shiny);
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 text-center" data-testid="bracket-champion">
      <p className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-[0.2em] text-[hsl(var(--warning))]">
        <Crown className="h-4 w-4" aria-hidden /> {t("bracket.champion")}
      </p>
      <div className="relative aspect-square w-full max-w-[420px]">
        <div className="tlm-glow absolute inset-[6%] rounded-full bg-[radial-gradient(closest-side,rgb(246_201_74/0.45),transparent)]" aria-hidden />
        <img src={src} alt={champ.n} draggable={false} className={cn("tlm-pop relative h-full w-full object-contain drop-shadow-[0_24px_40px_rgb(0_0_0/0.35)]", isPixelUrl(src) && "[image-rendering:pixelated]")} />
      </div>
      <h2 className="font-display text-4xl font-bold tracking-tight max-sm:text-3xl" data-testid="bracket-champion-name">{champ.n}</h2>
      {runner && (
        <p className="-mt-3 text-sm text-muted-foreground">
          {t("bracket.runnerUp")}: {runner.n}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <PillButton onClick={p.onUndo} testId="bracket-undo">
          <Undo2 className="h-4 w-4" aria-hidden /> {t("bracket.undo")}
        </PillButton>
        <PillButton onClick={p.onView} testId="bracket-view">
          <Network className="h-4 w-4" aria-hidden /> {t("bracket.view")}
        </PillButton>
        <PillButton onClick={p.onRestart} testId="bracket-restart">
          <RotateCcw className="h-4 w-4" aria-hidden /> {t("bracket.restart")}
        </PillButton>
      </div>
    </div>
  );
}

/** The full bracket, drawn on a canvas (the same drawing as the download), with zoom and pan. */
function BracketView(p: Props & { onBack(): void }) {
  const t = useT(tierList);
  const name = useRoundName();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const geo = useMemo(() => bracketGeometry(p.entrants.length), [p.entrants.length]);
  const [z, setZ] = useState({ s: 0, x: 0, y: 0 });
  const fit = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const s = Math.min(el.clientWidth / geo.W, el.clientHeight / geo.H, 1);
    setZ({ s, x: (el.clientWidth - geo.W * s) / 2, y: Math.max(0, (el.clientHeight - geo.H * s) / 2) });
  }, [geo]);
  useLayoutEffect(fit, [fit]);

  useEffect(() => {
    let live = true;
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Keep the canvas within what browsers allow.
    const k = Math.min(dpr, 16000 / geo.H, 16000 / geo.W);
    c.width = Math.round(geo.W * k);
    c.height = Math.round(geo.H * k);
    const g = c.getContext("2d")!;
    const mons = p.entrants.map((e) => p.byKey.get(e)).filter((m): m is Mon => !!m);
    const draw = (pics: Parameters<typeof drawBracket>[2]) => {
      if (!live) return;
      g.setTransform(k, 0, 0, k, 0, 0);
      drawBracket(g, { title: p.title, entrants: p.entrants, picks: p.bracket.picks, byKey: p.byKey, labels: name, light: p.light, transparent: true }, pics, pageFonts(), geo);
    };
    draw({ get: () => null });
    void loadPictures(mons, p.art, p.shiny).then(draw);
    return () => {
      live = false;
    };
  }, [geo, p.entrants, p.bracket.picks, p.byKey, p.art, p.shiny, p.title, p.light, name]);

  // Wheel zooms around the pointer; dragging pans.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setZ((v) => {
        const s = Math.max(0.05, Math.min(3, v.s * Math.exp(-e.deltaY * 0.0015)));
        return { s, x: mx - ((mx - v.x) / v.s) * s, y: my - ((my - v.y) / v.s) * s };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const pts = pointers.current;
    if (pts.size === 2) {
      const [o] = [...pts.entries()].filter(([id]) => id !== e.pointerId);
      const other = o[1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      const r = host.current!.getBoundingClientRect();
      const mx = (e.clientX + other.x) / 2 - r.left, my = (e.clientY + other.y) / 2 - r.top;
      setZ((v) => {
        const s = Math.max(0.05, Math.min(3, (v.s * d1) / Math.max(1, d0)));
        return { s, x: mx - ((mx - v.x) / v.s) * s, y: my - ((my - v.y) / v.s) * s };
      });
    } else setZ((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onUp = (e: React.PointerEvent) => pointers.current.delete(e.pointerId);
  const zoom = (f: number) => {
    const el = host.current!;
    const mx = el.clientWidth / 2, my = el.clientHeight / 2;
    setZ((v) => {
      const s = Math.max(0.05, Math.min(3, v.s * f));
      return { s, x: mx - ((mx - v.x) / v.s) * s, y: my - ((my - v.y) / v.s) * s };
    });
  };
  return (
    <div className="flex h-full min-h-[60vh] flex-col gap-3" data-testid="bracket-full">
      <div className="flex items-center justify-between gap-2">
        <PillButton onClick={p.onBack} testId="bracket-back">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {t("bracket.back")}
        </PillButton>
        <div className="flex gap-1">
          <button type="button" onClick={() => zoom(1 / 1.3)} className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.06] hover:bg-foreground/[0.1]" aria-label={t("bracket.zoomOut")} title={t("bracket.zoomOut")}>
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => zoom(1.3)} className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.06] hover:bg-foreground/[0.1]" aria-label={t("bracket.zoomIn")} title={t("bracket.zoomIn")}>
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={fit} className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.06] hover:bg-foreground/[0.1]" aria-label={t("bracket.fit")} title={t("bracket.fit")}>
            <Maximize2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <div
        ref={host}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden rounded-[24px] border border-foreground/[0.07] bg-foreground/[0.02] active:cursor-grabbing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <canvas
          ref={canvas}
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: geo.W, height: geo.H, transform: `translate3d(${z.x}px, ${z.y}px, 0) scale(${z.s})`, visibility: z.s ? "visible" : "hidden" }}
          data-testid="bracket-canvas"
          aria-label={t("bracket.view")}
          role="img"
        />
      </div>
    </div>
  );
}
