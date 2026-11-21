"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";

/** What every game's "How to play" pop-up shares: the pop-up itself, the looping demo's clock, its frame, the rule cards and the two buttons. */

const noSubscribe = () => () => undefined;

/**
 * A media query, read as the component renders. While a pop-up that came in
 * the page's HTML (lib/howto-first) hydrates, it reads as `server` (what the
 * HTML was rendered with), then as the real answer straight after; a pop-up
 * opened later reads the real answer from its first render, as before.
 */
function useMediaQuery(query: string, server: boolean): boolean {
  return useSyncExternalStore(noSubscribe, () => window.matchMedia(query).matches, () => server);
}

/**
 * Steps through a demo's frames (each held for its `ms`), looping. Under
 * reduced motion it never moves: it stays on the last frame, a still picture of the result.
 */
export function useDemoFrame(ms: readonly number[]): number {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)", false);
  const last = ms.length - 1;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) return;
    setI(0);
    let n = 0;
    let t = 0;
    const tick = () => {
      t = window.setTimeout(() => {
        n = (n + 1) % ms.length;
        setI(n);
        tick();
      }, ms[n]);
    };
    tick();
    return () => window.clearTimeout(t);
  }, [reduced, ms]);
  return reduced ? last : i;
}

/**
 * Every game's "How to play" pop-up, one size on every game: a centred card
 * 28rem wide (less a 1rem margin each side on a phone) and 680px tall, never
 * taller than the screen less 2rem above and below. Its title and close
 * button stay on top and its buttons (`footer`) at the bottom; the demo and
 * the rules scroll inside it, between them, never the page. It fades in from
 * transparent on a phone, so a first visit's how-to never counts as the
 * page's largest paint there: the board does.
 */
export function HowToDialog({
  title = "How to play",
  subtitle,
  onClose,
  footer,
  testId,
  children,
}: {
  title?: string;
  /** One line under the title. */
  subtitle?: string;
  onClose: () => void;
  footer: React.ReactNode;
  /** On the card, for the end-to-end tests. */
  testId: string;
  children: React.ReactNode;
}) {
  const closeRef = useDialogFocus(onClose);
  return (
    // !m-0: a parent's space-y would push the overlay down (PokéGuessr's put its card 20px lower than the others).
    <div className="fixed inset-0 z-50 !m-0 flex items-center justify-center bg-black/60 p-4 max-md:z-[65]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(680px,calc(100dvh-4rem))] w-full max-w-md flex-col overflow-hidden rounded-lg border-2 border-foreground/15 bg-card shadow-2xl max-md:animate-sheet-in"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-foreground/10 py-3 pl-4 pr-2 sm:pl-5 sm:pr-3">
          <div className="min-w-0 py-1">
            <h2 className="font-display text-xl font-bold uppercase tracking-tight">{title}</h2>
            {subtitle && <p className="hud-label mt-1">{subtitle}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Focusable, so the rules scroll from the keyboard too when nothing in them takes the focus (PokéGuessr's). */}
        <div
          tabIndex={0}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
          data-testid="howto-body"
        >
          {children}
        </div>
        <div className="shrink-0 border-t border-foreground/10 px-4 py-3 sm:px-5">{footer}</div>
      </div>
    </div>
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Shows something drawn wider than the pop-up (Pokédle's board, laid out for
 * a desktop from 640px up) scaled down to fit its width, instead of scrolling
 * sideways. At full size when it fits; on a phone the board lays itself out
 * to the width, so it's left as it is.
 */
export function FitWidth({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<{ scale: number; height: number } | null>(null);
  useIsoLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      // Folded away (a closed <details>): nothing to fit until it opens.
      if (!o.clientWidth) return;
      const scale = Math.min(1, o.clientWidth / Math.max(1, i.offsetWidth));
      const next = scale < 0.999 ? { scale, height: i.offsetHeight * scale } : null;
      setFit((f) => (f?.scale === next?.scale && f?.height === next?.height ? f : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="w-full overflow-hidden" style={fit ? { height: fit.height } : undefined}>
      <div ref={inner} className="sm:mx-auto sm:w-max" style={fit ? { transform: `scale(${fit.scale})`, transformOrigin: "top left", marginLeft: 0 } : undefined}>
        {children}
      </div>
    </div>
  );
}

export function DemoFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div data-testid="howto-demo" role="group" aria-label={label} className="overflow-hidden rounded-md border-2 border-foreground/15 bg-shade/40 p-3">
      <p className="hud-label mb-2 flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden /> Demo
      </p>
      <div aria-hidden>{children}</div>
    </div>
  );
}

export interface HowToCard {
  title: string;
  body: React.ReactNode;
}

function HowToCardGrid({ cards }: { cards: HowToCard[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {cards.map((c) => (
        <div key={c.title} className="rounded-md border-2 border-foreground/10 bg-card p-3">
          <p className="hud-label mb-1">{c.title}</p>
          <div className="space-y-1 text-sm">{c.body}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The rule cards. On a phone they start folded under the demo, so the demo and
 * the two buttons fit on the first screen (the buttons were pushed below the
 * fold) and the pop-up doesn't open with a big block of text that would be the
 * page's largest paint. From 640px up they're open, as before.
 */
export function HowToCards({ cards }: { cards: HowToCard[] }) {
  const wide = useMediaQuery("(min-width: 640px)", true);
  if (wide) return <HowToCardGrid cards={cards} />;
  return (
    <details className="rounded-md border bg-shade/30 p-3" data-testid="howto-cards">
      <summary className="tap cursor-pointer font-semibold py-1.5">The rules</summary>
      <div className="mt-3">
        <HowToCardGrid cards={cards} />
      </div>
    </details>
  );
}

/** "Let's play!" closes; "Don't show again" closes and stops the automatic first-visit pop-up on this device. In HowToDialog's footer. */
export function HowToActions({ onClose, onNever }: { onClose: () => void; onNever?: () => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row-reverse">
      <Button className="w-full sm:flex-1" onClick={onClose} data-testid="howto-play">
        Let&apos;s play!
      </Button>
      {onNever && (
        <Button variant="outline" className="w-full sm:flex-1" onClick={onNever} data-testid="howto-never">
          Don&apos;t show again
        </Button>
      )}
    </div>
  );
}
