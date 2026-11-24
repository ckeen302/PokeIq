"use client";
import { useEffect, useState } from "react";
import { ImageDown, Users } from "lucide-react";
import type { GeoCrowd } from "@/lib/geo-crowd";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import geoSolo from "@/messages/geo-solo";

/**
 * The Daily's crowd map, after the last round: for each round, where everyone
 * pinned (a heat cloud on the breakdown's map, under the answer's flag and the
 * player's own pin). Asked for with the signed result the game just gave (the
 * server refuses anyone who hasn't finished the day's Daily). Rounds show once
 * they have enough pins; none at all, and there's no crowd map.
 */
export function useGeoCrowd(date: string | undefined, resultToken: string | undefined, rounds: number): GeoCrowd | null {
  const [crowd, setCrowd] = useState<GeoCrowd | null>(null);
  useEffect(() => {
    if (!date || !resultToken) return;
    let off = false;
    fetch(`/api/geo/crowd?date=${encodeURIComponent(date)}&t=${encodeURIComponent(resultToken)}`)
      .then((r) => (r.ok ? (r.json() as Promise<GeoCrowd>) : null))
      .then((c) => !off && setCrowd(c ? { ...c, rounds: c.rounds.filter((r) => r.round >= 1 && r.round <= rounds) } : null))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [date, resultToken, rounds]);
  return crowd?.rounds.length ? crowd : null;
}

/**
 * The breakdown's crowd switch: "Crowd map" lays everyone's pins over the
 * round picked in the tracker, with how many pinned it, the key, and its
 * share picture.
 */
export function CrowdPanel({ crowd, date, resultToken, round, on, onToggle }: { crowd: GeoCrowd; date: string; resultToken: string; round: number; on: boolean; onToggle: () => void }) {
  const t = useT(geoSolo);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const [saving, setSaving] = useState(false);
  const current = crowd.rounds.find((r) => r.round === round) ?? null;
  const cardUrl = `/api/geo/crowd/card?date=${encodeURIComponent(date)}&round=${round}&t=${encodeURIComponent(resultToken)}`;

  /** The round's share picture: the phone's share sheet when it takes files, else the picture to save. */
  async function shareImage() {
    setSaving(true);
    try {
      const blob = await fetch(cardUrl).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))));
      const file = new File([blob], `pokeguessr-crowd-round-${round}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: t("crowd.shareText") }).catch(() => undefined);
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
    <div className="flex w-[min(22rem,100%)] flex-col gap-2 rounded-xl bg-[#1e1a3f]/95 p-2.5 text-white shadow-[0_8px_28px_rgb(0_0_0/0.45)] ring-2 ring-[#5a4fb8]/70 backdrop-blur" data-testid="geo-crowd">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        data-testid="geo-crowd-toggle"
        className={cn(
          "flex h-9 items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase italic tracking-wide transition-colors",
          on ? "bg-[#ffd23c] text-[#1e1a3f]" : "bg-white/10 text-white hover:bg-white/20"
        )}
      >
        <Users className="h-4 w-4" aria-hidden />
        {t("crowd.title")}
      </button>
      {on && (
        <>
          <p className="text-center text-xs text-white/80" data-testid="geo-crowd-count">
            {current ? t("crowd.count", { n: fmt(current.pins), round }) : t("crowd.none", { round })}
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-white/70">
              <span className="h-3 w-3 rounded-full bg-[radial-gradient(circle,#ff4f6d,#ffb23c_60%,#ffe46b00)]" aria-hidden />
              {t("crowd.everyone")}
            </span>
            {current && (
              <button
                type="button"
                onClick={() => void shareImage()}
                disabled={saving}
                data-testid="geo-crowd-share"
                className="flex h-8 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
              >
                <ImageDown className="h-3.5 w-3.5" aria-hidden />
                {saving ? t("crowd.making") : t("crowd.share")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
