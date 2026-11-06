import Link from "next/link";
import { cn } from "@/lib/utils";

/** The Pokémon list: the Pokédex's main section, shown as the big button above the others. */
const MAIN = { id: "pokemon", label: "Pokémon", href: "/pokedex" } as const;

/** The reference sections under it. (Timeline, Sizes and Race live in the 3D Lab.) */
const TABS = [
  { id: "moves", label: "Moves", href: "/pokedex/moves" },
  { id: "abilities", label: "Abilities", href: "/pokedex/abilities" },
  { id: "items", label: "Items", href: "/pokedex/items" },
  { id: "places", label: "Places", href: "/pokedex/places" },
  { id: "types", label: "Types", href: "/pokedex/types" },
  { id: "natures", label: "Natures", href: "/pokedex/natures" },
  { id: "trainers", label: "Trainers", href: "/pokedex/trainers" },
  { id: "tcg", label: "TCG", href: "/pokedex/tcg" },
] as const;

export type DexTabId = typeof MAIN.id | (typeof TABS)[number]["id"];

/** Top-level Pokédex sections. Each is its own static page so no section ships another's data. */
export function DexTabs({ active }: { active: DexTabId }) {
  const main = active === MAIN.id;
  return (
    <nav aria-label="Pokédex sections" className="flex flex-col items-center gap-2">
      <Link
        href={MAIN.href}
        aria-current={main ? "page" : undefined}
        data-testid={`dex-tab-${MAIN.id}`}
        className={cn(
          "flex w-full max-w-xl items-center justify-center rounded-md border px-6 py-3 font-display text-lg font-bold uppercase tracking-[0.14em] transition-colors sm:text-xl",
          main ? "border-transparent bg-primary text-primary-foreground" : "border-foreground/15 bg-card text-foreground hover:border-screen/60"
        )}
      >
        {MAIN.label}
      </Link>
      <div className="flex flex-wrap justify-center rounded-md border border-foreground/10 bg-shade/30 p-1">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={active === t.id ? "page" : undefined}
            data-testid={`dex-tab-${t.id}`}
            className={cn(
              "rounded-sm px-3.5 py-2 font-pixel text-[10px] uppercase tracking-wider transition-colors",
              active === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
