import Link from "next/link";
import { HOME_SECTIONS } from "./sections";

/** One small tile per tab of the site, in the same order as the title screen's slides. */
export function SectionTiles() {
  return (
    <nav aria-label="Everything on PokéIQ">
      <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4">
        {HOME_SECTIONS.map(({ id, href, name, line, icon: Icon, accent }) => (
          <li key={id}>
            <Link
              href={href}
              className="group flex h-full flex-col rounded-lg border bg-card p-3 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[hsl(var(--accent-c)/0.6)] motion-reduce:transition-none sm:p-4"
              style={{ "--accent-c": accent } as React.CSSProperties}
              data-testid={`home-tile-${id}`}
            >
              <span className="flex items-center gap-2.5">
                <span className="screen flex h-8 w-8 shrink-0 items-center justify-center rounded-md sm:h-9 sm:w-9" style={{ color: `hsl(${accent})` }}>
                  <Icon className="relative z-[3] h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 font-display text-[15px] font-bold uppercase leading-tight tracking-wide sm:text-base">{name}</span>
              </span>
              <span className="mt-2 block text-[13px] leading-snug text-muted-foreground">{line}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
