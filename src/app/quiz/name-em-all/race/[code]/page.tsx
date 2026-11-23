import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { inviteMetadata } from "@/lib/seo";
import { BackButton } from "@/components/ui/BackButton";
import { NeaRace } from "@/components/name-em-all/NeaRace";
import { raceStore } from "@/lib/server/name-em-all-race";
import { NEA_PATH, neaCategory } from "@/lib/name-em-all/categories";
import { categoryText } from "@/lib/name-em-all/localize";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import neaPages from "@/messages/nea-pages";
import neaCats from "@/messages/nea-cats";
import neaRace from "@/messages/nea-race";
import neaGame from "@/messages/nea-game";

interface PageProps {
  params: Promise<{ code: string }>;
}

const findRace = cache(raceStore.peek);

/** The race's category in the page's language (undefined for an unknown race or category). */
function raceLabel(category: string | undefined): string | undefined {
  const cat = category ? neaCategory(category) : undefined;
  return cat ? categoryText(cat, serverT(neaCats)).label : undefined;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const url = `/quiz/name-em-all/race/${encodeURIComponent((await params).code)}`;
  const race = await findRace((await params).code);
  const t = serverT(neaPages);
  const label = raceLabel(race?.category);
  const about = label ? t("race.aboutIn", { label }) : t("race.about");
  if (!race) return inviteMetadata(t("race.title"), about, url);
  return inviteMetadata(t("race.invite", { name: race.players[0]?.name || t("race.trainer") }), about, url);
}

export default async function NameEmAllRacePage({ params }: PageProps) {
  const { code } = await params;
  const race = await findRace(code);
  // A store hiccup isn't a missing race: the page loads and keeps polling.
  if (race === null) notFound();
  const t = serverT(neaPages);
  // Another language: the category's name there (English pages read categories.ts' in the browser, as before).
  const label = t.locale === "en" ? undefined : raceLabel(race?.category);
  return (
    <div className="space-y-4">
      <BackButton href={NEA_PATH} label={t("title")} />
      <ClientMessages namespaces={[neaRace, neaGame]}>
        <NeaRace key={code} code={code} {...(label !== undefined && { label })} />
      </ClientMessages>
    </div>
  );
}
