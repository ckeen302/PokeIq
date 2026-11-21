import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getLocale, redirect, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import { PikadokuDuel } from "@/components/pikadoku/PikadokuDuel";
import { pikadokuLocal } from "@/lib/pikadoku/local";
import { pvpStore } from "@/lib/server/duel-store";
import { pvpHref } from "@/lib/pvp-types";
import page from "@/messages/pikadoku-page";
import pikadokuBoard from "@/messages/pikadoku-board";
import pikadokuDuel from "@/messages/pikadoku-duel";
import duelNs from "@/messages/duel";
import share from "@/messages/share";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  const t = serverT(page);
  const about = t("duel.about");
  if (!duel || duel.kind !== "pikadoku") return inviteMetadata(t("duel.invite"), about);
  const [host, guest] = duel.players.map((p) => p.name);
  const title = guest ? t("duel.vs", { host, guest }) : t("duel.challenges", { host: host || t("duel.trainer") });
  return inviteMetadata(title, about);
}

export default async function PikadokuDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  if (duel && duel.kind !== "pikadoku") redirect(pvpHref(duel.kind, code));
  // Another language's category labels and Pokémon names (English pages send none).
  const local = await pikadokuLocal(getLocale());
  // Nothing about the grid goes in the page: the categories come from the duel's API once play starts.
  return (
    <ClientMessages namespaces={[pikadokuBoard, pikadokuDuel, duelNs, share]}>
      <PikadokuDuel key={code} code={code} local={local} />
    </ClientMessages>
  );
}
