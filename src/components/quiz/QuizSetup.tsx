"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, Settings2 } from "lucide-react";
import type { Difficulty, ModuleId, QuizFormat, QuizScope } from "@/engines/types";
import { FORMAT_INFO, MODULE_INFO, PLAYABLE_FORMATS, difficultiesFor, filterFor, playDifficulty } from "@/lib/modes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QuizController, type StartRequest } from "./QuizController";
import { QuizDuelCard } from "./QuizDuelCard";
import { cn } from "@/lib/utils";
import { getProgress } from "@/lib/progress";
import { preloadAudio, preloadImage } from "@/lib/preload";
import { createQuizPrefetcher, type QuizPrefetcher } from "@/lib/quiz-prefetch";
import type { StartResponse } from "@/lib/session-types";

/**
 * Pre-game setup: format and generation filter, plus the difficulty for the
 * two modes where it changes the game (Whose Team Is This? and Real Shiny?;
 * every other mode plays one fixed tuning). Starting needs a click on
 * purpose — it's the user gesture that unlocks cry audio.
 *
 * The run on screen is got ready ahead (see quiz-prefetch.ts): once the page
 * goes idle, again shortly after a setting changes, and when Start is
 * hovered or focused. Start then shows question 1 at once, its picture or
 * cry already downloaded.
 */

/** Wait after a setting changes before getting that run ready (the player may still be choosing). */
const SETTLE_MS = 700;

async function postSession(body: object): Promise<unknown> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const reply = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(reply.error ?? `Request failed (${res.status})`);
  return reply;
}

function preloadHeld(assets: { images: string[]; audio: string[] }) {
  assets.images.forEach((url) => void preloadImage(url, { priority: "high" }));
  assets.audio.forEach((url) => void preloadAudio(url));
}

interface QuizSetupProps {
  module: ModuleId;
  initialFormat?: QuizFormat;
  /** From an old link or a deep link: kept only where the mode has a choice. */
  initialDifficulty?: string;
  initialGens?: number[];
}

export function QuizSetup({ module, initialFormat, initialDifficulty, initialGens = [] }: QuizSetupProps) {
  const info = MODULE_INFO[module];
  const filter = filterFor(module);
  const [format, setFormat] = useState<QuizFormat>(initialFormat ?? info.defaultFormat);
  const choices = difficultiesFor(module);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => playDifficulty(module, initialDifficulty));
  // Whose Team Is This?: game teams, anime teams or both.
  const [scope, setScope] = useState<QuizScope | null>(null);
  const hasScope = module === "whose-team";
  const [gens, setGens] = useState<number[]>(initialGens);
  const [request, setRequest] = useState<StartRequest | null>(null);
  const [begun, setBegun] = useState<Promise<StartResponse | null> | null>(null);
  const [runKey, setRunKey] = useState(0);

  const settings = (): StartRequest => ({ module, format, difficulty, gens: gens.length ? gens : undefined, ...(hasScope && scope && { scope }) });

  // One per page view: it keeps the run held for the settings on screen.
  const prefetcher = useRef<QuizPrefetcher | null>(null);
  const warm = (req: StartRequest) => {
    prefetcher.current ??= createQuizPrefetcher({ post: postSession, preload: preloadHeld });
    prefetcher.current.prefetch(req, getProgress().name || undefined);
  };
  const latest = useRef(settings);
  latest.current = settings;

  const start = () => {
    const req = settings();
    setBegun(prefetcher.current?.take(req) ?? null);
    setRequest(req);
    setRunKey((k) => k + 1);
  };

  // When the page goes idle: the run as the page opened.
  const idled = useRef(false);
  useEffect(() => {
    let done = false;
    const run = () => {
      if (done) return;
      done = idled.current = true;
      warm(latest.current());
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 600 });
      return () => {
        done = true;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(run, 200);
    return () => {
      done = true;
      window.clearTimeout(id);
    };
  }, []);

  // After a setting changes (and settles), or back on this screen after a run: the run as it now
  // stands. Starting clears a pending one. The prefetcher caps the requests.
  const settingsKey = JSON.stringify([format, difficulty, gens, scope]);
  const playing = request !== null;
  useEffect(() => {
    if (!idled.current || playing) return;
    const id = window.setTimeout(() => warm(latest.current()), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [settingsKey, playing]);

  useEffect(() => {
    if (request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented) return;
      // Enter on a focused link, button or field belongs to that control.
      if (e.target instanceof HTMLElement && e.target.closest("a, button, input, select, textarea, [contenteditable='true']")) return;
      start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleGen = (g: number) =>
    setGens((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g].sort((a, b) => a - b)));

  return (
    <AnimatePresence mode="wait">
      {request ? (
        <motion.div key={`run-${runKey}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-4">
          <QuizController request={request} begun={begun} onRestart={start} />
          <div className="text-center">
            <button
              type="button"
              onClick={() => setRequest(null)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="h-4 w-4" /> Change settings
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div key="setup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.12 } }}>
          <Card className="mx-auto max-w-2xl">
            <CardContent className="space-y-6 p-6">
              <Field label="Format">
                <div className="grid grid-cols-3 gap-2">
                  {PLAYABLE_FORMATS.map((f) => (
                    <Choice key={f} active={format === f} onClick={() => setFormat(f)}>
                      <span className="font-display font-bold uppercase tracking-wider">{FORMAT_INFO[f].title}</span>
                      <span className="text-[11px] text-muted-foreground">{FORMAT_INFO[f].description}</span>
                    </Choice>
                  ))}
                </div>
              </Field>

              {choices.length > 0 && (
                <Field label="Difficulty">
                  <div className="grid grid-cols-2 gap-2" data-testid="quiz-difficulty">
                    {choices.map((d) => (
                      <Choice key={d.id} active={difficulty === d.id} onClick={() => setDifficulty(d.id)}>
                        <span className="font-display font-bold uppercase tracking-wider">{d.label}</span>
                        <span className="text-[11px] text-muted-foreground">{d.blurb}</span>
                      </Choice>
                    ))}
                  </div>
                </Field>
              )}

              {hasScope && (
                <Field label="Teams from">
                  <div className="flex flex-wrap gap-2">
                    {([
                      [null, "Games & anime"],
                      ["games", "Games"],
                      ["anime", "Anime"],
                    ] as const).map(([value, label]) => (
                      <Chip key={label} active={scope === value} onClick={() => setScope(value)}>
                        {label}
                      </Chip>
                    ))}
                  </div>
                </Field>
              )}

              <Field label={gens.length ? `${filter.label} (${gens.length} selected)` : `${filter.label} (all)`}>
                <div className="flex flex-wrap gap-2">
                  <Chip active={gens.length === 0} onClick={() => setGens([])}>All</Chip>
                  {filter.chips.map((chip, i) => (
                    <Chip key={chip.label} active={gens.includes(i + 1)} onClick={() => toggleGen(i + 1)} title={chip.title}>
                      {chip.label}
                    </Chip>
                  ))}
                </div>
                {gens.length === 0 && filter.note && <p className="text-xs text-muted-foreground">{filter.note}</p>}
              </Field>

              <Button
                size="lg"
                className="w-full"
                onClick={start}
                // A mouse hover or keyboard focus comes well before the click; a tap's comes with it, too late to help.
                onPointerEnter={(e) => e.pointerType === "mouse" && warm(settings())}
                onFocus={(e) => e.currentTarget.matches(":focus-visible") && warm(settings())}
              >
                <Play className="h-4 w-4 fill-current" /> Start {info.title}
              </Button>
            </CardContent>
          </Card>
          <div className="mx-auto mt-6 max-w-2xl">
            <QuizDuelCard module={module} difficulty={difficulty} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="hud-label">{label}</div>
      {children}
    </div>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-center gap-1 rounded-md border-2 px-2 py-3 text-center text-sm transition-colors",
        active
          ? "border-screen bg-screen/10 text-foreground shadow-[0_0_16px_-6px_hsl(var(--screen))]"
          : "border-foreground/10 bg-shade/20 text-muted-foreground hover:border-screen/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "rounded-sm border px-2.5 py-1.5 font-pixel text-[10px] uppercase tracking-wider transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:border-primary/50 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
