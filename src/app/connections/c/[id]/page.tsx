import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CUSTOM_ID_RE } from "@/lib/connections/custom";
import { Connections } from "@/components/connections/Connections";
import { CommunityBar } from "@/components/connections/CommunityBar";

// A trainer's puzzle: playable by its link, not for search engines.
export const metadata: Metadata = {
  title: "Community PokéConnections Puzzle",
  description: "A PokéConnections puzzle made by another trainer. Find the four groups.",
  robots: { index: false, follow: false },
};

export default async function CommunityPuzzlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CUSTOM_ID_RE.test(id)) notFound();
  // The tiles and every guess go through /api/connections (practice=custom-<id>); the groups never reach the page.
  return (
    <div className="space-y-6">
      <CommunityBar id={id} />
      <Connections customId={id} />
    </div>
  );
}
