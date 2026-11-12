import Link from "next/link";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { EVENTS, EVENT_IDS, eventOf, formatMark, type EventId } from "@/lib/games/events";
import { GAMES_PATH, eventPath, eventRunPath, h2hQuestion, pokemonPath, recordsPath } from "@/lib/games/deeplink";
import { RECORDS_ALL } from "@/lib/games/records-data";
import type { Athlete } from "@/lib/games/athlete";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { RACE_CSS } from "@/components/race/race-css";
import { EventNav } from "./GamesPages";

/**
 * The records of the Games (every event pre-run for all 1,025 Pokémon and
 * their forms: scripts/games-records.ts) and each Pokémon's own page of
 * results. Server components.
 */

const nameOf = (k: string) => GAMES_BY_KEY.get(k)?.name ?? k;
const dexSlug = (a: Athlete) => getPokemon(a.entrant.species)?.slug ?? null;

/** A record's mark as shown: wrestling's column is the ring strength (push + brace). */
export function recordMark(event: EventId, v: number | null): string {
  if (v == null) return "—";
  if (event === "wrestling") return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kN`;
  return formatMark(event, v);
}

const WORST: Record<EventId, string> = {
  "100m": "The slowest", "200m": "The slowest", "400m": "The slowest", "long-jump": "The shortest", "high-jump": "The lowest", "shot-put": "The shortest", javelin: "The shortest", weightlifting: "The lightest lifts", "50m-freestyle": "The slowest", "100m-freestyle": "The slowest", wrestling: "The easiest to push out", "all-around": "The fewest points",
};

function Table({ event, keys, start, label }: { event: EventId; keys: string[]; start: number; label: string }) {
  return (
    <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4">
      <table className="rct" aria-label={label}>
        <thead><tr><th scope="col">#</th><th scope="col">Pokémon</th><th scope="col">{event === "wrestling" ? "Ring strength" : "Mark"}</th><th scope="col" className="rct-x">Weight</th></tr></thead>
        <tbody>
          {keys.map((k, i) => {
            const a = GAMES_BY_KEY.get(k);
            return (
              <tr key={k}>
                <td>{start + i}</td>
                <td><Link href={pokemonPath(k)} prefetch={false} className="n">{nameOf(k)}</Link></td>
                <td><b>{recordMark(event, RECORDS_ALL.mark(k, event))}</b></td>
                <td className="rct-x g">{a ? `${a.kg} kg` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GamesRecordsPage({ event }: { event: EventId }) {
  const e = eventOf(event);
  const ranking = RECORDS_ALL.ranking(event);
  const top = ranking.slice(0, 10);
  const bottom = ranking.slice(-10).reverse();
  const holder = GAMES_BY_KEY.get(ranking[0])!;
  const n = ranking.length;
  const median = RECORDS_ALL.mark(ranking[Math.floor(n / 2)], event);
  const rival = ranking.find((k) => k === "pikachu") ? "pikachu" : ranking[Math.floor(n / 2)];
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${e.name} records: ${e.question}`,
    url: `${SITE_URL}${recordsPath(event)}`,
    numberOfItems: top.length,
    itemListElement: top.map((k, i) => ({ "@type": "ListItem", position: i + 1, name: `${nameOf(k)} (${recordMark(event, RECORDS_ALL.mark(k, event))})`, url: `${SITE_URL}${pokemonPath(k)}` })),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="games-records">
      <style>{RACE_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <ListHeader back={{ href: GAMES_PATH, label: "The PokéIQ Games" }} kicker={`The PokéIQ Games · ${e.emoji} records`} title={`${e.name} `} accent="records" blurb={`${e.question} ${e.name} pre-run for all ${n.toLocaleString("en")} Pokémon and forms, each at its best: real stats, real physics, the sport's real rules.`} />
      <EventNav current={event} />
      <section aria-labelledby="rec-holder" className="rounded-xl border bg-card/40 p-5">
        <p className="hud-label text-screen">The record</p>
        <h2 id="rec-holder" className="mt-1 font-display text-2xl font-bold uppercase tracking-tight sm:text-3xl">
          <Link href={pokemonPath(holder.key)} className="hover:text-primary">{holder.name}</Link>
          <span className="ml-2 text-primary">{recordMark(event, RECORDS_ALL.mark(holder.key, event))}</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {event === "wrestling" ? "The hardest Pokémon to push out of the ring: its push and brace together." : `The best ${e.lower} of all ${n.toLocaleString("en")}.`} The middle of the field: {recordMark(event, median)}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={eventPath(event)} prefetch={false} className="rc-go inline-flex h-10 items-center rounded-lg px-4 font-display text-xs font-bold uppercase tracking-wider" data-testid="records-watch">Watch the best eight in 3D</Link>
          {rival !== holder.key && <Link href={eventRunPath(event, { keys: [holder.key, rival] })} prefetch={false} className="inline-flex h-10 items-center rounded-lg border px-4 font-display text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">{h2hQuestion(event, holder.name, nameOf(rival))}</Link>}
        </div>
      </section>
      <section aria-labelledby="rec-top" className="space-y-3">
        <h2 id="rec-top" className="font-display text-lg font-bold uppercase tracking-wider">Top ten</h2>
        <Table event={event} keys={top} start={1} label={`${e.name}: the top ten`} />
      </section>
      <section aria-labelledby="rec-bottom" className="space-y-3">
        <h2 id="rec-bottom" className="font-display text-lg font-bold uppercase tracking-wider">{WORST[event]}</h2>
        <Table event={event} keys={bottom} start={n} label={`${e.name}: ${WORST[event].toLowerCase()}`} />
        <p className="text-xs text-muted-foreground">Numbered from the bottom: {n.toLocaleString("en")} is last.</p>
      </section>
      <p className="text-sm text-muted-foreground">How the marks are worked out: <Link href={eventPath(event)} className="underline-offset-2 hover:text-foreground hover:underline">{e.name} · how it works</Link>. Every Pokémon has its own page of results, linked from its name.</p>
    </div>
  );
}

export function GamesPokemonPage({ athlete }: { athlete: Athlete }) {
  const a = athlete;
  const rows = EVENT_IDS.map((id) => {
    const ranking = RECORDS_ALL.ranking(id);
    const rank = RECORDS_ALL.rank(a.key, id);
    return { id, mark: RECORDS_ALL.mark(a.key, id), rank, n: ranking.length, holder: ranking[0] };
  });
  const best = rows.filter((r) => r.rank != null && r.id !== "all-around").sort((x, y) => x.rank! / x.n - y.rank! / y.n)[0];
  const slug = dexSlug(a);
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${a.name} at the PokéIQ Games`,
    url: `${SITE_URL}${pokemonPath(a.key)}`,
    numberOfItems: rows.length,
    itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: `${eventOf(r.id).name}: ${recordMark(r.id, r.mark)}${r.rank ? ` (#${r.rank})` : ""}`, url: `${SITE_URL}${recordsPath(r.id)}` })),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="games-pokemon">
      <style>{RACE_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <ListHeader back={{ href: GAMES_PATH, label: "The PokéIQ Games" }} kicker="The PokéIQ Games · every event" title={`${a.name} `} accent="at the Games" blurb={`${a.name}'s mark and rank in every event of the PokéIQ Games, out of every Pokémon and form, from its real stats: ${a.stats.spe} Speed, ${a.stats.atk} Attack, ${a.stats.def} Defence, ${a.stats.hp} HP, ${a.kg} kg, ${a.height} m.`} />
      {best && (
        <section className="rounded-xl border bg-card/40 p-5">
          <p className="hud-label text-screen">Best event</p>
          <h2 className="mt-1 font-display text-2xl font-bold uppercase tracking-tight">{eventOf(best.id).name} <span className="text-primary">#{best.rank}</span></h2>
          <p className="mt-1 text-sm text-muted-foreground">{recordMark(best.id, best.mark)}: better than {Math.max(0, Math.round((1 - best.rank! / best.n) * 100))}% of all Pokémon.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {best.holder !== a.key && <Link href={eventRunPath(best.id, { keys: [a.key, best.holder] })} prefetch={false} className="rc-go inline-flex h-10 items-center rounded-lg px-4 font-display text-xs font-bold uppercase tracking-wider">{h2hQuestion(best.id, a.name, nameOf(best.holder))}</Link>}
            {slug && <Link href={`/pokemon/${slug}`} className="inline-flex h-10 items-center rounded-lg border px-4 font-display text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">{a.name} in the Pokédex</Link>}
          </div>
        </section>
      )}
      <section aria-labelledby="pk-events" className="space-y-3">
        <h2 id="pk-events" className="font-display text-lg font-bold uppercase tracking-wider">Every event</h2>
        <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4">
          <table className="rct" aria-label={`${a.name}: every event`}>
            <thead><tr><th scope="col">Event</th><th scope="col">Mark</th><th scope="col">Rank</th><th scope="col" className="rct-x">Record</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={recordsPath(r.id)} prefetch={false} className="n">{eventOf(r.id).name}</Link></td>
                  <td><b>{recordMark(r.id, r.mark)}</b></td>
                  <td>{r.rank ? `#${r.rank} of ${r.n.toLocaleString("en")}` : "—"}</td>
                  <td className="rct-x g">{r.holder === a.key ? "The record" : `${nameOf(r.holder)} ${recordMark(r.id, RECORDS_ALL.mark(r.holder, r.id))}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="pk-race" className="space-y-2">
        <h2 id="pk-race" className="font-display text-lg font-bold uppercase tracking-wider">Watch it in 3D</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {EVENTS.filter((e) => e.id !== "all-around").map((e) => {
            const holder = RECORDS_ALL.ranking(e.id)[0];
            const vs = holder === a.key ? RECORDS_ALL.ranking(e.id)[1] : holder;
            return <li key={e.id}><Link href={eventRunPath(e.id, { keys: [a.key, vs] })} prefetch={false} className="block rounded-md border bg-card/40 px-3 py-2 text-sm hover:border-primary/50"><span className="font-display font-semibold uppercase tracking-wide">{e.name}</span><span className="ml-2 text-muted-foreground">v {nameOf(vs)}</span></Link></li>;
          })}
        </ul>
      </section>
    </div>
  );
}
