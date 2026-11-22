import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/server";
import { ConnectionsDuel } from "@/components/connections/ConnectionsDuel";
import { pvpStore } from "@/lib/server/duel-store";
import { pvpHref } from "@/lib/pvp-types";
import { ConnNamesProvider } from "@/components/connections/names";
import { connTileNames } from "@/lib/connections/names";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/connections-pages";
import duelNs from "@/messages/connections-duel";
import board from "@/messages/connections-board";
import conn from "@/messages/connections";
import share from "@/messages/share";
import duelShared from "@/messages/duel";
import tier from "@/messages/tier";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(pvpStore.peek);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = serverT(pages);
  const about = t("meta.duelAbout");
  const duel = await findDuel((await params).code);
  if (!duel || duel.kind !== "connections") return inviteMetadata(t("meta.duel"), about);
  const [host, guest] = duel.players.map((p) => p.name);
  const title = guest ? t("meta.duelVs", { host, guest }) : t("meta.duelChallenge", { host: host || t("meta.aTrainer") });
  return inviteMetadata(title, about);
}

export default async function ConnectionsDuelPage({ params }: PageProps) {
  const { code } = await params;
  const duel = await findDuel(code);
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if (duel === null) notFound();
  if (duel && duel.kind !== "connections") redirect(pvpHref(duel.kind, code));
  // Nothing about the puzzle goes in the page: the tiles come from the duel's API once the race starts.
  return (
    <ClientMessages namespaces={[duelNs, board, conn, share, duelShared, tier]}>
      <ConnNamesProvider names={connTileNames(getLocale())}>
        <ConnectionsDuel key={code} code={code} />
      </ConnNamesProvider>
    </ClientMessages>
  );
}
