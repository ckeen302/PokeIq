import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { WorldAtlas } from "@/components/atlas/WorldAtlas";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon World Atlas: every region on one map",
  description:
    "Every mainline Pokémon region from Kanto to Paldea on one zoomable world map, with every town, city, route and landmark labelled from the games' own maps.",
  image: SHARE_IMAGES.site,
  path: "/atlas",
});

export default function AtlasPage() {
  return (
    <div className="space-y-4">
      <BackButton href="/" />
      <WorldAtlas src="/geo/maps/world.webp" />
    </div>
  );
}
