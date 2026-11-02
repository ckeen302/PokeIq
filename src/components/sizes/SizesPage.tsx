import Link from "next/link";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { SIZE_FORM_ITEMS, SIZE_ITEMS } from "@/lib/sizes/data";
import { DEFAULT_PRESET, PRESETS, compareLineup, presetLineup, type SizePreset } from "@/lib/sizes/presets";
import { COMPARE_PATH, itemPath, presetPath } from "@/lib/sizes/deeplink";
import { factFor } from "@/lib/sizes/facts";
import { KIND_LABEL, bySize, formatFeet, formatMetres, measureOf, type SizeItem } from "@/lib/sizes/types";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { BackButton } from "@/components/ui/BackButton";
import { SizesExperience } from "./SizesExperience";
import { SizesList, pokedexSlug } from "./SizesList";
import { cn } from "@/lib/utils";

/** The full line with every form too: the main page's table. */
export function everything(): SizeItem[] {
  const base = presetLineup(DEFAULT_PRESET, SIZE_ITEMS);
  const have = new Set(base.map((i) => i.key));
  return [...base, ...SIZE_FORM_ITEMS.filter((f) => !have.has(f.key))].sort(bySize);
}

/** A Pokémon's neighbours by size (and the adult human), for its own page's table. */
export function neighbours(focus: SizeItem, n = 12): SizeItem[] {
  const all = everything();
  const at = all.findIndex((i) => i.key === focus.key);
  const near = all.slice(Math.max(0, at - n), at + n + 1);
  const human = SIZE_ITEMS.find((i) => i.ref?.kind === "human")!;
  return near.some((i) => i.key === human.key) ? near : [...near, human].sort(bySize);
}

const sizeText = (i: SizeItem) => `${formatMetres(i.m)}${i.min ? "+" : ""} (${formatFeet(i.m)}${i.min ? "+" : ""})`;

/**
 * /pokedex/sizes, a preset's page, a Pokémon's own size page and a
 * comparison: the 3D experience over the server-rendered table.
 */
export function SizesPage({ preset = DEFAULT_PRESET, focus, vs }: { preset?: SizePreset; focus?: SizeItem; vs?: SizeItem[] }) {
  const comparing = !!vs && vs.length >= 2;
  const rows = comparing ? compareLineup(vs, SIZE_ITEMS) : focus ? neighbours(focus) : preset.id === DEFAULT_PRESET.id ? everything() : presetLineup(preset, SIZE_ITEMS);
  const mons = rows.filter((i) => i.kind !== "ref");
  const caption = comparing ? `${vs.map((i) => i.name).join(" vs ")} by size` : focus ? `Pokémon close to ${focus.name}'s size` : preset.title;
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: caption,
    url: `${SITE_URL}${focus ? itemPath(focus.key) : presetPath(preset.id)}`,
    numberOfItems: mons.length,
    ...(mons.length <= 160 && { itemListElement: mons.map((i, n) => ({ "@type": "ListItem", position: n + 1, name: `${i.name} (${formatMetres(i.m)})`, url: `${SITE_URL}${itemPath(i.key)}` })) }),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <SizesExperience preset={preset.id} focus={focus?.key ?? null} vs={comparing ? vs.map((i) => i.key) : []}>
        <div className="space-y-6">
          {comparing ? (
            <CompareHeader items={vs} />
          ) : focus ? (
            <FocusHeader item={focus} />
          ) : preset.id === DEFAULT_PRESET.id ? (
            <ListHeader
              kicker="Pokémon to scale"
              title="Pokémon "
              accent="Sizes"
              blurb="Every Pokémon side by side at its real size, from the smallest at 0.1 m to Eternamax Eternatus at 100 m, in a sunny Lumiose City. Play the glide, explore, compare any of them, or make your own size video."
            />
          ) : (
            <ListHeader kicker="Pokémon sizes" title={`${preset.label} `} accent="by size" blurb={preset.blurb} />
          )}
          <DexTabs active="sizes" />
          <nav aria-label="Lineups" className="flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => (
              <Link
                key={p.id}
                href={presetPath(p.id)}
                prefetch={false}
                className={cn("rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors", !focus && !comparing && p.id === preset.id ? "border-primary/60 text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {p.label}
              </Link>
            ))}
            <Link href={COMPARE_PATH} prefetch={false} className="rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
              Compare
            </Link>
          </nav>
          <SizesList items={rows} focus={focus?.key} caption={caption} />
          <p className="text-center text-xs text-muted-foreground">
            Heights and weights from the Pokédex (PokéAPI); Gigantamax heights are the Pokédex&apos;s minimum. Long Pokémon such as serpents and fish are measured by length.
            Real-world sizes are documented figures, each with its source.
          </p>
        </div>
      </SizesExperience>
    </div>
  );
}

function FocusHeader({ item }: { item: SizeItem }) {
  const fact = factFor(item, everything());
  return (
    <div className="space-y-3 text-center">
      <div className="text-left">
        <BackButton href="/pokedex/sizes" label="All Pokémon sizes" />
      </div>
      <p className="hud-label text-screen">
        <Link href="/pokedex/sizes" className="hover:text-foreground">Pokémon sizes</Link> · #{String(item.species).padStart(4, "0")}{item.kind !== "pokemon" ? ` · ${KIND_LABEL[item.kind]}` : ""}
      </p>
      <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">How big is {item.name}?</h1>
      <p className="text-lg">
        <span className="font-display font-bold">{sizeText(item)}</span> <span className="text-muted-foreground">{measureOf(item).toLowerCase()}</span>
        {item.kg != null && <span className="text-muted-foreground"> · {item.kg.toLocaleString("en-US")} kg</span>}
      </p>
      {fact && <p className="mx-auto max-w-2xl text-muted-foreground">{fact}.</p>}
      <p className="text-sm">
        <Link href={`/pokemon/${pokedexSlug(item)}`} className="text-primary underline-offset-2 hover:underline">{item.name}&apos;s Pokédex entry</Link>
      </p>
    </div>
  );
}

function CompareHeader({ items }: { items: SizeItem[] }) {
  return (
    <div className="space-y-3 text-center">
      <div className="text-left">
        <BackButton href="/pokedex/sizes" label="All Pokémon sizes" />
      </div>
      <p className="hud-label text-screen">Pokémon size comparison</p>
      <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{items.map((i) => i.name).join(" vs ")}</h1>
      <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
        {items.map((i) => (
          <span key={i.key}>
            <Link href={itemPath(i.key)} className="font-semibold hover:text-primary">{i.name}</Link> <span className="text-muted-foreground">{sizeText(i)}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
