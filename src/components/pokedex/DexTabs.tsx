import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "pokemon", label: "Pokémon", href: "/pokedex" },
  { id: "moves", label: "Moves", href: "/pokedex/moves" },
  { id: "abilities", label: "Abilities", href: "/pokedex/abilities" },
  { id: "items", label: "Items", href: "/pokedex/items" },
  { id: "places", label: "Places", href: "/pokedex/places" },
] as const;

export type DexTabId = (typeof TABS)[number]["id"];

/** Top-level Pokédex tabs. Each tab is its own static page so no tab ships another tab's data. */
export function DexTabs({ active }: { active: DexTabId }) {
  return (
    <nav aria-label="Pokédex sections" className="flex justify-center">
      <div className="flex flex-wrap justify-center rounded-md border border-foreground/10 bg-shade/30 p-1" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={active === t.id}
            aria-current={active === t.id ? "page" : undefined}
            data-testid={`dex-tab-${t.id}`}
            className={cn(
              "rounded-sm px-4 py-2 font-pixel text-[10px] uppercase tracking-wider transition-colors",
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
