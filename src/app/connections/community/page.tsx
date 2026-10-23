import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { CommunityList } from "@/components/connections/CommunityList";

export const metadata: Metadata = pageMetadata({
  title: "Community PokéConnections Puzzles",
  description: "Puzzles made by other trainers: this week's featured pick, the top rated and the newest.",
  path: "/connections/community",
});

export default function CommunityConnectionsPage() {
  return <CommunityList />;
}
