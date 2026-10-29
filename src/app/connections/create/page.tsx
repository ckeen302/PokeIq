import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { CreatePuzzle } from "@/components/connections/CreatePuzzle";

export const metadata: Metadata = pageMetadata({
  title: "Make a PokéConnections Puzzle",
  description: "Pick sixteen Pokémon, split them into four groups, name each one and share a link. Anyone can play it, and the answers stay with the server.",
  path: "/connections/create",
  image: SHARE_IMAGES.site,
});

export default function CreateConnectionsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton href="/connections/community" label="Back to community" />
      <CreatePuzzle />
    </div>
  );
}
