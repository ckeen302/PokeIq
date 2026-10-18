import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GeoGame } from "@/components/geo/GeoGame";
import { geoRegions, readGeoChallenge } from "@/lib/server/geo";

interface PageProps {
  params: Promise<{ token: string }>;
}

function challengeFrom(token: string) {
  try {
    return readGeoChallenge(decodeURIComponent(token));
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const challenge = challengeFrom((await params).token);
  if (!challenge) return { title: "PokéGuessr challenge" };
  const who = challenge.name || "A trainer";
  const title = `${who} scored ${challenge.score.toLocaleString("en-US")} in PokéGuessr. Can you beat it?`;
  return {
    title,
    description: "Same five places in Kanto. Drop your pins and beat their score.",
    openGraph: { title, description: "GeoGuessr for Pokémon: same five places, beat their score." },
    robots: { index: false },
  };
}

export default async function GeoChallengePage({ params }: PageProps) {
  const { token } = await params;
  const challenge = challengeFrom(token);
  if (!challenge) notFound();
  const region = geoRegions().find((r) => r.id === challenge.region);
  if (!region) notFound();
  return (
    <GeoGame
      region={region}
      challenge={{ token: decodeURIComponent(token), name: challenge.name, score: challenge.score, rounds: challenge.rounds, style: challenge.style }}
    />
  );
}
