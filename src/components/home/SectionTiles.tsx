import { ChevronRight } from "lucide-react";
import { HoverPrefetchLink } from "./HoverPrefetchLink";
import { HOME_SECTIONS } from "./sections";

/**
 * One small tile per tab of the site, in the same order as the title screen's slides. Each page is fetched on hover, not on load.
 * On a phone the tiles become one list: an icon, the name and its line, a chevron.
 */
export function SectionTiles() {
  return (
    <nav aria-label="Everything on PokéIQ">
      <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4 max-sm:grid-cols-1 max-sm:gap-0 max-sm:divide-y max-sm:divide-foreground/[0.06]">
        {HOME_SECTIONS.map(({ id, href, name, line, icon: Icon, accent }) => (
          <li key={id}>
            <HoverPrefetchLink
              href={href}
              className="group flex h-full flex-col rounded-lg border bg-card p-3 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[hsl(var(--accent-c)/0.6)] motion-reduce:transition-none sm:p-4 max-sm:grid max-sm:grid-cols-[2.75rem_1fr_auto] max-sm:items-center max-sm:gap-x-3.5 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:px-0 max-sm:py-3.5 max-sm:hover:translate-y-0 max-sm:active:opacity-70"
              style={{ "--accent-c": accent } as React.CSSProperties}
              data-testid={`home-tile-${id}`}
            >
              <span className="flex items-center gap-2.5 max-sm:contents">
                <span className="screen flex h-8 w-8 shrink-0 items-center justify-center rounded-md sm:h-9 sm:w-9 max-sm:row-span-2 max-sm:h-11 max-sm:w-11 max-sm:rounded-xl" style={{ color: `hsl(${accent})` }}>
                  <Icon className="relative z-[3] h-4 w-4 sm:h-[18px] sm:w-[18px] max-sm:h-5 max-sm:w-5" aria-hidden />
                </span>
                <span className="min-w-0 font-display text-[15px] font-bold uppercase leading-tight tracking-wide sm:text-base max-sm:col-start-2 max-sm:self-end max-sm:font-sans max-sm:text-base max-sm:font-semibold max-sm:normal-case max-sm:tracking-normal">{name}</span>
              </span>
              <span className="mt-2 block text-[13px] leading-snug text-muted-foreground max-sm:col-start-2 max-sm:row-start-2 max-sm:mt-0.5 max-sm:self-start max-sm:text-sm">{line}</span>
              <ChevronRight className="col-start-3 row-span-2 row-start-1 h-5 w-5 text-muted-foreground/60 sm:hidden" aria-hidden />
            </HoverPrefetchLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
