"use client";

import Link from "@/components/ui/Link";
import { ArrowRight, Flame } from "lucide-react";
import { useProgress } from "@/lib/progress";
import { GEO_REGION_STREAK_KEY } from "@/lib/geo-streak-types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// Four regions across the eras (Kanto, Johto, Alola, Paldea), so it never matches a one-region tile beside it.
import art from "@/assets/guessr/region-streak.webp";
import { HubTile } from "./HubParts";

/** The PokéGuessr hub's way into Region Streak (/pokeguessr/streak): one screenshot, name the region, no pin. */
export function RegionStreakCard() {
  const progress = useProgress();
  const best = progress?.best[`geo:${GEO_REGION_STREAK_KEY}`] ?? 0;
  return (
    <HubTile
      testId="region-streak-card"
      tone="warning"
      image={art.src}
      icon={<Flame className="h-5 w-5" />}
      label="Region Streak"
      title="Which region is this?"
      blurb="Name the region from a screenshot."
      stat={best > 0 ? `Your best: ${best} in a row` : null}
      action={
        <Link href="/pokeguessr/streak" className={cn(buttonVariants({ variant: "secondary" }), "w-full")} data-testid="region-streak-link">
          Play Region Streak <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    />
  );
}
