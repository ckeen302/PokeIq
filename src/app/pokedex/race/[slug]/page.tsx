import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { PRESETS, PRESET_BY_ID } from "@/lib/race/presets";
import { HUB_PRESET, presetPath } from "@/lib/race/deeplink";
import { RacePage } from "@/components/race/RacePage";
import { serverT } from "@/i18n/server";
import racePages from "@/messages/race-pages";

/** /pokedex/race/<preset>: Shuckle vs Regieleki, the Gen 1 final, every Pokémon… Prerendered; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return PRESETS.filter((p) => p.id !== HUB_PRESET).map((p) => ({ slug: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const preset = PRESET_BY_ID.get((await params).slug);
  if (!preset) return {};
  const t = serverT(racePages);
  const id = preset.id as keyof typeof racePages.en.titles;
  return pageMetadata({ title: t("meta.presetTitle", { title: t(`titles.${id}`) }), description: t("meta.presetDescription", { blurb: t(`blurbs.${id}`) }), path: presetPath(preset.id) });
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const preset = PRESET_BY_ID.get((await params).slug);
  if (!preset || preset.id === HUB_PRESET) notFound();
  return <RacePage preset={preset} />;
}
