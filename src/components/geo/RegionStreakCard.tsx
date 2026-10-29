"use client";

import Link from "next/link";
import { ArrowRight, Flame } from "lucide-react";
import { useProgress } from "@/lib/progress";
import { GEO_REGION_STREAK_KEY, GEO_STREAK_REGIONS } from "@/lib/geo-streak-types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import art from "@/assets/guessr/hoenn.webp";
import { HubTile } from "./HubParts";

/** The PokéGuessr hub's way into Region Streak (/guessr/streak): one screenshot, name the region, no pin. */
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
      blurb={`No pin: one screenshot, pick the region from ${GEO_STREAK_REGIONS[0]} to ${GEO_STREAK_REGIONS[GEO_STREAK_REGIONS.length - 1]}. Right deals the next one, wrong ends the run.`}
      stat={best > 0 ? `Your best: ${best} in a row` : null}
      action={
        <Link href="/guessr/streak" className={cn(buttonVariants({ variant: "secondary" }), "w-full")} data-testid="region-streak-link">
          Play Region Streak <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    />
  );
}
