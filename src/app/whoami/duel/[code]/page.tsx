import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { inviteMetadata } from "@/lib/seo";
import { pvpStore } from "@/lib/server/duel-store";
import { poolOf } from "@/lib/server/whoami";
import { pvpHref } from "@/lib/pvp-types";
import { WhoamiDuel } from "@/components/whoami/WhoamiDuel";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

const ABOUT = "A Pokémon deduction race: the same secret Pokémon for both of you, yes/no questions paid for in PP, best of three rounds.";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  if (!duel || duel.kind !== "whoami") return inviteMetadata("A Who Am I? duel", ABOUT);
  const [host, guest] = duel.players.map((p) => p.name);
  return inviteMetadata(guest ? `${host} vs ${guest}: a Who Am I? duel` : `${host || "A trainer"} challenges you to Who Am I?`, ABOUT);
}

export default async function WhoamiDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  if (duel && duel.kind !== "whoami") redirect(pvpHref(duel.kind, code));
  // Public Pokédex data for the grid and the ability menu (the curated set every pool comes from); never the secret.
  const dex = poolOf({ from: 1, to: 9, casual: false }).map((p) => [p.id, p.name, p.abilities.map((a) => a.name)] as [number, string, string[]]);
  return <WhoamiDuel key={code} code={code} dex={dex} />;
}
