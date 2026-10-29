import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { CommunityList } from "@/components/connections/CommunityList";

export const metadata: Metadata = pageMetadata({
  title: "Community PokéConnections Puzzles",
  description: "Puzzles made by other trainers: this week's featured pick, the top rated and the newest.",
  path: "/connections/community",
  image: SHARE_IMAGES.site,
});

export default function CommunityConnectionsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton href="/connections" label="Back to PokéConnections" />
      <CommunityList />
    </div>
  );
}
