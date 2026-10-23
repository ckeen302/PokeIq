import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { inviteMetadata } from "@/lib/seo";
import { ConnectionsParty } from "@/components/connections/ConnectionsParty";
import { partyStore } from "@/lib/server/connections-party";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findParty = cache(partyStore.peek);

const ABOUT = "A PokéConnections party: the same sixteen Pokémon for everyone, and the best time wins.";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const party = await findParty((await params).code);
  if (!party) return inviteMetadata("A PokéConnections party", ABOUT);
  return inviteMetadata(`${party.players[0]?.name || "A trainer"} invites you to a PokéConnections party`, ABOUT);
}

export default async function ConnectionsPartyPage({ params }: PageProps) {
  const { code } = await params;
  const party = await findParty(code);
  // A store hiccup isn't a missing party: the page loads and keeps polling.
  if (party === null) notFound();
  // Nothing about the puzzle goes in the page: the tiles come from the party's API once the race starts.
  return <ConnectionsParty key={code} code={code} />;
}
