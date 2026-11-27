import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEMON_STORY_LIVE } from "@/lib/lab";
import { LabPage } from "@/components/lab/LabPage";
import { serverT } from "@/i18n/server";
import lab from "@/messages/lab";

export function generateMetadata(): Metadata {
  const t = serverT(lab);
  return pageMetadata({
    title: t("meta.title"),
    description: t(POKEMON_STORY_LIVE ? "meta.descriptionStory" : "meta.descriptionTimeline"),
    path: "/lab",
    socialTitle: t("meta.socialTitle"),
  });
}

/** Mock: ?hero=1|2|3 picks the hero's visual (1 when absent), ?mon= the pedestal's Pokémon. */
export default async function Page({ searchParams }: { searchParams: Promise<{ hero?: string; mon?: string }> }) {
  const { hero, mon } = await searchParams;
  const n = Number(hero);
  return <LabPage choice={{ hero: n === 2 || n === 3 ? n : 1, mon }} />;
}
