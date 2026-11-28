"use client";

/* eslint-disable @next/next/no-img-element -- small static pictures */
import Link from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import tierList from "@/messages/tier-list";
import { TEMPLATES, type TemplateGroup } from "@/lib/tier-list/templates";
import { templateName } from "./names";

const ORDER: TemplateGroup[] = ["all", "category", "form", "game", "generation", "type", "custom"];

/** Every template as a card, grouped; each links to its own page. */
/** A list of another kind, shown first in the first group (the front page's Favorite Pokémon Picker). */
export interface ExtraList {
  href: string;
  label: string;
  /** The Pokédex number of its picture. */
  face: number;
  testId: string;
}

export function TemplateGrid({ current, onPick, compact, extra = [] }: { current?: string; onPick?(slug: string): void; compact?: boolean; extra?: ExtraList[] }) {
  const t = useT(tierList);
  return (
    <div className="space-y-7" data-testid="template-grid">
      {ORDER.map((group) => {
        const list = TEMPLATES.filter((x) => x.group === group);
        return (
          <section key={group} className="space-y-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`pick.groups.${group}`)}</h3>
            <ul className={cn("grid gap-2", compact ? "grid-cols-[repeat(auto-fill,minmax(176px,1fr))] max-sm:grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(200px,1fr))] max-sm:grid-cols-2")}>
              {group === ORDER[0] &&
                extra.map((x) => (
                  <li key={x.href}>
                    <Link
                      href={x.href}
                      className="group flex h-[64px] items-center gap-2 overflow-hidden rounded-2xl bg-foreground/[0.04] pl-1.5 pr-3 transition-colors hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={x.testId}
                    >
                      <img src={`/sizes/art/256/${x.face}.webp`} alt="" width={52} height={52} loading="lazy" className="h-[52px] w-[52px] shrink-0 object-contain transition-transform duration-200 group-hover:scale-110 motion-reduce:transition-none" />
                      <span className="min-w-0 text-[14px] font-semibold leading-tight">{x.label}</span>
                    </Link>
                  </li>
                ))}
              {list.map((tpl) => (
                <li key={tpl.slug}>
                  <Link
                    href={`/tools/tier-list/${tpl.slug}`}
                    onClick={onPick ? (e: React.MouseEvent) => (e.preventDefault(), onPick(tpl.slug)) : undefined}
                    className={cn(
                      "group flex h-[64px] items-center gap-2 overflow-hidden rounded-2xl bg-foreground/[0.04] pl-1.5 pr-3 transition-colors hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      current === tpl.slug && "bg-primary/[0.12] ring-1 ring-primary/50"
                    )}
                    aria-current={current === tpl.slug ? "page" : undefined}
                    data-testid={`template-${tpl.slug}`}
                  >
                    <img src={`/sizes/art/256/${tpl.face}.webp`} alt="" width={52} height={52} loading="lazy" className="h-[52px] w-[52px] shrink-0 object-contain transition-transform duration-200 group-hover:scale-110 motion-reduce:transition-none" />
                    <span className="min-w-0 text-[14px] font-semibold leading-tight">{templateName(t, tpl)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
