"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Map as MapIcon } from "lucide-react";
import type { GeoAnswer } from "@/lib/geo-types";
import type { GeoLearn } from "@/lib/geo-learn-types";
import { atlasSearchHref, placeLabel } from "@/lib/geo-names";
import { cn } from "@/lib/utils";

const cache = new Map<string, Promise<GeoLearn | null>>();
/** The fact about a place, asked once per place (after the guess: the card never exists before it). */
function learnOf(answer: Pick<GeoAnswer, "name" | "region" | "parent">): Promise<GeoLearn | null> {
  const region = answer.region ?? "Kanto";
  const key = `${region}|${answer.parent ?? ""}|${answer.name}`;
  let p = cache.get(key);
  if (!p) {
    const q = new URLSearchParams({ name: answer.name, region, ...(answer.parent ? { parent: answer.parent } : {}) });
    p = fetch(`/api/geo/learn?${q}`)
      .then((r) => (r.ok ? (r.json() as Promise<GeoLearn>) : null))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/**
 * The learn card under a round's result: the place (name, region and the
 * game the screenshot is from, with the screenshot as its artwork), one
 * verified fact from the Pokédex's place data when there is one, and links to
 * it on the World Atlas and in the Pokédex. Rendered only once the round is
 * graded, so nothing here can leak an answer.
 */
export function LearnCard({ answer, shot, map, className }: { answer: GeoAnswer; shot?: string; map?: { name: string }; className?: string }) {
  const [learn, setLearn] = useState<GeoLearn | null>(null);
  useEffect(() => {
    let off = false;
    setLearn(null);
    void learnOf(answer).then((l) => !off && setLearn(l));
    return () => {
      off = true;
    };
  }, [answer]);
  return (
    <div className={cn("flex min-w-0 items-start gap-3", className)} data-testid="geo-learn-card">
      {shot && (
        // eslint-disable-next-line @next/next/no-img-element -- the same cached screenshot, as a thumbnail
        <img src={shot} alt="" className="mt-0.5 h-12 w-16 shrink-0 rounded border border-white/20 object-cover" />
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-base font-bold uppercase leading-tight" data-testid="geo-answer-place">
          {placeLabel(answer, map)}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/70">
          {answer.region && <span>{answer.region}</span>}
          {learn?.type && <span>{learn.type}</span>}
          <span className="rounded-sm border border-white/30 px-1.5 py-0.5 text-[11px] text-white" data-testid="geo-answer-game">
            Pokémon {answer.game}
          </span>
          <Link href={atlasSearchHref(answer)} target="_blank" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-white" data-testid="geo-atlas-link">
            <MapIcon className="h-3 w-3" aria-hidden /> Atlas
          </Link>
          {learn?.href && (
            <Link href={learn.href} target="_blank" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-white" data-testid="geo-learn-link">
              <BookOpen className="h-3 w-3" aria-hidden /> Pokédex
            </Link>
          )}
        </p>
        {learn?.fact && (
          <p className="mt-1 max-w-md text-xs leading-snug text-[#c8bfff]" data-testid="geo-learn-fact">
            {learn.fact}
          </p>
        )}
      </div>
    </div>
  );
}
