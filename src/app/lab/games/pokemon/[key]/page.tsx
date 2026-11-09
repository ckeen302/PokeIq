import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { GAMES_LIVE } from "@/lib/lab";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { pokemonPath } from "@/lib/games/deeplink";
import { FAVOURITES } from "@/lib/games/lineups";
import { RECORDS_ALL } from "@/lib/games/records-data";
import { GamesPokemonPage, recordMark } from "@/components/games/GamesRecords";

/**
 * /lab/games/pokemon/<key>: one Pokémon's mark and rank in every event.
 * The favourites are prerendered; every other Pokémon and form is rendered
 * on first visit and kept (ISR).
 */
export const dynamicParams = true;
export const revalidate = 604800;

export function generateStaticParams() {
  return FAVOURITES.filter((k) => GAMES_BY_KEY.has(k)).map((key) => ({ key }));
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const key = (await params).key;
  const a = GAMES_BY_KEY.get(key);
  if (!a) return {};
  const m100 = recordMark("100m", RECORDS_ALL.mark(key, "100m"));
  const lj = recordMark("long-jump", RECORDS_ALL.mark(key, "long-jump"));
  const wl = recordMark("weightlifting", RECORDS_ALL.mark(key, "weightlifting"));
  return pageMetadata({
    title: `${a.name} at the PokéIQ Games: every event, every rank`,
    description: `How good an athlete is ${a.name}? 100 m in ${m100}, a ${lj} long jump, ${wl} in the clean & jerk, and its rank in every event against every Pokémon, from its real stats with real physics.`,
    path: pokemonPath(key),
    image: { url: "/lab/games/opengraph-image", alt: `${a.name} at the PokéIQ Games` },
    noindex: !GAMES_LIVE,
  });
}

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key;
  const a = GAMES_BY_KEY.get(key);
  if (!a) notFound();
  return <GamesPokemonPage athlete={a} />;
}
