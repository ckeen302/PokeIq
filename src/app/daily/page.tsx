import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { DailyChallenge } from "@/components/daily/DailyChallenge";

export const metadata: Metadata = pageMetadata({
  title: "Daily Pokémon Challenge",
  description: "A new 10-question Pokémon quiz every day — the same for everyone. Keep your streak and compare your PokéIQ.",
  path: "/daily",
});

export default function DailyPage() {
  return <DailyChallenge />;
}
