import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GAMES_LIVE } from "@/lib/lab";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { formatMark } from "@/lib/games/events";
import { runEvent } from "@/lib/games/games";
import { RUN_PATH, eventRunPath, h2hQuestion, parseEvent, parseField, parseGamesSeed, parseRain } from "@/lib/games/deeplink";
import { DEFAULT_FIELDS } from "@/lib/games/records-data";
import { DEFAULT_GAMES_SEED } from "@/lib/games/seed";
import { GamesEventPage, localName } from "@/components/games/GamesPages";
import { serverT } from "@/i18n/server";
import gamesEvents from "@/messages/games-events";
import gamesPages from "@/messages/games-pages";

/**
 * A shared event: /lab/games/run?e=weightlifting&vs=snorlax,machamp&seed=7
 * (one to eight Pokémon; two are a head to head; ?rain=1 for the swims),
 * with its own title and preview card.
 */

type Search = Promise<{ e?: string; vs?: string | string[]; seed?: string; rain?: string }>;

function read(sp: Awaited<Search>) {
  const event = parseEvent(sp.e) ?? "100m";
  const raw = Array.isArray(sp.vs) ? sp.vs.join(",") : sp.vs;
  const keys = parseField(raw, (k) => GAMES_BY_KEY.has(k));
  return { event, keys, seed: parseGamesSeed(sp.seed), rain: parseRain(sp.rain) };
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const { event, keys, seed, rain } = read(await searchParams);
  const field = (keys.length ? keys : DEFAULT_FIELDS[event]).map((k) => GAMES_BY_KEY.get(k)!);
  const out = runEvent(event, field, seed ?? DEFAULT_GAMES_SEED, { rain });
  const w = GAMES_BY_KEY.get(out.podium.gold[0] ?? "");
  const t = serverT(gamesPages);
  const te = serverT(gamesEvents);
  const lc = t.locale;
  const eName = te(`events.${event}.name`);
  const title = field.length === 2 ? h2hQuestion(event, localName(field[0]), localName(field[1]), te) : t("meta.runField", { names: `${field.map(localName).slice(0, 4).join(", ")}${field.length > 4 ? "…" : ""}`, event: eName });
  const path = eventRunPath(event, { keys, seed, rain });
  const q = path.slice(path.indexOf("?"));
  return pageMetadata({
    title: t("meta.runTitle", { title }),
    description: w ? (event === "wrestling" ? t("meta.runWinsBracket", { name: localName(w), event: eName }) : t("meta.runWinsWith", { name: localName(w), mark: formatMark(event, out.marks.get(w.key), lc), event: eName })) : t("meta.runNone", { event: eName }),
    path: path.startsWith(RUN_PATH) ? path : `${RUN_PATH}?e=${event}`,
    image: { url: `${RUN_PATH}/og${q.startsWith("?") ? q : `?e=${event}`}`, alt: title },
    noindex: !GAMES_LIVE,
  });
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const { event, keys, seed, rain } = read(await searchParams);
  return <GamesEventPage event={event} keys={keys} seed={seed} rain={rain} />;
}
