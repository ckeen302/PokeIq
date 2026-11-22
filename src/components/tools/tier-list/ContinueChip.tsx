"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "@/components/ui/Link";
import { useT } from "@/i18n/client";
import tierList from "@/messages/tier-list";
import { getTemplate } from "@/lib/tier-list/templates";
import { templateName } from "./names";

/** "Continue: Starters" on the maker's front page, when this browser has work saved. */
export function ContinueChip() {
  const t = useT(tierList);
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => {
    try {
      const s = localStorage.getItem("pokeiq-tier-list:last");
      if (s && getTemplate(s)) setSlug(s);
    } catch {
      /* no storage */
    }
  }, []);
  const tpl = getTemplate(slug);
  if (!tpl) return null;
  return (
    <Link href={`/tools/tier-list/${tpl.slug}`} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-[filter] hover:brightness-110" data-testid="tl-continue">
      {t("pick.continue", { name: templateName(t, tpl) })} <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}
