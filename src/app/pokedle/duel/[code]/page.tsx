import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { PokedleDuel } from "@/components/pokedle/PokedleDuel";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { pvpStore } from "@/lib/server/duel-store";
import { pvpHref } from "@/lib/pvp-types";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  if (!duel || duel.kind !== "pokedle") return inviteMetadata("A Pokédle duel", "Head-to-head Pokédle: the same mystery Pokémon for both of you, three rounds.");
  const [host, guest] = duel.players.map((p) => p.name);
  const title = guest ? `${host} vs ${guest}: a Pokédle duel` : `${host || "A trainer"} challenges you to a Pokédle duel`;
  return inviteMetadata(title, "Head-to-head Pokédle: the same mystery Pokémon for both of you, three rounds, fewer guesses and quicker solves score more.");
}

export default async function PokedleDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  // A quiz duel's code: off to its own page.
  if (duel && duel.kind !== "pokedle") redirect(pvpHref(duel.kind, code));
  // Only id + name + gen go to the client: enough for the guess box, no answers.
  const names = POKEDEX.map((p) => [p.id, p.name, p.gen] as [number, string, number]);
  return <PokedleDuel key={code} code={code} names={names} />;
}
