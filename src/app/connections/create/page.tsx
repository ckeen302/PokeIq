import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { CreatePuzzle } from "@/components/connections/CreatePuzzle";

export const metadata: Metadata = pageMetadata({
  title: "Make a PokéConnections Puzzle",
  description: "Pick sixteen Pokémon, split them into four groups, name each one and share a link. Anyone can play it, and the answers stay with the server.",
  path: "/connections/create",
});

export default function CreateConnectionsPage() {
  return <CreatePuzzle />;
}
