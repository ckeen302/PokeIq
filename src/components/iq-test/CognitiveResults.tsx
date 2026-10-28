"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { track } from "@vercel/analytics";
import { RotateCcw, User } from "lucide-react";
import { fastMode } from "@/lib/cognitive/fast";
import { cognitiveTitle, profileBars, profileWords, type CognitiveRecord } from "@/lib/cognitive/result";
import { ordinal } from "@/lib/cognitive/scoring";
import { DOMAIN_INFO } from "@/lib/cognitive/types";
import { recordCognitive } from "@/lib/progress";
import { iqTitle } from "@/lib/rating";
import { cognitiveShareText, shareUrl, type CognitiveShareResult } from "@/lib/share";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ShareButton } from "@/components/share/ShareButton";
import { cn } from "@/lib/utils";

const recorded = new Set<number>();

/** The result page: the composite and its percentile, five bars, plain-words strengths, a share card and a retake. */
export function CognitiveResults({ record, onRetake }: { record: CognitiveRecord; onRetake: () => void }) {
  const bars = profileBars(record);
  const words = profileWords(record);
  const firedRef = useRef(false);

  // Kept in progress and logged anonymously, once per run.
  useEffect(() => {
    if (recorded.has(record.at)) return;
    recorded.add(record.at);
    recordCognitive(record);
    track("cognitive_complete", { score: record.score });
    if (fastMode()) return;
    void fetch("/api/iq-test/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fluid: record.sections.fluid.raw, memory: record.sections.memory.raw, speed: record.sections.speed.raw, spatial: record.sections.spatial.raw, composite: record.score }),
    }).catch(() => undefined);
  }, [record]);

  const scoreValue = useMotionValue(70);
  const scoreDisplay = useTransform(scoreValue, (v) => Math.round(v));
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const a = animate(scoreValue, record.score, { duration: 1.4, ease: "easeOut" });
    return () => a.stop();
  }, [record.score, scoreValue]);

  const share = (): CognitiveShareResult => ({
    game: "cognitive",
    score: record.score,
    percentile: record.percentile,
    fluid: record.sections.fluid.scaled,
    memory: record.sections.memory.scaled,
    speed: record.sections.speed.scaled,
    spatial: record.sections.spatial.scaled,
    ...(record.knowledge !== undefined && { knowledge: record.knowledge }),
  });

  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35 }}>
      <Card className="mx-auto w-full max-w-2xl overflow-hidden" data-testid="cog-results">
        <div className="flex items-center justify-between border-b border-foreground/[0.07] bg-shade/30 px-6 py-3">
          <span className="hud-label flex items-center gap-2 text-screen">
            <span className="led h-1.5 w-1.5 text-screen" /> PokéIQ Test complete
          </span>
          <span className="hud-label">{cognitiveTitle(record.score)}</span>
        </div>
        <CardHeader className="items-center space-y-4 text-center">
          <div className="screen w-full max-w-md rounded-md px-5 py-4">
            <div className="hud-label relative z-[3]">Cognitive PokéIQ</div>
            <motion.div className="relative z-[3] font-display text-6xl font-bold tabular-nums text-screen [text-shadow:0_0_18px_hsl(var(--screen)/0.6)]" data-testid="cog-score">
              {scoreDisplay}
            </motion.div>
            <div className="relative z-[3] text-sm text-muted-foreground" data-testid="cog-percentile">
              {ordinal(record.percentile)} percentile of trainers
            </div>
          </div>
          <p className="max-w-md text-sm text-muted-foreground">
            Cognitive PokéIQ {record.score} · {ordinal(record.percentile)} percentile of trainers. Measures reasoning, memory, speed and spatial skills with Pokémon, scored against other
            trainers; not a clinical IQ test.
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2.5" data-testid="cog-profile">
            {bars.map((b, i) => (
              <div key={b.domain} className="grid grid-cols-[88px_1fr_44px] items-center gap-3 text-sm" data-testid="cog-bar">
                <span className={cn("font-semibold", b.domain === "knowledge" && "text-muted-foreground")}>{b.label}</span>
                <div className="meter h-3 w-full" role="img" aria-label={`${DOMAIN_INFO[b.domain].title}: ${b.scaled}, ${ordinal(b.percentile)} percentile`}>
                  <motion.div
                    className={cn("h-full", b.domain === "knowledge" ? "bg-warning" : "bg-screen")}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(3, ((b.scaled - 55) / 90) * 100)}%` }}
                    transition={{ delay: 0.3 + i * 0.1, duration: 0.6, ease: "easeOut" }}
                  />
                </div>
                <span className="text-right font-display text-base font-bold tabular-nums">{b.scaled}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Each bar is on the same mean-100 scale. The first four make the cognitive score; knowledge is the PokéIQ rating from the quiz section
              {record.knowledge !== undefined ? ` (${record.knowledge}, ${iqTitle(record.knowledge)})` : ""} and is scored separately.
            </p>
          </div>

          <div className="rounded-md border border-foreground/10 bg-muted/30 p-4 text-sm" data-testid="cog-words">
            {words.even ? (
              <p>An even profile: no section stood clearly above or below the others.</p>
            ) : (
              <>
                {words.strengths.length > 0 && (
                  <p>
                    <b className="text-success">Strengths:</b> {words.strengths.join("; ")}.
                  </p>
                )}
                {words.weaknesses.length > 0 && (
                  <p className={cn(words.strengths.length > 0 && "mt-1.5")}>
                    <b className="text-warning">Harder for you:</b> {words.weaknesses.join("; ")}.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <ShareButton size="lg" kind="cognitive" getText={() => cognitiveShareText(share(), shareUrl(share()))} />
            <Button size="lg" variant="secondary" onClick={onRetake} data-testid="cog-retake">
              <RotateCcw className="h-4 w-4" aria-hidden /> Retake with fresh items
            </Button>
          </div>
          <Link href="/trainer" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
            <User className="h-4 w-4" aria-hidden /> See it on your trainer card
          </Link>
        </CardContent>
      </Card>
    </motion.div>
  );
}
