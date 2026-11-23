import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { GeoGame } from "@/components/geo/GeoGame";
import { geoChallengeFirstShot, geoRegions, readGeoChallenge } from "@/lib/server/geo";
import { WORLD_REGION } from "@/lib/geo-types";
import { inviteMetadata } from "@/lib/seo";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import pokeguessr from "@/messages/pokeguessr";
import geoNamesNs from "@/messages/geo-names";
import { localMap } from "@/lib/geo-i18n";
import { GEO_HUB_NAMESPACES } from "@/lib/geo-namespaces";

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
  const t = serverT(pokeguessr);
  if (!challenge) return { title: t("challenge.fallback") };
  const who = challenge.name || t("challenge.aTrainer");
  const map = geoRegions().find((r) => r.id === challenge.region);
  const n = challenge.rounds.length;
  const title = t("challenge.title", { who, score: formatNumber(challenge.score, t.locale) });
  const description = !map || map.id === WORLD_REGION ? t("challenge.world", { n }) : t("challenge.region", { n, map: localMap(serverT(geoNamesNs), map) });
  // A challenge link is an invite: kept out of search, its card the segment's challenge picture.
  return inviteMetadata(title, description, `/pokeguessr/c/${encodeURIComponent((await params).token)}`);
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
    <ClientMessages namespaces={GEO_HUB_NAMESPACES}>
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
    </ClientMessages>
  );
}
