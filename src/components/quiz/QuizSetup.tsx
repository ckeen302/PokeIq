"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, Settings2 } from "lucide-react";
import { DIFFICULTIES, type Difficulty, type ModuleId, type QuizFormat } from "@/engines/types";
import { FORMAT_INFO, MODULE_INFO, PLAYABLE_FORMATS } from "@/lib/modes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QuizController, type StartRequest } from "./QuizController";
import { cn } from "@/lib/utils";

/**
 * Pre-game setup: format, difficulty and generation filter. Starting needs
 * a click on purpose — it's the user gesture that unlocks cry audio.
 */

const REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];

interface QuizSetupProps {
  module: ModuleId;
  initialFormat?: QuizFormat;
  initialDifficulty?: Difficulty;
  initialGens?: number[];
}

export function QuizSetup({ module, initialFormat, initialDifficulty = "medium", initialGens = [] }: QuizSetupProps) {
  const info = MODULE_INFO[module];
  const [format, setFormat] = useState<QuizFormat>(initialFormat ?? info.defaultFormat);
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
  const [gens, setGens] = useState<number[]>(initialGens);
  const [request, setRequest] = useState<StartRequest | null>(null);
  const [runKey, setRunKey] = useState(0);

  const start = () => {
    setRequest({ module, format, difficulty, gens: gens.length ? gens : undefined });
    setRunKey((k) => k + 1);
  };

  useEffect(() => {
    if (request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleGen = (g: number) =>
    setGens((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g].sort((a, b) => a - b)));

  return (
    <AnimatePresence mode="wait">
      {request ? (
        <motion.div key={`run-${runKey}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
          <QuizController request={request} onRestart={start} />
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
        <motion.div key="setup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
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

              <Field label="Difficulty">
                <div className="grid grid-cols-3 gap-2">
                  {DIFFICULTIES.map((d) => (
                    <Choice key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>
                      <span className="font-display font-bold uppercase tracking-wider">{d}</span>
                    </Choice>
                  ))}
                </div>
              </Field>

              <Field label={gens.length ? `Generations (${gens.length} selected)` : "Generations (all)"}>
                <div className="flex flex-wrap gap-2">
                  <Chip active={gens.length === 0} onClick={() => setGens([])}>All</Chip>
                  {REGIONS.map((region, i) => (
                    <Chip key={region} active={gens.includes(i + 1)} onClick={() => toggleGen(i + 1)} title={region}>
                      Gen {i + 1}
                    </Chip>
                  ))}
                </div>
                {gens.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Without a filter, Easy uses Gens 1–2, Medium Gens 1–5 and Hard all nine.
                  </p>
                )}
              </Field>

              <Button size="lg" className="w-full" onClick={start}>
                <Play className="h-4 w-4 fill-current" /> Start {info.title}
              </Button>
            </CardContent>
          </Card>
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
          : "border-white/10 bg-black/20 text-muted-foreground hover:border-screen/40 hover:text-foreground"
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
        active ? "border-primary bg-primary text-primary-foreground" : "border-white/10 bg-black/20 text-muted-foreground hover:border-primary/50 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
