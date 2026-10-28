"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DOMAIN_INFO, DOMAINS } from "@/lib/cognitive/types";
import { ordinal } from "@/lib/cognitive/scoring";
import { iqTitle, ratingToIQ } from "@/lib/rating";
import { useProgress } from "@/lib/progress";
import { CognitiveTest } from "./CognitiveTest";

/** /iq-test: the landing, then the five-section test (CognitiveTest). */
export function IqTest() {
  const progress = useProgress();
  const [round, setRound] = useState(0);
  const [playing, setPlaying] = useState(false);
  const knowledge = progress?.rating != null ? ratingToIQ(progress.rating) : null;
  const cognitive = progress?.cognitive ?? null;

  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <p className="hud-label text-screen">The PokéIQ Test</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          A cognitive test <span className="text-primary">made of Pokémon</span>
        </h1>
        {!playing && (
          <p className="text-muted-foreground">
            Five timed sections, about 20 minutes: reasoning, memory, speed and spatial skills, then Pokémon knowledge. Scored against other trainers; not a clinical IQ test.
          </p>
        )}
      </div>

      {playing ? (
        <CognitiveTest key={round} onRetake={() => setRound((r) => r + 1)} />
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mx-auto max-w-2xl">
            <CardContent className="space-y-6 p-6">
              <ol className="grid gap-2 sm:grid-cols-5" aria-label="The five sections">
                {DOMAINS.map((d, i) => (
                  <li key={d} className="rounded-md border bg-muted/30 px-3 py-2.5 text-center">
                    <div className="font-pixel text-[10px] text-muted-foreground">{i + 1}</div>
                    <div className="text-sm font-semibold">{DOMAIN_INFO[d].short}</div>
                  </li>
                ))}
              </ol>
              {(cognitive || knowledge !== null) && (
                <p className="text-center text-sm text-muted-foreground" data-testid="iq-current">
                  {cognitive && (
                    <>
                      Your Cognitive PokéIQ: <b className="text-foreground">{cognitive.score}</b> ({ordinal(cognitive.percentile)} percentile).{" "}
                    </>
                  )}
                  {knowledge !== null && (
                    <>
                      Knowledge PokéIQ: <b className="text-foreground">{knowledge}</b> ({iqTitle(knowledge)}).
                    </>
                  )}
                </p>
              )}
              <Button size="lg" className="h-14 w-full text-base" onClick={() => setPlaying(true)} data-testid="iq-start">
                <Play className="h-5 w-5" aria-hidden /> Start the test
              </Button>
              <p className="text-center text-xs text-muted-foreground">Keys 1–6 pick an option. Every retake draws fresh items.</p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
