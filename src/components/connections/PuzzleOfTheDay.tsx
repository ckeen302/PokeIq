"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { Star, ThumbsUp } from "lucide-react";
import { customPath } from "@/lib/connections/custom";
import { creatorPath, type ConnPotdResponse } from "@/lib/connections/social";
import { awardFeaturedCreator, type BadgeDef } from "@/lib/progress";
import { dlePlayerId } from "@/lib/dle-player";
import { NewBadges } from "./results";
import { useT } from "@/i18n/client";
import cards from "@/messages/connections-cards";

/** The Puzzle of the Day card on /pokeconnections; also awards the "Featured creator" badge when one of yours was picked. */
export function PuzzleOfTheDay() {
  const t = useT(cards);
  const [potd, setPotd] = useState<ConnPotdResponse | null>(null);
  const [badges, setBadges] = useState<BadgeDef[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/connections/potd")
      .then((r) => (r.ok ? (r.json() as Promise<ConnPotdResponse>) : null))
      .then((d) => live && d && setPotd(d))
      .catch(() => undefined);
    fetch("/api/connections/featured", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: dlePlayerId() }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ featured: boolean }>) : null))
      .then((d) => {
        if (live && d?.featured) setBadges(awardFeaturedCreator());
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const p = potd?.puzzle;
  if (!p && !badges.length) return null;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {p && (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/[0.06] px-4 py-3"
          aria-label={t("potd.aria")}
          data-testid="conn-potd"
        >
          <div className="min-w-0">
            <p className="hud-label flex items-center gap-1 text-warning">
              <Star className="h-3.5 w-3.5" aria-hidden /> {t("potd.title")}
            </p>
            <p className="truncate font-display text-lg font-bold">
              {p.title ?? t("potd.untitled")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t.rich("potd.by", {
                c: () =>
                  p.creator ? (
                    <Link
                      href={creatorPath(p.creator)}
                      className="text-primary hover:underline"
                    >
                      {p.creator}
                    </Link>
                  ) : (
                    t("potd.aTrainer")
                  ),
              })}{" "}
              · {p.up}{" "}
              <ThumbsUp className="inline h-3 w-3" aria-label={t("potd.upVotes")} />
            </p>
          </div>
          <Link
            href={customPath(p.id)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t("potd.play")}
          </Link>
        </section>
      )}
      <NewBadges badges={badges} />
    </div>
  );
}
