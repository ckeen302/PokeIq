import Link from "next/link";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { SIZE_ITEMS } from "@/lib/sizes/data";
import { DEFAULT_PRESET, PRESETS, type SizePreset } from "@/lib/sizes/presets";
import { COMPARE_PATH, itemPath, presetPath } from "@/lib/sizes/deeplink";
import { factFor } from "@/lib/sizes/facts";
import { everythingLine, listCaption, listItems, listNote, listOrder, listRows, type ListSpec } from "@/lib/sizes/list";
import { HEIGHT_ORDER, orderTag, withOrder, type Order } from "@/lib/sizes/order";
import { KIND_LABEL, formatFeet, formatMetres, measureOf, type SizeItem } from "@/lib/sizes/types";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { BackButton } from "@/components/ui/BackButton";
import { SizesExperience } from "./SizesExperience";
import { SizesList } from "./SizesList";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { cn } from "@/lib/utils";

/** The species' Pokédex page for any form ("charizard-gmax" → "charizard"). */
export function pokedexSlug(i: SizeItem): string {
  return i.kind === "pokemon" ? i.key : getPokemon(i.species)?.slug ?? i.key;
}

const sizeText = (i: SizeItem) => `${formatMetres(i.m)}${i.min ? "+" : ""} (${formatFeet(i.m)}${i.min ? "+" : ""})`;

/**
 * /pokedex/sizes, a preset's page, a Pokémon's own size page and a
 * comparison: the 3D experience over the server-rendered table, both in the
 * address's order (?by=speed&dir=desc; Height, smallest first, without one).
 */
export function SizesPage({ preset = DEFAULT_PRESET, focus, vs, compare = false, order: asked = HEIGHT_ORDER }: { preset?: SizePreset; focus?: SizeItem; vs?: SizeItem[]; compare?: boolean; order?: Order }) {
  const comparing = !!vs && vs.length >= 2;
  const spec: ListSpec = { preset: preset.id, focus: focus?.key ?? null, vs: comparing ? vs.map((i) => i.key) : [] };
  // A Pokémon's own page in an order it has no value in (a Gigantamax form by weight) stands by height.
  const order = listOrder(SIZE_ITEMS, spec, asked);
  const rows = listItems(SIZE_ITEMS, spec, order);
  const mons = rows.filter((i) => i.kind !== "ref");
  const caption = listCaption(SIZE_ITEMS, spec, order);
  const path = comparing ? COMPARE_PATH : focus ? itemPath(focus.key) : compare ? COMPARE_PATH : presetPath(preset.id);
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: caption,
    url: `${SITE_URL}${withOrder(focus ? itemPath(focus.key) : presetPath(preset.id), order)}`,
    numberOfItems: mons.length,
    ...(mons.length <= 160 && { itemListElement: mons.map((i, n) => ({ "@type": "ListItem", position: n + 1, name: `${i.name} (${orderTag(i, order) ?? formatMetres(i.m)})`, url: `${SITE_URL}${itemPath(i.key)}` })) }),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <SizesExperience preset={preset.id} focus={focus?.key ?? null} vs={spec.vs} compare={compare} order={order}>
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
              blurb="Every Pokémon side by side at its real size, from the smallest at 0.1 m to Eternamax Eternatus at 100 m, in a sunny Lumiose City. Line them up by height, weight or any base stat, play the glide, explore, compare any of them, or make your own size video."
            />
          ) : (
            <ListHeader kicker="Pokémon sizes" title={`${preset.label} `} accent="by size" blurb={preset.blurb} />
          )}
          <nav aria-label="Lineups" className="flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => (
              <Link
                key={p.id}
                href={withOrder(presetPath(p.id), order)}
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
          <SizesList rows={listRows(rows, SIZE_ITEMS)} focus={focus?.key} caption={caption} note={listNote(SIZE_ITEMS, spec, order)} spec={spec} order={order} path={path} />
          <p className="text-center text-xs text-muted-foreground">
            Heights and weights from the Pokédex (PokéAPI); Gigantamax heights are the Pokédex&apos;s minimum. Long Pokémon such as serpents and fish are measured by length.
            Base stats from the Pokédex, and each Mega, regional and Gigantamax form&apos;s own from Pokémon Showdown&apos;s data. Real-world sizes are documented figures, each with its source.
          </p>
        </div>
      </SizesExperience>
    </div>
  );
}

function FocusHeader({ item }: { item: SizeItem }) {
  const fact = factFor(item, everythingLine(SIZE_ITEMS));
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
