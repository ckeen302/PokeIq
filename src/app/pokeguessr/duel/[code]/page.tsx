import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound } from "next/navigation";
import { GeoDuel } from "@/components/geo/GeoDuel";
import { geoRegions } from "@/lib/server/geo";
import { peekDuel } from "@/lib/server/duel-store";
import { DUEL_HP } from "@/lib/duel-types";
import { WORLD_REGION } from "@/lib/geo-types";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import { formatNumber } from "@/i18n/catalog";
import { guessrDuelNames } from "@/lib/server/guessr-duel-names";
import { mapName } from "@/components/geo/duel-names";
import page from "@/messages/guessr-duel-page";
import duelNs from "@/messages/guessr-duel";
import hud from "@/messages/guessr-hud";
import ranked from "@/messages/guessr-ranked";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(peekDuel);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = serverT(page);
  const duel = await findDuel((await params).code);
  if (!duel) return inviteMetadata(t("duel.fallbackTitle"), t("duel.fallbackDescription"));
  const [host, guest] = duel.players.map((p) => p.name);
  const regions = geoRegions();
  const map = regions.find((r) => r.id === duel.region);
  const where = !map || map.id === WORLD_REGION ? t("where") : mapName(map, guessrDuelNames(regions));
  const title = guest ? t("duel.titleVs", { host, guest }) : t("duel.titleChallenge", { host: host || t("duel.aTrainer") });
  const description =
    duel.mode === "race"
      ? t("duel.raceDescription", { where, rounds: duel.maxRounds })
      : t("duel.hpDescription", { where, hp: formatNumber(DUEL_HP, t.locale) });
  return inviteMetadata(title, description);
}

export default async function GeoDuelPage({ params }: PageProps) {
  const { code } = await params;
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if ((await findDuel(code)) === null) notFound();
  const regions = geoRegions();
  const names = guessrDuelNames(regions);
  return (
    <ClientMessages namespaces={[duelNs, hud, ranked]}>
      <GeoDuel key={code} code={code} regions={regions} {...(names ? { names } : {})} />
    </ClientMessages>
  );
}
