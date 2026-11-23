"use client";

import { ArrowRight, Crosshair } from "lucide-react";
import Link from "@/components/ui/Link";
import { boardArtUrl } from "@/lib/pokemon/art";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import { TileFlag } from "@/components/geo/HubParts";

/** The Pokémon on the entry: three famous, memorable finds. */
const ART = [143, 131, 150];

/**
 * Pokémon Hunt's entry on PokéGuessr's hub (the one change to its screens):
 * a wide card in the hub's own style, three famous Pokémon peeking in, the
 * mode's pitch and the way in. The whole card is the link.
 */
export function HuntCard({ className }: { className?: string }) {
  const t = useT(huntNs);
  return (
    <Link
      href="/pokeguessr/hunt"
      className={cn("group relative flex items-center gap-4 overflow-hidden rounded-lg border border-primary/40 bg-card p-4 shadow-sm transition-colors hover:border-primary/70 sm:p-5", className)}
      data-testid="hunt-card"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/20 via-primary/5 to-transparent" aria-hidden />
      <div className="relative min-w-0 flex-1 space-y-1">
        <p className="hud-label flex flex-wrap items-center gap-2 text-primary">
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          {t("tile.label")}
          <TileFlag tone="success">{t("tile.new")}</TileFlag>
        </p>
        <p className="font-display text-2xl font-bold uppercase leading-tight sm:text-3xl">{t("tile.title")}</p>
        <p className="text-sm text-muted-foreground">{t("tile.blurb")}</p>
        <span className="mt-2 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] transition-[filter] group-hover:brightness-110" data-testid="hunt-link">
          {t("tile.play")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <div className="relative -my-2 flex h-24 shrink-0 items-end sm:h-28 md:h-32" aria-hidden>
        {ART.map((id, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- static board art
          <img
            key={id}
            src={boardArtUrl(id)}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "h-full w-auto object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:-translate-y-1 motion-reduce:transition-none",
              i > 0 && "-ml-6 md:-ml-8",
              i === 1 && "h-[86%] max-sm:hidden",
              i === 2 && "h-[94%] max-md:hidden"
            )}
            style={{ transitionDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
    </Link>
  );
}
