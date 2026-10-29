import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GameJsonLd } from "@/components/seo/GameJsonLd";
import { DailyChallenge } from "@/components/daily/DailyChallenge";

const DESCRIPTION =
  "A new 10-question Pokémon quiz every day — the same for everyone. Keep your streak and compare your PokéIQ.";

export const metadata: Metadata = pageMetadata({
  title: "Daily Pokémon Challenge",
  description: DESCRIPTION,
  path: "/daily",
});

export default function DailyPage() {
  return (
    <>
      <GameJsonLd name="Daily Pokémon Challenge" path="/daily" description={DESCRIPTION} />
      <DailyChallenge />
    </>
  );
}
