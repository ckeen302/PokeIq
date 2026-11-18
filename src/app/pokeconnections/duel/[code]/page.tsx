import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { ConnectionsDuel } from "@/components/connections/ConnectionsDuel";
import { pvpStore } from "@/lib/server/duel-store";
import { pvpHref } from "@/lib/pvp-types";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

const ABOUT = "A PokéConnections race: the same sixteen Pokémon for both of you, and the first to find the four groups wins.";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  if (!duel || duel.kind !== "connections") return inviteMetadata("A PokéConnections duel", ABOUT);
  const [host, guest] = duel.players.map((p) => p.name);
  const title = guest ? `${host} vs ${guest}: a PokéConnections duel` : `${host || "A trainer"} challenges you to a PokéConnections duel`;
  return inviteMetadata(title, ABOUT);
}

export default async function ConnectionsDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  if (duel && duel.kind !== "connections") redirect(pvpHref(duel.kind, code));
  // Nothing about the puzzle goes in the page: the tiles come from the duel's API once the race starts.
  return <ConnectionsDuel key={code} code={code} />;
}
