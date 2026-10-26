import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { inviteMetadata } from "@/lib/seo";
import { BackButton } from "@/components/ui/BackButton";
import { NeaRace } from "@/components/name-em-all/NeaRace";
import { raceStore } from "@/lib/server/name-em-all-race";
import { NEA_PATH, neaCategory } from "@/lib/name-em-all/categories";

interface PageProps {
  params: Promise<{ code: string }>;
}

const findRace = cache(raceStore.peek);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const race = await findRace((await params).code);
  const label = race ? neaCategory(race.category)?.label : undefined;
  const about = `A Name 'em All race${label ? ` (${label})` : ""}: everyone names the same Pokémon, first to name them all wins.`;
  if (!race) return inviteMetadata("A Name 'em All race", about);
  return inviteMetadata(`${race.players[0]?.name || "A trainer"} invites you to a Name 'em All race`, about);
}

export default async function NameEmAllRacePage({ params }: PageProps) {
  const { code } = await params;
  const race = await findRace(code);
  // A store hiccup isn't a missing race: the page loads and keeps polling.
  if (race === null) notFound();
  return (
    <div className="space-y-4">
      <BackButton href={NEA_PATH} label="Name 'em All" />
      <NeaRace key={code} code={code} />
    </div>
  );
}
