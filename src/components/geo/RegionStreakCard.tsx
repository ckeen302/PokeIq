"use client";

import Link from "next/link";
import { ArrowRight, Flame } from "lucide-react";
import { useProgress } from "@/lib/progress";
import { GEO_REGION_STREAK_KEY, GEO_STREAK_REGIONS } from "@/lib/geo-streak-types";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** The PokéGuessr hub's way into Region Streak (/guessr/streak): one screenshot, name the region, no pin. */
export function RegionStreakCard() {
  const progress = useProgress();
  const best = progress?.best[`geo:${GEO_REGION_STREAK_KEY}`] ?? 0;
  return (
    <Card className="overflow-hidden border-warning/40" data-testid="region-streak-card">
      <div className="grid md:grid-cols-[1fr_auto]">
        <CardContent className="space-y-2 p-6">
          <p className="hud-label flex items-center gap-1.5 text-warning">
            <Flame className="h-3.5 w-3.5" aria-hidden /> Region Streak
          </p>
          <p className="font-display text-2xl font-bold uppercase">Which region is this?</p>
          <p className="text-sm text-muted-foreground">
            No pin: one screenshot, pick the region from {GEO_STREAK_REGIONS[0]} to {GEO_STREAK_REGIONS[GEO_STREAK_REGIONS.length - 1]}. Right deals the next one, wrong ends the run.
            {best > 0 ? ` Your best: ${best} in a row.` : ""}
          </p>
        </CardContent>
        <div className="flex items-center p-6 pt-0 md:pt-6">
          <Link href="/guessr/streak" className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "w-full md:w-auto")} data-testid="region-streak-link">
            Play Region Streak <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}
