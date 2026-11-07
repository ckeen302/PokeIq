import { ChevronRight } from "lucide-react";
import { HoverPrefetchLink } from "./HoverPrefetchLink";
import { HomeHeading } from "./HomeHeading";
import { HOME_SECTIONS } from "./sections";

const MORE = ["battle", "quizzes", "pokedex"] as const;

/** More to play: Battle, Quizzes and the Pokédex, three compact cards (one list on a phone). Each page is fetched on hover, not on load. */
export function MoreToPlay() {
  const items = MORE.map((id) => HOME_SECTIONS.find((s) => s.id === id)!);
  return (
    <section aria-labelledby="home-more" data-testid="home-more">
      <HomeHeading id="home-more" title="More to play" />
      <ul className="grid gap-3 sm:grid-cols-3 max-sm:gap-0 max-sm:divide-y max-sm:divide-foreground/[0.06]">
        {items.map(({ id, href, name, line, icon: Icon, accent }) => (
          <li key={id}>
            <HoverPrefetchLink
              href={href}
              className="group flex h-full items-center gap-3.5 rounded-lg border bg-card p-4 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[hsl(var(--accent-c)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none max-sm:min-h-[68px] max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:px-0 max-sm:py-3 max-sm:hover:translate-y-0 max-sm:active:opacity-70"
              style={{ "--accent-c": accent } as React.CSSProperties}
              data-testid={`home-more-${id}`}
            >
              <span className="screen flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ color: `hsl(${accent})` }}>
                <Icon className="relative z-[3] h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-bold uppercase leading-tight tracking-wide max-sm:font-sans max-sm:font-semibold max-sm:normal-case max-sm:tracking-normal">{name}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground max-sm:text-sm">{line}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
            </HoverPrefetchLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
