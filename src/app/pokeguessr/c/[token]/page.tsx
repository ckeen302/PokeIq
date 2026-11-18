import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { GeoGame } from "@/components/geo/GeoGame";
import { geoChallengeFirstShot, geoRegions, readGeoChallenge } from "@/lib/server/geo";
import { WORLD_REGION } from "@/lib/geo-types";
import { inviteMetadata } from "@/lib/seo";

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
  const map = geoRegions().find((r) => r.id === challenge.region);
  const where = !map || map.id === WORLD_REGION ? "the Pokémon world" : map.name;
  const n = challenge.rounds.length;
  const title = `${who} scored ${challenge.score.toLocaleString("en-US")} in PokéGuessr. Can you beat it?`;
  // A challenge link is an invite: kept out of search, its card the segment's challenge picture.
  return inviteMetadata(title, `The same ${n} place${n === 1 ? "" : "s"} in ${where}: drop your pins and beat their score. GeoGuessr for Pokémon, free.`);
}

export default async function GeoChallengePage({ params }: PageProps) {
  const { token } = await params;
  const challenge = challengeFrom(token);
  if (!challenge) notFound();
  const regions = geoRegions();
  if (!regions.some((r) => r.id === challenge.region)) notFound();
  // Round 1's picture starts downloading with the page (the browser gets the game itself ready on load), so Accept shows it at once.
  // (Links carry their sealed rounds; an old one without them is planned from its seed, as the start does.)
  const firstShot = geoChallengeFirstShot(decodeURIComponent(token));
  if (firstShot) preload(firstShot, { as: "image", fetchPriority: "high" });
  return (
    <GeoGame
      regions={regions}
      challenge={{
        token: decodeURIComponent(token),
        region: challenge.region,
        name: challenge.name,
        score: challenge.score,
        rounds: challenge.rounds,
        era: challenge.era,
        families: challenge.families,
        ...(challenge.difficulty ? { difficulty: challenge.difficulty } : {}),
      }}
    />
  );
}
