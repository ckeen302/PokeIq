import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { PikadokuDuel } from "@/components/pikadoku/PikadokuDuel";
import { pvpStore } from "@/lib/server/duel-store";
import { pvpHref } from "@/lib/pvp-types";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

const ABOUT = "A Pikadoku Tic Tac Toe duel: take turns claiming cells with a Pokémon that fits, and get three in a row.";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  if (!duel || duel.kind !== "pikadoku") return inviteMetadata("A Pikadoku duel", ABOUT);
  const [host, guest] = duel.players.map((p) => p.name);
  const title = guest ? `${host} vs ${guest}: Pikadoku Tic Tac Toe` : `${host || "A trainer"} challenges you to Pikadoku Tic Tac Toe`;
  return inviteMetadata(title, ABOUT);
}

export default async function PikadokuDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  if (duel && duel.kind !== "pikadoku") redirect(pvpHref(duel.kind, code));
  // Nothing about the grid goes in the page: the categories come from the duel's API once play starts.
  return <PikadokuDuel key={code} code={code} />;
}
