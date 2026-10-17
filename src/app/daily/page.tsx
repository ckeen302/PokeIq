import type { Metadata } from "next";
import { DailyChallenge } from "@/components/daily/DailyChallenge";

export const metadata: Metadata = {
  title: "Daily Pokémon Challenge",
  description: "A new 10-question Pokémon quiz every day — the same for everyone. Keep your streak and compare your PokéIQ.",
};

export default function DailyPage() {
  return <DailyChallenge />;
}
