import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { GAMES_LIVE } from "@/lib/lab";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { pokemonPath } from "@/lib/games/deeplink";
import { FAVOURITES } from "@/lib/games/lineups";
import { RECORDS_ALL } from "@/lib/games/records-data";
import { GamesPokemonPage, recordMark } from "@/components/games/GamesRecords";
import { localName } from "@/components/games/GamesPages";
import { serverT } from "@/i18n/server";
import gamesPages from "@/messages/games-pages";

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
  const t = serverT(gamesPages);
  const lc = t.locale;
  const name = localName(a);
  const m100 = recordMark("100m", RECORDS_ALL.mark(key, "100m"), lc);
  const lj = recordMark("long-jump", RECORDS_ALL.mark(key, "long-jump"), lc);
  const wl = recordMark("weightlifting", RECORDS_ALL.mark(key, "weightlifting"), lc);
  return pageMetadata({
    title: t("meta.pokemonTitle", { name }),
    description: t("meta.pokemonDescription", { name, m100, lj, wl }),
    path: pokemonPath(key),
    image: { url: "/lab/games/opengraph-image", alt: t("meta.pokemonAlt", { name }) },
    noindex: !GAMES_LIVE,
  });
}

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key;
  const a = GAMES_BY_KEY.get(key);
  if (!a) notFound();
  return <GamesPokemonPage athlete={a} />;
}
