import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { SIZE_BY_KEY } from "@/lib/sizes/data";
import { DEFAULT_PRESET, PRESETS, PRESET_BY_ID } from "@/lib/sizes/presets";
import { itemPath, presetPath } from "@/lib/sizes/deeplink";
import { formatFeet, formatMetres, measureOf } from "@/lib/sizes/types";
import { SizesPage } from "@/components/sizes/SizesPage";

/**
 * /pokedex/sizes/<preset> (Legendaries, Starters, Gen 1…) and
 * /pokedex/sizes/<pokemon> (a Pokémon's or form's own size page: the full
 * line, flown to it). Presets are prerendered; Pokémon pages render on
 * first request and are cached from then on. Anything else is a 404.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return PRESETS.filter((p) => p.id !== DEFAULT_PRESET.id).map((p) => ({ slug: p.id }));
}

function resolve(slug: string) {
  const preset = slug !== DEFAULT_PRESET.id ? PRESET_BY_ID.get(slug) : undefined;
  const item = preset ? undefined : SIZE_BY_KEY.get(slug);
  return { preset, item: item && item.kind !== "ref" ? item : undefined };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { preset, item } = resolve((await params).slug);
  if (preset) {
    return pageMetadata({ title: `${preset.title} (3D size comparison)`, description: `${preset.blurb} See them to scale in 3D, compare any two, or make a size comparison video.`, path: presetPath(preset.id) });
  }
  if (item) {
    const size = `${formatMetres(item.m)}${item.min ? "+" : ""} (${formatFeet(item.m)}${item.min ? "+" : ""})`;
    return pageMetadata({
      title: `How big is ${item.name}? ${size} ${measureOf(item).toLowerCase()}`,
      description: `${item.name} is ${size} ${item.length ? "long" : "tall"}${item.kg != null ? ` and weighs ${item.kg.toLocaleString("en-US")} kg` : ""}. See it to scale next to every other Pokémon and an adult human in 3D.`,
      path: itemPath(item.key),
      socialTitle: `How big is ${item.name}? · PokéIQ`,
    });
  }
  return {};
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { preset, item } = resolve((await params).slug);
  if (preset) return <SizesPage preset={preset} />;
  if (item) return <SizesPage focus={item} />;
  notFound();
}
