import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DEFAULT_PRESET, PRESETS } from "@/lib/sizes/presets";
import { SizesPage } from "@/components/sizes/SizesPage";
import { resolveSlug, slugMetadata } from "@/components/sizes/routes";

/**
 * /pokedex/sizes/<preset> (Legendaries, Starters, Gen 1…) and
 * /pokedex/sizes/<pokemon> (a Pokémon's or form's own size page: the full
 * line, flown to it). Presets are prerendered; Pokémon pages render on
 * first request and are cached from then on. Anything else is a 404. In
 * another order (?by=speed) they render at ./by/<order>.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return PRESETS.filter((p) => p.id !== DEFAULT_PRESET.id).map((p) => ({ slug: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return slugMetadata((await params).slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { preset, item } = resolveSlug((await params).slug);
  if (preset) return <SizesPage preset={preset} />;
  if (item) return <SizesPage focus={item} />;
  notFound();
}
