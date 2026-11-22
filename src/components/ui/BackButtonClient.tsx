"use client";

import Link from "@/components/ui/Link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import common from "@/messages/common";

const BACK_CLASS =
  "tap inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-screen/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** BackButton for client components: the same link, its default "Back" in the page's language. */
export function BackButtonClient({ href, label, className }: { href: string; label?: string; className?: string }) {
  const t = useT(common);
  return (
    <Link href={href} data-back-button className={cn(BACK_CLASS, className)}>
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {label ?? t("back")}
    </Link>
  );
}
