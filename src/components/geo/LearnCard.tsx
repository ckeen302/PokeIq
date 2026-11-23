"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { BookOpen, Map as MapIcon } from "lucide-react";
import type { GeoAnswer } from "@/lib/geo-types";
import type { GeoLearn } from "@/lib/geo-learn-types";
import { atlasSearchHref, placeLabel } from "@/lib/geo-names";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import geoNs from "@/messages/geo";
import geoNamesNs from "@/messages/geo-names";
import { useGeoNames } from "@/lib/geo-i18n-client";

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
export function LearnCard({ answer, shot, map, className, learn: given }: { answer: GeoAnswer; shot?: string; map?: { name: string }; className?: string; /** The fact, when it came with the guess's answer (no request then). */ learn?: GeoLearn | null }) {
  const t = useT(geoNs);
  const names = useGeoNames();
  const gn = useT(geoNamesNs);
  const en = t.locale === "en";
  const [asked, setLearn] = useState<GeoLearn | null>(null);
  const learn = given !== undefined ? given : asked;
  useEffect(() => {
    if (given !== undefined) return;
    let off = false;
    setLearn(null);
    void learnOf(answer).then((l) => !off && setLearn(l));
    return () => {
      off = true;
    };
  }, [answer, given]);
  return (
    <div className={cn("flex min-w-0 items-start gap-3", className)} data-testid="geo-learn-card">
      {shot && (
        // eslint-disable-next-line @next/next/no-img-element -- the same cached screenshot, as a thumbnail
        <img src={shot} alt="" className="mt-0.5 h-12 w-16 shrink-0 rounded border border-white/20 object-cover" />
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-base font-bold uppercase leading-tight max-md:whitespace-normal max-md:text-sm max-md:[overflow-wrap:anywhere]" data-testid="geo-answer-place">
          {en ? placeLabel(answer, map) : names.placeLabel(answer, map)}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/70">
          {answer.region && <span>{names.region(answer.region)}</span>}
          {learn?.type && learn.type !== "Other" && learn.type !== "Building" && (
            <span className="text-white/50">· {t.locale === "en" ? learn.type : gn.has(`types.${learn.type}`) ? gn(`types.${learn.type}` as "types.City") : learn.type}</span>
          )}
          <span className="rounded-sm border border-white/30 px-1.5 py-0.5 text-[11px] text-white" data-testid="geo-answer-game">
            {en ? <>Pokémon {answer.game}</> : gn("game", { game: names.game(answer.game) })}
          </span>
          <Link href={atlasSearchHref(answer)} target="_blank" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-white" data-testid="geo-atlas-link">
            <MapIcon className="h-3 w-3" aria-hidden />{` ${t("learn.atlas")}`}
          </Link>
          {learn?.href && (
            <Link href={learn.href} target="_blank" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-white" data-testid="geo-learn-link">
              <BookOpen className="h-3 w-3" aria-hidden />{` ${t("learn.dex")}`}
            </Link>
          )}
        </p>
        {/* The fact is written in English (the place data's): other languages show the name and game alone. */}
        {learn?.fact && en && (
          <p className="mt-1 line-clamp-2 max-w-md text-xs leading-snug text-[#c8bfff] md:line-clamp-none" data-testid="geo-learn-fact">
            {learn.fact}
          </p>
        )}
      </div>
    </div>
  );
}
