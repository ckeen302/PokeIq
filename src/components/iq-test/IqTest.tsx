"use client";

import { useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DOMAINS, type CogLocal } from "@/lib/cognitive/types";
import { iqTitle, ratingToIQ } from "@/lib/rating";
import { useProgress } from "@/lib/progress";
import { CognitiveTest } from "./CognitiveTest";
import { CogLocalProvider } from "./local";
import { rankKey } from "./rank";
import { useT } from "@/i18n/client";
import play from "@/messages/iq-test-play";

const bold = (c: ReactNode[]) => <b className="text-foreground">{c}</b>;

/** /iq-test: the landing, then the five-section test (CognitiveTest). */
export function IqTest({ local }: { local?: CogLocal }) {
  const t = useT(play);
  const progress = useProgress();
  const [round, setRound] = useState(0);
  const [playing, setPlaying] = useState(false);
  const knowledge = progress?.rating != null ? ratingToIQ(progress.rating) : null;
  const cognitive = progress?.cognitive ?? null;

  return (
    <CogLocalProvider local={local}>
    <div className="space-y-8">
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <p className="hud-label max-md:hidden text-screen">{t("kicker")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          {t.rich("h1", { p: (c) => <span className="text-primary">{c}</span> })}
        </h1>
        {!playing && (
          <p className="text-muted-foreground">
            {t("lead")}
          </p>
        )}
      </div>

      {playing ? (
        <CognitiveTest key={round} onRetake={() => setRound((r) => r + 1)} />
      ) : (
        // A CSS entrance, not a script one: the start card paints with the page, before the scripts load.
        <div className="duration-300 animate-in fade-in-0 slide-in-from-bottom-3">
          <Card className="mx-auto max-w-2xl">
            <CardContent className="space-y-6 p-6">
              <ol className="grid gap-2 sm:grid-cols-5" aria-label={t("sections")}>
                {DOMAINS.map((d, i) => (
                  <li key={d} className="rounded-md border bg-muted/30 px-3 py-2.5 text-center">
                    <div className="font-pixel text-[10px] text-muted-foreground">{i + 1}</div>
                    <div className="text-sm font-semibold">{t(`domains.${d}.short`)}</div>
                  </li>
                ))}
              </ol>
              {(cognitive || knowledge !== null) && (
                <p className="text-center text-sm text-muted-foreground" data-testid="iq-current">
                  {cognitive && (
                    <>
                      {t.rich("currentCognitive", { score: cognitive.score, p: Math.round(cognitive.percentile), b: bold })}{" "}
                    </>
                  )}
                  {knowledge !== null && (
                    <>
                      {t.rich("currentKnowledge", { iq: knowledge, title: t(`ranks.${rankKey(iqTitle(knowledge))}`), b: bold })}
                    </>
                  )}
                </p>
              )}
              <Button size="lg" className="h-14 w-full text-base" onClick={() => setPlaying(true)} data-testid="iq-start">
                <Play className="h-5 w-5" aria-hidden /> {t("start")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                <span className="max-md:hidden">{t("keys")}</span>{t("fresh")}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
    </CogLocalProvider>
  );
}
