import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { serverT } from "@/i18n/server";
import page from "@/messages/nuzlocke-page";
import { gameIds, gameSummaries, gameView } from "@/lib/nuzlocke/games.server";
import { GameGuide } from "@/components/tools/nuzlocke/GameGuide";

/**
 * /tools/nuzlocke-tracker/<game>: one game's page, built for every game: its areas in story order with every Pokémon
 * met there, the bosses with their level caps, and the button that starts a run in it.
 */

type Params = { game: string };

export async function generateStaticParams(): Promise<Params[]> {
  return (await gameIds()).map((game) => ({ game }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const view = await gameView((await params).game);
  if (!view) return {};
  const t = serverT(page);
  const path = `/tools/nuzlocke-tracker/${view.id}`;
  return pageMetadata({ title: t("game.metaTitle", { name: view.name }), description: t("game.metaDescription", { name: view.name }), path, image: { url: `${path}/og`, alt: t("game.title", { name: view.name }) } });
}

export default async function NuzlockeGamePage({ params }: { params: Promise<Params> }) {
  const id = (await params).game;
  const [view, games] = await Promise.all([gameView(id), gameSummaries()]);
  const game = games.find((g) => g.id === id);
  if (!view || !game) notFound();
  return <GameGuide view={view} game={game} />;
}
