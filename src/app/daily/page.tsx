import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { DailyChallenge } from "@/components/daily/DailyChallenge";

export const metadata: Metadata = pageMetadata({
  title: "Daily Pokémon Challenge",
  description: "A new 10-question Pokémon quiz every day — the same for everyone. Keep your streak and compare your PokéIQ.",
  image: SHARE_IMAGES.site,
  path: "/daily",
});

export default function DailyPage() {
  return <DailyChallenge />;
}
