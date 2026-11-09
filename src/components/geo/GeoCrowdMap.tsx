"use client";
import { useEffect, useState } from "react";
import { ImageDown, Users } from "lucide-react";
import type { GeoCrowd } from "@/lib/geo-crowd";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GeoMap } from "./GeoMap";
import type { Played } from "./GeoGame";
import { cn } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The Daily's crowd map, after the last round: for each round, where everyone
 * pinned (a heat cloud), the answer's flag and the player's own pin. Asked
 * for with the signed result the game just gave (the server refuses anyone
 * who hasn't finished the day's Daily). Hidden until a round has enough pins.
 */
export function GeoCrowdMap({ date, region, played, resultToken }: { date: string; region: GeoRegionInfo; played: Played[]; resultToken?: string }) {
  const [crowd, setCrowd] = useState<GeoCrowd | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!resultToken) return;
    let off = false;
    fetch(`/api/geo/crowd?date=${encodeURIComponent(date)}&t=${encodeURIComponent(resultToken)}`)
      .then((r) => (r.ok ? (r.json() as Promise<GeoCrowd>) : null))
      .then((c) => !off && setCrowd(c))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [date, resultToken]);

  const rounds = crowd?.rounds.filter((r) => played[r.round - 1]) ?? [];
  if (!resultToken || !rounds.length) return null;
  const current = rounds.find((r) => r.round === pick) ?? rounds[0];
  const mine = played[current.round - 1];
  const cardUrl = `/api/geo/crowd/card?date=${encodeURIComponent(date)}&round=${current.round}&t=${encodeURIComponent(resultToken)}`;

  /** The round's share picture: the phone's share sheet when it takes files, else the picture in a new tab to save. */
  async function shareImage() {
    setSaving(true);
    try {
      const blob = await fetch(cardUrl).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))));
      const file = new File([blob], `pokeguessr-crowd-round-${current.round}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: "Where everyone pinned in today's PokéGuessr Daily" }).catch(() => undefined);
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
    } catch {
      window.open(cardUrl, "_blank", "noopener");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="geo-crowd">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="hud-label flex items-center gap-1.5 text-screen">
            <Users className="h-3.5 w-3.5" aria-hidden /> Crowd map
          </p>
          <p className="text-sm text-muted-foreground" data-testid="geo-crowd-count">
            {fmt(current.pins)} trainers pinned round {current.round}
          </p>
        </div>
        {rounds.length > 1 && (
          <div className="grid grid-cols-5 gap-1.5" role="tablist" aria-label="Round">
            {rounds.map((r) => (
              <button
                key={r.round}
                type="button"
                role="tab"
                aria-selected={r.round === current.round}
                onClick={() => setPick(r.round)}
                data-testid={`geo-crowd-round-${r.round}`}
                className={cn(
                  "h-9 rounded-md border font-pixel text-xs tabular-nums transition-colors",
                  r.round === current.round ? "border-primary bg-primary text-primary-foreground" : "border-border bg-shade/20 text-muted-foreground hover:text-foreground"
                )}
              >
                R{r.round}
              </button>
            ))}
          </div>
        )}
        <GeoMap
          key={current.round}
          region={region}
          land
          density={current}
          revealed={[{ guess: mine.guess, answer: mine.graded.answer, label: "You" }]}
          className="max-h-[60vh] sm:max-h-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[radial-gradient(circle,#ff4f6d,#ffb23c_60%,#ffe46b00)]" aria-hidden /> Everyone&apos;s pins
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full border-2 border-white bg-[#120f24]" aria-hidden /> The answer
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full border-2 border-[#120f24] bg-[#3a8dde]" aria-hidden /> You
            </span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void shareImage()} disabled={saving} data-testid="geo-crowd-share">
            <ImageDown className="h-4 w-4" aria-hidden /> {saving ? "Making the picture…" : "Share this map"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
