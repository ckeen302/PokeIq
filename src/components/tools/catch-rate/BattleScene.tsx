"use client";

/* eslint-disable @next/next/no-img-element -- one static Pokémon picture */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "framer-motion";
import { Sparkles, Zap } from "lucide-react";
import { useT } from "@/i18n/client";
import msgs from "@/messages/catch-rate";
import { artUrl } from "@/lib/pokemon/art";
import { simulate, type BallId, type Status, type Throw } from "@/lib/catch-rate/formula";
import { cn } from "@/lib/utils";
import { BallArt } from "./BallArt";
import { Backdrop, SCENE_CSS, type Place } from "./Backdrop";
import { pct, throws } from "./format";

type Result = { shakes: number; caught: boolean; critical: boolean };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The status tint laid over the Pokémon (a mask of its own picture), as the games colour an afflicted Pokémon. */
const TINT: Partial<Record<Status, string>> = { freeze: "#7fdcff", poison: "#c060e0", burn: "#ff7a3a", paralysis: "#ffd84a" };

/** The big picture of a species: the static 512 px render, else the official artwork through /api/art. */
const bigArt = (id: number) => `/sizes/art/512/${id}.webp`;

export interface SceneProps {
  place: Place;
  darkGrass: boolean;
  speciesId: number;
  speciesName: string;
  status: Status;
  /** The ball in hand and its throw. */
  ball: BallId;
  ballName: string;
  th: Throw;
  expected: number;
  /** Bumped to throw the ball in hand now (a ball picked in the bag). */
  shot: number;
  /** A message that replaces the text box's own (Sword & Shield's level cap). */
  blocked: ReactNode;
  /** The HUD (the wild Pokémon's info box), laid over the scene. */
  hud: ReactNode;
}

/**
 * The encounter: the wild Pokémon on its platform over a backdrop that fits the situation, its info box, the ball in
 * hand on your side, and the text box at the bottom with the Throw button. A throw arcs the ball onto the Pokémon,
 * which goes in with a flash; the ball wobbles as many times as its shake checks pass (drawn with the real chance per
 * check) and clicks shut or bursts open. With reduced motion it skips straight to the outcome. The text box is a live
 * region that says what happened.
 */
export function BattleScene({ place, darkGrass, speciesId, speciesName, status, ball, ballName, th, expected, shot, blocked, hud }: SceneProps) {
  const t = useT(msgs);
  const locale = t.locale;
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [tally, setTally] = useState({ caught: 0, thrown: 0 });
  const [src, setSrc] = useState(bigArt(speciesId));
  const run = useRef(0);

  useEffect(() => setSrc(bigArt(speciesId)), [speciesId]);

  // A new ball or Pokémon starts over (and stops a throw in flight).
  useEffect(() => {
    run.current++;
    setBusy(false);
    setResult(null);
    setTally({ caught: 0, thrown: 0 });
    if (!scope.current) return;
    void animate("[data-a=mon]", { scale: 1, opacity: 1, y: 0, filter: "brightness(1)" }, { duration: 0 });
    void animate("[data-a=ball]", { x: 0, y: 0, rotate: 0, scale: 1, opacity: 0 }, { duration: 0 });
    void animate("[data-a=stars]", { opacity: 0 }, { duration: 0 });
    void animate("[data-a=flash]", { opacity: 0 }, { duration: 0 });
  }, [ball, speciesId, scope, animate]);

  const go = async () => {
    const me = ++run.current;
    const r = simulate(th);
    const alive = () => run.current === me;
    const el = scope.current;
    if (reduce || !el) {
      setResult(r);
      setTally((x) => ({ caught: x.caught + (r.caught ? 1 : 0), thrown: x.thrown + 1 }));
      return;
    }
    setBusy(true);
    setResult(null);
    const hand = el.querySelector<HTMLElement>("[data-a=home]")?.getBoundingClientRect();
    const anchor = el.querySelector<HTMLElement>("[data-a=anchor]")?.getBoundingClientRect();
    const mon = el.querySelector<HTMLElement>("[data-a=mon]")?.getBoundingClientRect();
    if (!hand || !anchor || !mon) return;
    // From the ball in hand to the middle of the Pokémon, then down to its platform.
    const sx = hand.left + hand.width / 2 - (anchor.left + anchor.width / 2);
    const sy = hand.top + hand.height / 2 - (anchor.top + anchor.height / 2);
    const hit = -Math.min(mon.height * 0.42, 150);
    const peak = Math.min(sy, hit) - Math.max(60, mon.height * 0.35);
    try {
      await Promise.all([
        animate("[data-a=mon]", { scale: 1, opacity: 1, y: 0, filter: "brightness(1)" }, { duration: 0 }),
        animate("[data-a=stars]", { opacity: 0, scale: 0.4 }, { duration: 0 }),
        animate("[data-a=flash]", { opacity: 0, y: hit }, { duration: 0 }),
        animate("[data-a=ball]", { x: sx, y: sy, rotate: 0, scale: 1.35, opacity: 1 }, { duration: 0 }),
      ]);
      // The arc.
      await animate("[data-a=ball]", { x: [sx, sx * 0.42, 0], y: [sy, peak, hit], rotate: [0, -400, -720], scale: [1.35, 1.12, 1] }, { duration: 0.72, ease: "easeOut" });
      if (!alive()) return;
      // The Pokémon turns to light and goes into the ball.
      await animate("[data-a=mon]", { filter: "brightness(3.2)" }, { duration: 0.14 });
      await Promise.all([
        animate("[data-a=flash]", { opacity: [0, 1, 0], scale: [0.3, 1.5, 1.8] }, { duration: 0.5 }),
        animate("[data-a=mon]", { scale: 0.04, opacity: 0 }, { duration: 0.36, ease: "easeIn" }),
      ]);
      if (!alive()) return;
      // A critical capture: the ball shudders in mid-air before it drops.
      if (r.critical) {
        await animate("[data-a=ball]", { rotate: [-720, -740, -700, -734, -706, -720], x: [0, -4, 4, -3, 3, 0] }, { duration: 0.6, ease: "easeInOut" });
        if (!alive()) return;
      }
      // It drops onto the platform and bounces.
      await animate("[data-a=ball]", { y: [hit, 0, -16, 0, -5, 0] }, { duration: 0.7, times: [0, 0.45, 0.62, 0.78, 0.9, 1], ease: "easeOut" });
      await animate("[data-a=ball]", { rotate: 0 }, { duration: 0 });
      for (let i = 0; i < r.shakes; i++) {
        await wait(420);
        if (!alive()) return;
        await animate("[data-a=ball]", { rotate: [0, -28, 22, -10, 0], x: [0, -5, 4, -2, 0] }, { duration: 0.62, ease: "easeInOut" });
      }
      await wait(460);
      if (!alive()) return;
      if (r.caught) {
        await Promise.all([
          animate("[data-a=ball]", { scale: [1, 0.9, 1], filter: ["brightness(1)", "brightness(0.8)", "brightness(0.8)"] }, { duration: 0.3 }),
          animate("[data-a=stars]", { opacity: [0, 1, 1], scale: [0.4, 1.2, 1] }, { duration: 0.55 }),
        ]);
      } else {
        await Promise.all([
          animate("[data-a=flash]", { y: -20, opacity: [0, 0.95, 0], scale: [0.4, 1.4, 1.7] }, { duration: 0.42 }),
          animate("[data-a=ball]", { scale: [1, 1.3, 0.2], opacity: [1, 1, 0] }, { duration: 0.34 }),
          animate("[data-a=mon]", { scale: [0.2, 1.08, 1], opacity: [0, 1, 1], filter: ["brightness(3)", "brightness(1.6)", "brightness(1)"] }, { duration: 0.5, ease: "easeOut" }),
        ]);
      }
      if (!alive()) return;
      setResult(r);
      setTally((x) => ({ caught: x.caught + (r.caught ? 1 : 0), thrown: x.thrown + 1 }));
    } finally {
      if (alive()) setBusy(false);
    }
  };

  // A ball picked in the bag is thrown at once.
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    if (shot > 0) void goRef.current();
  }, [shot]);

  // With reduced motion the picture shows the outcome as a still: the ball with stars, or the Pokémon free.
  const still = reduce && result;
  const outcome = result ? (result.caught ? t("throw.caught", { name: speciesName }) : `${t("throw.broke")} ${t("throw.shakes", { n: result.shakes })}`) : "";
  const message = result?.critical ? `${t("throw.critical")} ${outcome}` : outcome;
  const chance = th.chance;
  const tint = TINT[status];
  const asleep = status === "sleep";
  const monHidden = !!(still && result?.caught);

  return (
    <div
      ref={scope}
      className={cn(
        "relative h-[560px] select-none rounded-[28px] shadow-[0_30px_80px_-40px_rgb(0_0_0/0.7)] max-sm:rounded-[24px] sm:h-[600px] lg:h-[clamp(500px,calc(100svh-316px),640px)]",
        "[--ew:62%] [--ex:66%] [--ey:69%] [--hy:74%] [--hz:53%] [--mw:56%] [--px:16%] [--py:89%]",
        "md:[--ew:40%] md:[--ex:71%] md:[--ey:61%] md:[--hy:74%] md:[--hz:47%] md:[--mw:42%] md:[--px:17%] md:[--py:91%]"
      )}
      data-testid="cr-stage"
    >
      <style>{SCENE_CSS}</style>
      {/* Everything drawn in the scene is clipped to its rounded frame; the HUD's search can open past it. */}
      <div className="absolute inset-0 overflow-hidden rounded-[inherit] ring-1 ring-inset ring-white/10">
        <AnimatePresence initial={false}>
          <motion.div key={`${place}-${darkGrass}`} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.6 }}>
            <Backdrop place={place} darkGrass={darkGrass} />
          </motion.div>
        </AnimatePresence>

        {/* The wild Pokémon, on its platform. */}
        <div className="absolute aspect-square w-[min(var(--mw),330px)] -translate-x-1/2 -translate-y-[90%]" style={{ left: "var(--ex)", top: "var(--ey)" }} aria-hidden>
          <div className="absolute inset-x-[18%] bottom-[2%] h-[10%] rounded-[50%] bg-black/30 blur-[6px]" />
          <div data-a="mon" className="relative h-full w-full origin-[50%_60%]" style={monHidden ? { opacity: 0 } : undefined}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={speciesId}
                className="cr-bob absolute inset-0"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
              >
                <img
                  src={src}
                  alt=""
                  width={512}
                  height={512}
                  draggable={false}
                  onError={() => setSrc((s) => (s === artUrl(speciesId, 400) ? s : artUrl(speciesId, 400)))}
                  className="h-full w-full object-contain drop-shadow-[0_14px_18px_rgb(0_0_0/0.35)]"
                  data-testid="cr-mon"
                />
                {tint && (
                  <div
                    className="absolute inset-0 mix-blend-color"
                    style={{ background: tint, opacity: 0.55, WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`, WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center" }}
                  />
                )}
                {status === "paralysis" &&
                  [
                    [18, 30, 0],
                    [74, 22, 0.5],
                    [60, 62, 1],
                  ].map(([l, tp, d]) => <Zap key={l} className="cr-spark absolute h-[11%] w-[11%] fill-[#ffe14a] text-[#b88a00]" style={{ left: `${l}%`, top: `${tp}%`, animationDelay: `${d}s` }} />)}
                {asleep &&
                  [0, 0.8, 1.6].map((d, i) => (
                    <span key={d} className="cr-zzz absolute font-display font-bold italic text-white [text-shadow:0_2px_0_rgb(40_40_80/0.6)]" style={{ right: `${12 + i * 4}%`, top: `${14 - i * 3}%`, fontSize: `${18 + i * 4}px`, animationDelay: `${d}s` }}>
                      z
                    </span>
                  ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Where the thrown ball lands: at the Pokémon's feet. It flies in from the ball in hand. */}
        <div data-a="anchor" className="absolute h-11 w-11 -translate-x-1/2 -translate-y-[60%]" style={{ left: "var(--ex)", top: "var(--ey)" }} aria-hidden>
          <div data-a="flash" className="pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255),rgb(255_244_210/0.65)_40%,transparent)] opacity-0" />
          <div data-a="ball" className="relative h-full w-full opacity-0" style={still && result?.caught ? { opacity: 1 } : undefined}>
            <BallArt id={ball} size={44} />
          </div>
          <div className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2">
            <div data-a="stars" className="flex gap-1 text-[#ffe680] opacity-0 drop-shadow-[0_0_8px_rgb(255_220_120/0.9)]" style={still && result?.caught ? { opacity: 1 } : undefined}>
              <Sparkles className="h-5 w-5 -rotate-12" />
              <Sparkles className="h-7 w-7 -translate-y-2" />
              <Sparkles className="h-5 w-5 rotate-12" />
            </div>
          </div>
        </div>

        {/* The next ball, in hand on your side. */}
        <div data-a="home" className="absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2" style={{ left: "var(--px)", top: "var(--hy)" }} aria-hidden>
          <AnimatePresence>
            {!busy && !result?.caught && (
              <motion.div key={ball} className="cr-hand h-full w-full" initial={reduce ? false : { scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} data-testid="cr-hand">
                <BallArt id={ball} size={56} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {hud}

      {/* The text box: what happened, the ball in hand and its odds, and the Throw button. */}
      <div className="dark-scope absolute inset-x-3 bottom-3 rounded-[20px] border-2 border-white/[0.14] bg-[#14122d]/[0.9] p-3 text-white shadow-[0_16px_40px_-16px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-md md:left-[33%] md:right-4 md:bottom-4 md:p-3.5">
        <div className="flex min-h-[22px] items-start gap-2">
          <p className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug md:text-[15.5px]" aria-live="polite" data-testid="cr-throw-result" data-caught={result ? String(result.caught) : undefined}>
            {blocked ? (
              blocked
            ) : busy ? (
              <span className="text-white/90">{t("throw.throwing")}</span>
            ) : result ? (
              <span className={result.caught ? "text-[#7dfc9a]" : "text-white"}>{message}</span>
            ) : (
              <span className="text-white/95">{t("throw.appeared", { name: speciesName })}</span>
            )}
            {!busy && !blocked && <span className="cr-blink ml-1.5 inline-block translate-y-[-1px] text-[11px] text-[#ff5c8a]" aria-hidden>▼</span>}
          </p>
          {tally.thrown > 0 && (
            <p className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums text-white/85" data-testid="cr-tally">
              {t("throw.tally", { caught: tally.caught, thrown: tally.thrown })}
            </p>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-3 max-sm:gap-2.5">
          <BallArt id={ball} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white/75" data-testid="cr-hand-name">
              {ballName}
            </p>
            <p className="flex items-baseline gap-1.5 leading-none">
              <span className="font-display text-[28px] font-bold tabular-nums max-sm:text-[26px] md:text-[30px]" style={{ color: chance >= 0.6 ? "#4fe39a" : chance >= 0.25 ? "#ffcf3f" : "#ff6b7d" }}>
                {pct(chance, locale)}
              </span>
              <span className="truncate text-[12px] text-white/60">
                {t("results.perThrow")}
                {chance > 0 && chance < 1 && Number.isFinite(expected) && <span className="max-sm:hidden"> · ≈{throws(expected, locale)}</span>}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void go()}
            disabled={busy || chance <= 0}
            className="relative inline-flex h-12 shrink-0 items-center gap-2 overflow-hidden rounded-full bg-gradient-to-b from-[#ff5b8d] to-[#e0245e] pl-2 pr-5 font-display text-[16px] max-sm:gap-1.5 max-sm:pr-4 max-sm:text-[15px] font-bold uppercase italic tracking-wide text-white shadow-[0_6px_18px_rgb(240_60_110/0.45),inset_0_-4px_0_rgb(0_0_0/0.2),inset_0_2px_0_rgb(255_255_255/0.3)] ring-2 ring-black/20 transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:opacity-55 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
            data-testid="cr-throw"
          >
            <BallArt id={ball} size={32} />
            {busy ? t("throw.throwing") : result ? t("throw.again") : t("throw.go")}
          </button>
        </div>
      </div>
    </div>
  );
}
