import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GAMES_LIVE } from "@/lib/lab";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { DEFAULT_NATIONS, PLAY_PATH, parseGamesSeed, parseNations, parseRain, playPath } from "@/lib/games/deeplink";
import { GamesPlayPage } from "@/components/games/GamesPages";
import { serverT } from "@/i18n/server";
import gamesPages from "@/messages/games-pages";

/** /lab/games/play: the Games (?n= nations, ?seed= the draw, ?rain=1), with its own title and preview card. */

type Search = Promise<{ n?: string; seed?: string; rain?: string }>;

function read(sp: Awaited<Search>) {
  const ns = parseNations(sp.n, (k) => GAMES_BY_KEY.has(k));
  return { nations: ns.length >= 2 ? ns : DEFAULT_NATIONS, custom: ns.length >= 2, seed: parseGamesSeed(sp.seed), rain: parseRain(sp.rain) };
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const { nations, custom, seed, rain } = read(await searchParams);
  const path = custom || seed != null || rain ? playPath(nations, seed, rain) : PLAY_PATH;
  const t = serverT(gamesPages);
  return pageMetadata({
    title: t("meta.playTitle"),
    description: t("meta.playDescription"),
    path,
    image: { url: `${PLAY_PATH}/og${path.includes("?") ? path.slice(path.indexOf("?")) : ""}`, alt: t("meta.playAlt") },
    noindex: !GAMES_LIVE,
  });
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const { nations, seed, rain } = read(await searchParams);
  return <GamesPlayPage nations={nations} seed={seed} rain={rain} />;
}
