import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { inviteMetadata } from "@/lib/seo";
import { ConnectionsParty } from "@/components/connections/ConnectionsParty";
import { partyStore } from "@/lib/server/connections-party";
import { ConnNamesProvider } from "@/components/connections/names";
import { connTileNames } from "@/lib/connections/names";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/connections-pages";
import party from "@/messages/connections-party";
import board from "@/messages/connections-board";
import duel from "@/messages/duel";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findParty = cache(partyStore.peek);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = serverT(pages);
  const about = t("meta.partyAbout");
  const found = await findParty((await params).code);
  if (!found) return inviteMetadata(t("meta.party"), about);
  return inviteMetadata(t("meta.partyInvite", { host: found.players[0]?.name || t("meta.aTrainer") }), about);
}

export default async function ConnectionsPartyPage({ params }: PageProps) {
  const { code } = await params;
  const found = await findParty(code);
  // A store hiccup isn't a missing party: the page loads and keeps polling.
  if (found === null) notFound();
  // Nothing about the puzzle goes in the page: the tiles come from the party's API once the race starts.
  return (
    <ClientMessages namespaces={[party, board, duel]}>
      <ConnNamesProvider names={connTileNames(getLocale())}>
        <ConnectionsParty key={code} code={code} />
      </ConnNamesProvider>
    </ClientMessages>
  );
}
