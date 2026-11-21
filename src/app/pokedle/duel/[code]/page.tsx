import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getLocale, redirect, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import { PokedleDuel } from "@/components/pokedle/PokedleDuel";
import { dleLabels, dleNames } from "@/lib/dle-lexicon";
import { pvpStore } from "@/lib/server/duel-store";
import { pvpHref } from "@/lib/pvp-types";
import pokedle from "@/messages/pokedle";
import board from "@/messages/pokedle-board";
import duelNs from "@/messages/pokedle-duel";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  const t = serverT(pokedle);
  if (!duel || duel.kind !== "pokedle") return inviteMetadata(t("duel.title"), t("duel.description"));
  // Trainer names are theirs: never translated.
  const [host, guest] = duel.players.map((p) => p.name);
  const title = guest ? t("duel.versus", { host, guest }) : t("duel.challenge", { host: host || t("duel.aTrainer") });
  return inviteMetadata(title, t("duel.inviteDescription"));
}

export default async function PokedleDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  // A quiz duel's code: off to its own page.
  if (duel && duel.kind !== "pokedle") redirect(pvpHref(duel.kind, code));
  const locale = getLocale();
  // Only id + name + gen go to the client (with the other names it answers to, in another language): enough for the guess box, no answers.
  const names = dleNames(locale);
  return (
    <ClientMessages namespaces={[board, duelNs]}>
      <PokedleDuel key={code} code={code} names={names} labels={dleLabels(locale)} />
    </ClientMessages>
  );
}
