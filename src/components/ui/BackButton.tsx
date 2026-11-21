import Link from "@/components/ui/Link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { serverT } from "@/i18n/server";
import common from "@/messages/common";

const BACK_CLASS =
  "tap inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-screen/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * "← Back" link to a page's logical parent. Deliberately a plain link rather
 * than history.back(), so it still works on a deep link or a shared URL.
 * A server component ("Back" in the page's language); client components use BackButtonClient.
 */
export function BackButton({ href, label, className }: { href: string; label?: string; className?: string }) {
  const text = label ?? serverT(common)("back");
  return (
    <Link href={href} data-back-button className={cn(BACK_CLASS, className)}>
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {text}
    </Link>
  );
}
