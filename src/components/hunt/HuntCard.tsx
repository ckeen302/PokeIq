"use client";

import Link from "@/components/ui/Link";
import { ArrowRight, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HubTile } from "@/components/geo/HubParts";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";

/** The PokéGuessr hub's way into Pokémon Hunt (/pokeguessr/hunt). Presentation: owned by hunt design. */
export function HuntCard() {
  const t = useT(huntNs);
  return (
    <HubTile
      testId="hunt-card"
      tone="success"
      className="sm:col-span-2 xl:col-span-4"
      icon={<Search className="h-5 w-5" />}
      label={t("card.label")}
      title={t("card.title")}
      blurb={t("card.blurb")}
      action={
        <Link href="/pokeguessr/hunt" className={cn(buttonVariants({ variant: "success" }), "w-full sm:w-auto")} data-testid="hunt-link">
          {t("card.play")} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    />
  );
}
