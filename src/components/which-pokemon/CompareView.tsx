/* eslint-disable @next/next/no-img-element -- artwork comes pre-sized from /api/art */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShareButton } from "@/components/share/ShareButton";
import { artUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import { AXIS_INFO, type Profile } from "@/lib/which-pokemon/types";
import { QUIZ_PATH, compatibility, comparePath, matchProfile, nameOf, parseFragment, typesOf, type MatchResult } from "@/lib/which-pokemon/match";
import { lastResult, savePendingCompare } from "@/lib/which-pokemon/local";
import { TraitBars, TypeChips } from "./parts";
import { cn } from "@/lib/utils";

/**
 * Two results side by side with a compatibility score. Both results are in
 * the fragment (#a=…&b=…); with only `a`, the page invites the visitor to
 * take the quiz, remembering the friend's result for when they finish.
 */
export function CompareView() {
  const [a, setA] = useState<MatchResult | null>(null);
  const [b, setB] = useState<MatchResult | null>(null);
  const [mine, setMine] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const read = () => {
      const parts = parseFragment(window.location.hash);
      setA(parts.a ? matchProfile(parts.a) : null);
      setB(parts.b ? matchProfile(parts.b) : null);
      if (parts.a && !parts.b) {
        savePendingCompare(parts.a);
        setMine(lastResult());
      }
      setReady(true);
    };
    read();
    // A link to the same page with other results only changes the fragment.
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  if (!ready) return <div className="min-h-24" aria-hidden />;

  if (!a) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-4 p-6 text-center">
          <p className="text-muted-foreground">Open a compare link from a friend&apos;s result to see your two Pokémon side by side.</p>
          <Link href={QUIZ_PATH} className={cn(buttonVariants({ size: "lg" }), "h-14 w-full")}>
            <Sparkles className="h-5 w-5" aria-hidden /> Take the quiz
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!b) {
    return (
      <Card className="mx-auto max-w-xl" data-testid="wp-compare-invite">
        <CardContent className="space-y-5 p-6 text-center">
          <Portrait result={a} label="Your friend is" />
          <p className="text-muted-foreground">Take the quiz and you&apos;ll see how the two of you match, with a compatibility score.</p>
          <Link href={QUIZ_PATH} className={cn(buttonVariants({ size: "lg" }), "h-14 w-full")} data-testid="wp-compare-take">
            <Sparkles className="h-5 w-5" aria-hidden /> Find my Pokémon
          </Link>
          {mine && (
            <Link href={comparePath(a.scores, mine)} className="block text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="wp-compare-mine">
              Compare with your last result ({nameOf(matchProfile(mine).top.pokemon)})
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  const compat = compatibility(a.scores, b.scores);
  const nameA = nameOf(a.top.pokemon);
  const nameB = nameOf(b.top.pokemon);
  return (
    <div className="mx-auto max-w-3xl space-y-8" data-testid="wp-compare-result">
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 bg-gradient-to-br from-primary/15 via-transparent to-transparent p-5 sm:p-6">
          <Portrait result={a} />
          <div className="text-center">
            <p className="font-display text-5xl font-bold tabular-nums tracking-tight sm:text-6xl" data-testid="wp-compat">
              {compat.percent}%
            </p>
            <p className="hud-label mt-1 text-screen">compatible</p>
          </div>
          <Portrait result={b} />
        </div>
        <CardContent className="space-y-2 p-5 text-center sm:p-6">
          <p className="font-display text-lg font-bold uppercase tracking-wide">{compat.label}</p>
          <p className="text-sm text-muted-foreground">
            {nameA} and {nameB} agree most on <b className="text-foreground">{AXIS_INFO[compat.closest].label.toLowerCase()}</b> and differ most on{" "}
            <b className="text-foreground">{AXIS_INFO[compat.farthest].label.toLowerCase()}</b>.
          </p>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Trait by trait</h2>
        <TraitBars a={a.scores} b={b.scores} aLabel={nameA} bLabel={nameB} accent={typeColor(typesOf(b.top.pokemon)[0] ?? "normal")} testId="wp-compare-traits" />
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        <ShareButton size="lg" className="h-14" kind="which-pokemon-compare" label="Share this match" getText={() => `${nameA} + ${nameB}: ${compat.percent}% compatible. Which Pokémon are you?\n${window.location.origin}${comparePath(a.scores, b.scores)}`} />
        <Link href={QUIZ_PATH} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-14")}>
          <Users className="h-4 w-4" aria-hidden /> Take the quiz yourself
        </Link>
      </div>
    </div>
  );
}

function Portrait({ result, label }: { result: MatchResult; label?: string }) {
  const p = result.top.pokemon;
  return (
    <Link href={`${QUIZ_PATH}/${p.slug}`} className="flex flex-col items-center gap-1 text-center">
      {label && <span className="hud-label">{label}</span>}
      <img src={artUrl(p.id, 256)} alt="" width={128} height={128} className="h-24 w-24 object-contain sm:h-32 sm:w-32" />
      <span className="font-display text-lg font-bold uppercase tracking-wide">{nameOf(p)}</span>
      <span className="text-xs text-muted-foreground">{p.title}</span>
      <TypeChips types={typesOf(p)} className="justify-center" />
    </Link>
  );
}
