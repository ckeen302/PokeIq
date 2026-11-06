import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { DEFAULT_NATIONS, PLAY_PATH, parseGamesSeed, parseNations, parseRain, playPath } from "@/lib/games/deeplink";
import { GamesPlayPage } from "@/components/games/GamesPages";

/** /lab/games/play: the Games (?n= nations, ?seed= the draw, ?rain=1), with its own title and preview card. */

type Search = Promise<{ n?: string; seed?: string; rain?: string }>;

function read(sp: Awaited<Search>) {
  const ns = parseNations(sp.n, (k) => GAMES_BY_KEY.has(k));
  return { nations: ns.length >= 2 ? ns : DEFAULT_NATIONS, custom: ns.length >= 2, seed: parseGamesSeed(sp.seed), rain: parseRain(sp.rain) };
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const { nations, custom, seed, rain } = read(await searchParams);
  const path = custom || seed != null || rain ? playPath(nations, seed, rain) : PLAY_PATH;
  return pageMetadata({
    title: "The PokéIQ Games: nations of Pokémon, every event, a medal table",
    description: "Up to eight nations of three Pokémon through the 100 m, long jump, shot put, weightlifting, swimming, wrestling and more, with a live medal table and the Champion of the Games, in 3D.",
    path,
    image: { url: `${PLAY_PATH}/og${path.includes("?") ? path.slice(path.indexOf("?")) : ""}`, alt: "The PokéIQ Games medal table" },
  });
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const { nations, seed, rain } = read(await searchParams);
  return <GamesPlayPage nations={nations} seed={seed} rain={rain} />;
}
