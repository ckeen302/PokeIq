import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { readShareCard } from "@/lib/server/share-card";
import { MODULE_INFO, FORMAT_INFO } from "@/lib/modes";
import { dailyNumber } from "@/lib/daily";
import { ChallengeLanding } from "@/components/challenge/ChallengeLanding";

/**
 * /c/<signed share token> — every shared result is a challenge. The token
 * is server-signed (no forged scores) and carries the run's seed, so the
 * friend replays the exact same questions.
 */

interface PageProps {
  params: Promise<{ token: string }>;
}

function describeRun(card: NonNullable<ReturnType<typeof readShareCard>>) {
  return card.day ? `Daily #${dailyNumber(card.day)}` : `${MODULE_INFO[card.m].title} · ${FORMAT_INFO[card.f].title}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const card = readShareCard((await params).token);
  if (!card) return { title: "Challenge" };
  const who = card.n || "A trainer";
  const title = `${who} scored ${card.c}/${card.t} (PokéIQ ${card.q}) — can you beat it?`;
  return {
    title,
    description: `${describeRun(card)} on PokéIQ. Play the exact same questions and see who knows Pokémon better.`,
    openGraph: { title, type: "website" },
    twitter: { card: "summary_large_image", title },
    robots: { index: false },
  };
}

export default async function ChallengePage({ params }: PageProps) {
  const { token } = await params;
  const card = readShareCard(token);
  if (!card) notFound();
  return <ChallengeLanding card={card} token={decodeURIComponent(token)} runLabel={describeRun(card)} />;
}
