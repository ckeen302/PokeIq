import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { NeaDaily } from "@/components/name-em-all/NeaDaily";
import { pageMetadata } from "@/lib/seo";
import { NEA_PATH } from "@/lib/name-em-all/categories";

export const metadata: Metadata = pageMetadata({
  title: "Name 'em All Daily: Today's Pokémon Recall Quiz",
  description: "One Pokémon category a day, the same for everyone: name as many as you can in the standard time and see where you rank today.",
  path: `${NEA_PATH}/daily`,
});

export default function NameEmAllDailyPage() {
  return (
    <div className="space-y-6">
      <BackButton href={NEA_PATH} label="All categories" />
      <NeaDaily />
    </div>
  );
}
