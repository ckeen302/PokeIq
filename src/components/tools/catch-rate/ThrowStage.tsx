"use client";

/* eslint-disable @next/next/no-img-element -- one static Pokémon picture */
import { useEffect, useRef, useState } from "react";
import { useAnimate, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useT } from "@/i18n/client";
import msgs from "@/messages/catch-rate";
import { boardArtUrl } from "@/lib/pokemon/art";
import { simulate, type BallId, type Throw } from "@/lib/catch-rate/formula";
import { BallArt } from "./BallArt";

type Result = { shakes: number; caught: boolean; critical: boolean };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The throw preview: the ball flies at the Pokémon, swallows it, wobbles as many times as its shake checks pass (drawn
 * with the real chance per check) and either clicks shut or bursts open. With reduced motion it skips straight to the
 * outcome. A live region says what happened.
 */
export function ThrowStage({ ball, ballName, th, speciesId, speciesName }: { ball: BallId; ballName: string; th: Throw; speciesId: number; speciesName: string }) {
  const t = useT(msgs);
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [tally, setTally] = useState({ caught: 0, thrown: 0 });
  const run = useRef(0);

  // A new ball or Pokémon starts over (and stops a throw in flight).
  useEffect(() => {
    run.current++;
    setBusy(false);
    setResult(null);
    setTally({ caught: 0, thrown: 0 });
    if (!scope.current) return;
    void animate("[data-a=mon]", { scale: 1, opacity: 1, y: 0 }, { duration: 0 });
    void animate("[data-a=ball]", { x: 0, y: 0, rotate: 0, scale: 1, opacity: 0 }, { duration: 0 });
    void animate("[data-a=stars]", { opacity: 0 }, { duration: 0 });
  }, [ball, speciesId, scope, animate]);

  const go = async () => {
    if (busy) return;
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
    const box = el.getBoundingClientRect();
    // From the ball in hand (bottom left) to the Pokémon's feet.
    const sx = -box.width * 0.36, sy = box.height * 0.12 - 6, lift = 54;
    try {
      await Promise.all([
        animate("[data-a=mon]", { scale: 1, opacity: 1, y: 0 }, { duration: 0 }),
        animate("[data-a=stars]", { opacity: 0, scale: 0.4 }, { duration: 0 }),
        animate("[data-a=ball]", { x: sx, y: sy, rotate: 0, scale: 1, opacity: 1 }, { duration: 0 }),
      ]);
      // The arc.
      await animate("[data-a=ball]", { x: [sx, sx * 0.45, 0], y: [sy, -lift - 70, -lift], rotate: [0, -420, -720] }, { duration: 0.62, ease: "easeOut" });
      if (!alive()) return;
      // The Pokémon goes into the ball in a flash.
      await Promise.all([
        animate("[data-a=flash]", { opacity: [0, 0.95, 0], scale: [0.4, 1.4, 1.6] }, { duration: 0.42 }),
        animate("[data-a=mon]", { scale: 0.05, opacity: 0, y: 30 }, { duration: 0.34, ease: "easeIn" }),
      ]);
      if (!alive()) return;
      // A critical capture: the ball shudders in mid-air before it drops (then wobbles once).
      if (r.critical) {
        await animate("[data-a=ball]", { rotate: [-720, -738, -702, -732, -708, -720], x: [0, -3, 3, -2, 2, 0] }, { duration: 0.55, ease: "easeInOut" });
        if (!alive()) return;
      }
      // It drops and bounces.
      await animate("[data-a=ball]", { y: [-lift, 0, -12, 0], rotate: [-720, -720, -720, -720] }, { duration: 0.55, times: [0, 0.55, 0.78, 1], ease: "easeOut" });
      await animate("[data-a=ball]", { rotate: 0 }, { duration: 0 });
      for (let i = 0; i < r.shakes; i++) {
        await wait(380);
        if (!alive()) return;
        await animate("[data-a=ball]", { rotate: [0, -26, 20, -9, 0] }, { duration: 0.6, ease: "easeInOut" });
      }
      await wait(420);
      if (!alive()) return;
      if (r.caught) {
        await animate("[data-a=stars]", { opacity: [0, 1, 1], scale: [0.4, 1.15, 1] }, { duration: 0.5 });
      } else {
        await Promise.all([
          animate("[data-a=flash]", { opacity: [0, 0.9, 0], scale: [0.4, 1.3, 1.5] }, { duration: 0.38 }),
          animate("[data-a=ball]", { scale: [1, 1.25, 0.2], opacity: [1, 1, 0] }, { duration: 0.32 }),
          animate("[data-a=mon]", { scale: [0.2, 1.08, 1], opacity: [0, 1, 1], y: [20, 0, 0] }, { duration: 0.45, ease: "easeOut" }),
        ]);
      }
      if (!alive()) return;
      setResult(r);
      setTally((x) => ({ caught: x.caught + (r.caught ? 1 : 0), thrown: x.thrown + 1 }));
    } finally {
      if (alive()) setBusy(false);
    }
  };

  // With reduced motion the picture shows the outcome as a still: the ball with stars, or the Pokémon free.
  const still = reduce && result;
  const outcome = result ? (result.caught ? t("throw.caught", { name: speciesName }) : `${t("throw.broke")} ${t("throw.shakes", { n: result.shakes })}`) : "";
  const message = result?.critical ? `${t("throw.critical")} ${outcome}` : outcome;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scope}
        className="dark-scope relative h-[210px] overflow-hidden rounded-[22px] border border-white/[0.06] sm:h-[230px]"
        style={{ background: "radial-gradient(120% 80% at 70% 0%, hsl(250 45% 22%), transparent 70%), linear-gradient(180deg, hsl(248 36% 12%), hsl(248 36% 7%))" }}
        data-testid="cr-stage"
      >
        {/* The wild Pokémon on its patch of grass. */}
        <div className="absolute bottom-[18%] left-1/2 h-[26px] w-[62%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,hsl(140_45%_40%/0.55),hsl(140_45%_30%/0.15)_70%,transparent)]" aria-hidden />
        <div className="absolute bottom-[calc(18%+8px)] left-1/2 -translate-x-1/2" aria-hidden>
          <img
            data-a="mon"
            src={boardArtUrl(speciesId)}
            alt=""
            width={132}
            height={132}
            className="h-[118px] w-[118px] origin-bottom object-contain drop-shadow-[0_10px_14px_rgb(0_0_0/0.5)] sm:h-[132px] sm:w-[132px]"
            style={still && result?.caught ? { opacity: 0 } : undefined}
          />
        </div>
        {/* The ball rests at the Pokémon's feet; it is thrown from the bottom left. */}
        <div className="absolute bottom-[calc(18%-6px)] left-1/2 -ml-[22px]" aria-hidden>
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-[70%]">
            <div data-a="flash" className="h-full w-full rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.95),rgb(255_240_200/0.5)_45%,transparent)] opacity-0" />
          </div>
          <div data-a="ball" className="opacity-0" style={still && result?.caught ? { opacity: 1 } : undefined}>
            <BallArt id={ball} size={44} />
          </div>
          <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2">
          <div data-a="stars" className="flex gap-1 text-[#ffe680] opacity-0" style={still && result?.caught ? { opacity: 1 } : undefined}>
            <Sparkles className="h-5 w-5 -rotate-12" />
            <Sparkles className="h-6 w-6 -translate-y-2" />
            <Sparkles className="h-5 w-5 rotate-12" />
          </div>
          </div>
        </div>
        {/* The next ball, in hand. */}
        {!busy && !(result?.caught) && (
          <div className="absolute bottom-[6%] left-[calc(14%-22px)]" aria-hidden data-testid="cr-hand">
            <BallArt id={ball} size={44} />
          </div>
        )}
        <p className="absolute left-3 top-3 rounded-full bg-black/40 px-2.5 py-1 text-[11.5px] font-semibold text-white/85 backdrop-blur-sm">{ballName}</p>
        {tally.thrown > 0 && (
          <p className="absolute right-3 top-3 rounded-full bg-black/40 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums text-white/85 backdrop-blur-sm" data-testid="cr-tally">
            {t("throw.tally", { caught: tally.caught, thrown: tally.thrown })}
          </p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-primary px-6 font-display text-[15px] font-semibold uppercase tracking-wider text-primary-foreground shadow-[0_10px_24px_-10px_hsl(var(--primary)/0.8)] transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          data-testid="cr-throw"
        >
          <BallArt id={ball} size={20} />
          {busy ? t("throw.throwing") : result ? t("throw.again") : t("throw.go")}
        </button>
        <p className="min-w-0 text-[14px] font-medium leading-snug" aria-live="polite" data-testid="cr-throw-result" data-caught={result ? String(result.caught) : undefined}>
          {result ? <span className={result.caught ? "text-[hsl(var(--success))]" : "text-foreground/85"}>{message}</span> : <span className="text-muted-foreground">{t("throw.pick")}</span>}
        </p>
      </div>
    </div>
  );
}
