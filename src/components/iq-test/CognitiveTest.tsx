"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { ArrowRight } from "lucide-react";
import { START_LEVEL, rawScore, stepLevel } from "@/lib/cognitive/adaptive";
import { clockMs, fastMode } from "@/lib/cognitive/fast";
import { spanCorrect } from "@/lib/cognitive/memory";
import { NORMS } from "@/lib/cognitive/norms";
import { PLAN, sectionItem } from "@/lib/cognitive/plan";
import { cognitiveRecord, type CognitiveRecord } from "@/lib/cognitive/result";
import { scoreTest } from "@/lib/cognitive/scoring";
import { speedRaw } from "@/lib/cognitive/speed";
import { DOMAIN_INFO, type CogItem, type CogSection, type Domain, type Level } from "@/lib/cognitive/types";
import { recordRun } from "@/lib/progress";
import { play, vibrate } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HpBar } from "@/components/game/HpBar";
import { QuizController } from "@/components/quiz/QuizController";
import { cn } from "@/lib/utils";
import { CognitiveResults } from "./CognitiveResults";
import { ArithView, MatrixView, NumberView, PathView, PileView, RotationView } from "./ItemViews";
import { SpanView } from "./SpanView";
import { SpeedSection } from "./SpeedSection";

/**
 * The test runner: five sections in order, one item at a time, a one-line
 * intro before each. Reasoning, memory and spatial step up a level after a
 * right answer and down after a wrong one; speed is one 75-second block;
 * knowledge is the existing adaptive quiz (its rating keeps updating as
 * before). Every item comes from (seed, section, slot, level), so a retake
 * with a new seed is a fresh test.
 */

const ORDER: readonly Domain[] = ["fluid", "memory", "speed", "spatial", "knowledge"];
type Adaptive = Exclude<CogSection, "speed">;

type Stage =
  | { s: "intro"; domain: Domain }
  | { s: "item"; section: Adaptive; index: number; level: Level; item: CogItem }
  | { s: "speed" }
  | { s: "knowledge" }
  | { s: "results"; record: CognitiveRecord };

/** Progress-bar weight of each section (about its share of the time). */
const UNITS: Record<Domain, number> = { fluid: PLAN.fluid.items, memory: PLAN.memory.items, speed: 6, spatial: PLAN.spatial.items, knowledge: 20 };
const TOTAL_UNITS = ORDER.reduce((s, d) => s + UNITS[d], 0);
const FEEDBACK_MS = 550;

const newSeed = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function CognitiveTest({ onRetake }: { onRetake: () => void }) {
  const [seed] = useState(newSeed);
  const [stage, setStage] = useState<Stage>({ s: "intro", domain: "fluid" });
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [clockStart, setClockStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [knowledgeAnswered, setKnowledgeAnswered] = useState(0);

  const results = useRef<Record<Adaptive, { level: Level; correct: boolean }[]>>({ fluid: [], memory: [], spatial: [] });
  const speed = useRef(0);
  const knowledge = useRef<number | null>(null);
  const anchors = useRef(new Set<string>());
  const answeredRef = useRef(false);
  const fast = fastMode();

  // ---- flow ----------------------------------------------------------------
  const showItem = useCallback(
    (section: Adaptive, index: number, level: Level) => {
      const item = sectionItem(section, seed, index, level, section === "fluid" ? anchors.current : undefined);
      answeredRef.current = false;
      setPicked(null);
      setCorrect(null);
      // A span's clock starts when the recall grid appears.
      setClockStart(item.kind === "span" ? null : Date.now());
      setNow(Date.now());
      setStage({ s: "item", section, index, level, item });
    },
    [seed]
  );

  const finish = useCallback(() => {
    const raw = { fluid: rawScore(results.current.fluid), memory: rawScore(results.current.memory), speed: speed.current, spatial: rawScore(results.current.spatial) };
    const record = cognitiveRecord(scoreTest(raw, NORMS), knowledge.current);
    setStage({ s: "results", record });
  }, []);

  const begin = useCallback(
    (domain: Domain) => {
      track("cognitive_section", { section: domain });
      if (domain === "speed") setStage({ s: "speed" });
      else if (domain === "knowledge") setStage({ s: "knowledge" });
      else showItem(domain, 0, START_LEVEL);
    },
    [showItem]
  );

  const nextAfter = useCallback(
    (domain: Domain) => {
      const i = ORDER.indexOf(domain);
      if (i + 1 < ORDER.length) setStage({ s: "intro", domain: ORDER[i + 1] });
      else finish();
    },
    [finish]
  );

  /** One adaptive item answered (or timed out). */
  const answered = useCallback(
    (ok: boolean, pick: number | null) => {
      if (stage.s !== "item" || answeredRef.current) return;
      answeredRef.current = true;
      results.current[stage.section].push({ level: stage.level, correct: ok });
      setPicked(pick);
      setCorrect(ok);
      if (ok) play("correct");
      else {
        play("wrong");
        vibrate(40);
      }
      const { section, index, level } = stage;
      setTimeout(() => {
        if (index + 1 < PLAN[section].items) showItem(section, index + 1, stepLevel(level, ok));
        else nextAfter(section);
      }, FEEDBACK_MS);
    },
    [stage, showItem, nextAfter]
  );

  const pickOption = useCallback(
    (i: number) => {
      if (stage.s !== "item" || stage.item.kind === "span" || picked !== null) return;
      answered(i === stage.item.answer, i);
    },
    [stage, picked, answered]
  );

  const speedDone = useCallback(
    (hits: number, falseTaps: number) => {
      speed.current = speedRaw(hits, falseTaps);
      nextAfter("speed");
    },
    [nextAfter]
  );

  // ---- clock ---------------------------------------------------------------
  const itemMs = stage.s === "item" ? clockMs(stage.item.timeMs, fast) : 0;
  const msLeft = stage.s === "item" && clockStart !== null ? Math.max(0, itemMs - (now - clockStart)) : null;
  useEffect(() => {
    if (stage.s !== "item" || clockStart === null || picked !== null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [stage.s, clockStart, picked]);
  useEffect(() => {
    if (stage.s === "item" && msLeft === 0 && picked === null && !answeredRef.current) answered(false, null);
  }, [stage.s, msLeft, picked, answered]);

  // ---- keyboard ------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (stage.s === "intro" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        begin(stage.domain);
      } else if (stage.s === "item" && stage.item.kind !== "span" && /^[1-6]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < stage.item.options.length) pickOption(i);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, begin, pickOption]);

  // ---- progress ------------------------------------------------------------
  const sectionNo = (d: Domain) => ORDER.indexOf(d) + 1;
  const doneUnits = (() => {
    const before = (d: Domain) => ORDER.slice(0, ORDER.indexOf(d)).reduce((s, x) => s + UNITS[x], 0);
    switch (stage.s) {
      case "intro":
        return before(stage.domain);
      case "item":
        return before(stage.section) + stage.index;
      case "speed":
        return before("speed");
      case "knowledge":
        return before("knowledge") + knowledgeAnswered;
      case "results":
        return TOTAL_UNITS;
    }
  })();

  if (stage.s === "results") return <CognitiveResults record={stage.record} onRetake={onRetake} />;

  const domain: Domain = stage.s === "intro" ? stage.domain : stage.s === "item" ? stage.section : stage.s;
  const opts = { picked, correct, onPick: pickOption };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      <div className="space-y-1.5 px-1" data-testid="cog-progress">
        <div className="flex items-center justify-between font-pixel text-[11px] text-muted-foreground">
          <span>
            Section {sectionNo(domain)}/5 · <span className="text-foreground">{DOMAIN_INFO[domain].title}</span>
          </span>
          {stage.s === "item" && (
            <span>
              Item {stage.index + 1}/{PLAN[stage.section].items}
            </span>
          )}
        </div>
        <HpBar value={doneUnits / TOTAL_UNITS} />
      </div>

      <AnimatePresence mode="wait">
        {stage.s === "intro" && (
          <motion.div key={`intro-${stage.domain}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
            <Card data-testid="cog-intro">
              <CardContent className="space-y-5 p-6 text-center">
                <p className="hud-label text-screen">Section {sectionNo(stage.domain)} of 5</p>
                <h2 className="font-display text-3xl font-bold uppercase tracking-tight">{DOMAIN_INFO[stage.domain].title}</h2>
                <p className="text-muted-foreground">{DOMAIN_INFO[stage.domain].intro}</p>
                <Button size="lg" className="h-14 w-full text-base" onClick={() => begin(stage.domain)} data-testid="cog-begin">
                  Begin <ArrowRight className="h-5 w-5" aria-hidden />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {stage.s === "item" && (
          <motion.div key={stage.item.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
            <Card className="overflow-hidden" data-testid="cog-item" data-kind={stage.item.kind}>
              {msLeft !== null && (
                <div className="flex items-center gap-3 px-4 pt-4 sm:px-6">
                  <HpBar value={msLeft / itemMs} label="TIME" className="flex-1" />
                  <span className={cn("w-8 text-right font-pixel text-xs tabular-nums", msLeft < itemMs * 0.25 && "animate-blink text-destructive")}>{Math.ceil(msLeft / 1000)}</span>
                </div>
              )}
              <CardContent className="p-4 sm:p-6">
                {stage.item.kind === "matrix" && <MatrixView item={stage.item} {...opts} />}
                {stage.item.kind === "number" && <NumberView item={stage.item} {...opts} />}
                {stage.item.kind === "arith" && <ArithView item={stage.item} {...opts} />}
                {stage.item.kind === "rotation" && <RotationView item={stage.item} {...opts} />}
                {stage.item.kind === "path" && <PathView item={stage.item} {...opts} />}
                {stage.item.kind === "pile" && <PileView item={stage.item} {...opts} />}
                {stage.item.kind === "span" && (
                  <SpanView
                    item={stage.item}
                    showMs={fast ? 120 : stage.item.showMs}
                    onRecallStart={() => {
                      setClockStart(Date.now());
                      setNow(Date.now());
                    }}
                    onAnswer={(taps) => stage.item.kind === "span" && answered(spanCorrect(stage.item, taps), 0)}
                  />
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {stage.s === "speed" && (
          <motion.div key="speed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card>
              <CardContent className="p-4 sm:p-6">
                <SpeedSection seed={seed} ms={fast ? 5_000 : PLAN.speed.ms} onDone={speedDone} />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {stage.s === "knowledge" && (
          <motion.div key="knowledge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="cog-knowledge">
            <QuizController
              request={{ module: "mixed", format: "adaptive", difficulty: "medium" }}
              onAnswered={setKnowledgeAnswered}
              onComplete={(result, tokens) => {
                recordRun(result, tokens.shareToken);
                knowledge.current = result.pokeiq;
                finish();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
