import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BackButton } from "@/components/ui/BackButton";

/** Title block for the Battle pages: "Battle › Team Builder" crumb, title, blurb. */
export function BattleHeader({ crumb, title, accent, back = "/battle", children }: { back?: string; crumb: string; title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <BackButton href={back} className="mb-1" />
      <nav aria-label="Breadcrumb" className="hud-label flex items-center gap-1.5">
        <Link href="/battle" className="text-screen hover:text-foreground">
          Battle
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <span>{crumb}</span>
      </nav>
      <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
        {title} <span className="text-primary [text-shadow:0_0_30px_hsl(var(--primary)/0.45)]">{accent}</span>
      </h1>
      <p className="max-w-2xl text-muted-foreground">{children}</p>
    </div>
  );
}
