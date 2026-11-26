"use client";

import { ArrowLeft } from "lucide-react";
import Link from "@/components/ui/Link";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import { HuntGame } from "./HuntGame";

/** /pokeguessr/hunt: a link back to PokéGuessr, the hunt's title, and its setup. */
export function HuntPage({ maps }: { maps: GeoRegionInfo[] }) {
  const t = useT(huntNs);
  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="hunt-page">
      <div className="space-y-2">
        <Link href="/pokeguessr#hunt" className="tap inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground" data-testid="hunt-back">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t("setup.back")}
        </Link>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("name")}</h1>
      </div>
      <HuntGame maps={maps} />
    </div>
  );
}
