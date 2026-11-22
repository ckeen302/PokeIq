import Link from "@/components/ui/Link";
import { ChevronRight } from "lucide-react";
import { BackButton } from "@/components/ui/BackButton";

/**
 * Title block for the Battle pages: "Battle › Team Builder" crumb, title, blurb.
 * `compact` (the damage calculator): a smaller title and blurb, so the tool starts higher on the screen.
 */
export function BattleHeader({
  crumb,
  title,
  accent,
  back = "/battle",
  compact,
  children,
}: {
  back?: string;
  crumb: string;
  title: string;
  accent: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <BackButton href={back} className="mb-1" />
      <nav aria-label="Breadcrumb" className="hud-label flex items-center gap-1.5">
        <Link href="/battle" className="tap text-screen hover:text-foreground max-sm:-my-3 max-sm:py-3">
          Battle
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <span>{crumb}</span>
      </nav>
      <h1 className={compact ? "font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl" : "font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl"}>
        {title} <span className="text-primary [text-shadow:0_0_30px_hsl(var(--primary)/0.45)]">{accent}</span>
      </h1>
      <p className={compact ? "max-w-2xl text-sm text-muted-foreground" : "max-w-2xl text-muted-foreground"}>{children}</p>
    </div>
  );
}
