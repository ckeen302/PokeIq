import Link from "next/link";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { LAB_PATH } from "@/lib/lab";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { EVENTS, eventOf, formatMark, type EventId } from "@/lib/games/events";
import { buildNations, medalTable, runEvent, runGames, type NationSpec } from "@/lib/games/games";
import { DEFAULT_NATIONS, GAMES_PATH, PLAY_PATH, eventPath, eventRunPath, h2hQuestion, pokemonPath, recordsPath } from "@/lib/games/deeplink";
import { DEFAULT_GAMES_SEED } from "@/lib/games/seed";
import { DEFAULT_FIELDS, RECORDS_FILE } from "@/lib/games/records-data";
import type { Athlete } from "@/lib/games/athlete";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { BackButton } from "@/components/ui/BackButton";
import { RACE_CSS } from "@/components/race/race-css";
import { GamesExperience } from "./GamesExperience";
import { GamesInfo } from "./GamesInfo";
import { cn } from "@/lib/utils";

/**
 * The server-rendered pages of the Games: an event (its results for the
 * line-up, how it works, the records), the Games (the medal table), with
 * the 3D broadcast on top. What search engines, reduced motion and
 * browsers without WebGL get.
 */

const dexSlug = (a: Athlete) => getPokemon(a.entrant.species)?.slug ?? a.key;

export function EventNav({ current }: { current?: EventId }) {
  return (
    <nav aria-label="Events" className="flex flex-wrap justify-center gap-2">
      {EVENTS.map((e) => (
        <Link key={e.id} href={eventPath(e.id)} prefetch={false} className={cn("rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors", e.id === current ? "border-primary/60 text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {e.name}
        </Link>
      ))}
    </nav>
  );
}

export function GamesEventPage({ event, keys = [], seed = null, rain = false }: { event: EventId; keys?: string[]; seed?: number | null; rain?: boolean }) {
  const e = eventOf(event);
  const custom = keys.length > 0;
  const fieldKeys = custom ? keys : DEFAULT_FIELDS[event];
  const field = fieldKeys.map((k) => GAMES_BY_KEY.get(k)).filter((a): a is Athlete => !!a);
  const s = seed ?? DEFAULT_GAMES_SEED;
  const out = runEvent(event, field, s, { rain });
  const h2h = field.length === 2;
  const title = h2h ? h2hQuestion(event, field[0].name, field[1].name) : custom ? `${e.name}: ${field.map((a) => a.name).join(", ")}` : `${e.name}`;
  const path = custom || seed != null || rain ? eventRunPath(event, { keys: custom ? keys : undefined, seed, rain }) : eventPath(event);
  const winner = out.podium.gold[0] ? GAMES_BY_KEY.get(out.podium.gold[0]) : null;
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${title}: results`,
    url: `${SITE_URL}${path}`,
    numberOfItems: out.standings.length,
    itemListElement: out.standings.map((k, i) => {
      const a = GAMES_BY_KEY.get(k)!;
      return { "@type": "ListItem", position: i + 1, name: event === "wrestling" ? a.name : `${a.name} (${formatMark(event, out.marks.get(k))})`, url: `${SITE_URL}/pokemon/${dexSlug(a)}` };
    }),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <style>{RACE_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <GamesExperience init={{ mode: "event", event, keys, defaults: DEFAULT_FIELDS[event], seed: s, rain }}>
        <div className="space-y-6">
          {custom ? (
            <div className="space-y-3 text-center">
              <div className="text-left"><BackButton href={eventPath(event)} label={e.name} /></div>
              <p className="hud-label text-screen">The PokéIQ Games · {e.name}</p>
              <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{title}</h1>
              {winner && <p className="text-muted-foreground">{event === "wrestling" ? `${winner.name} wins the bracket` : `${winner.name} wins with ${formatMark(event, out.marks.get(winner.key))}`}, from their stats.</p>}
            </div>
          ) : (
            <ListHeader back={{ href: GAMES_PATH, label: "The PokéIQ Games" }} kicker={`The PokéIQ Games · ${e.emoji}`} title={`${e.name} `} accent="in 3D" blurb={`${e.question} Eight Pokémon in ${e.lower}, scored from their real stats with real physics and the sport's real rules, then played out in 3D. Pick your own line-up, share it or make a video.`} />
          )}
          <EventNav current={event} />
          <section aria-labelledby="games-results" className="space-y-3">
            <h2 id="games-results" className="font-display text-lg font-bold uppercase tracking-wider">Results · {e.name}</h2>
            <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4" data-testid="games-list">
              <table className="rct" aria-label={`${title}: results`}>
                <thead><tr><th scope="col">#</th><th scope="col">Pokémon</th><th scope="col">{event === "wrestling" ? "Ring strength" : "Mark"}</th><th scope="col" className="rct-x">Weight</th></tr></thead>
                <tbody>
                  {out.standings.map((k, i) => {
                    const a = GAMES_BY_KEY.get(k)!;
                    return (
                      <tr key={k} id={`games-${k}`}>
                        <td>{i + 1}</td>
                        <td><Link href={pokemonPath(k)} prefetch={false} className="n">{a.name}</Link></td>
                        <td><b>{event === "wrestling" ? `${i === 0 ? "Gold" : i === 1 ? "Silver" : i === 2 ? "Bronze" : "—"}` : formatMark(event, out.marks.get(k))}</b></td>
                        <td className="rct-x g">{a.kg} kg</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">Who is the best of all Pokémon? <Link href={recordsPath(event)} className="underline-offset-2 hover:text-foreground hover:underline">See the {e.name.toLowerCase()} records for all 1,025 Pokémon</Link>.</p>
          </section>
          <section aria-labelledby="games-how" className="rounded-lg border bg-card/40 p-4">
            <h2 id="games-how" className="mb-2 font-display text-lg font-bold uppercase tracking-wider">How it works</h2>
            <GamesInfo event={event} athletes={field} rain={rain} />
          </section>
        </div>
      </GamesExperience>
    </div>
  );
}

export function GamesPlayPage({ nations = DEFAULT_NATIONS, seed = null, rain = false }: { nations?: NationSpec[]; seed?: number | null; rain?: boolean }) {
  const ns = buildNations(nations, GAMES_BY_KEY, RECORDS_FILE.nations);
  const s = seed ?? DEFAULT_GAMES_SEED;
  const g = runGames(ns, s, { rain });
  const champ = g.champion ? GAMES_BY_KEY.get(g.champion) : null;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <style>{RACE_CSS}</style>
      <GamesExperience init={{ mode: "games", nations, candidates: RECORDS_FILE.nations, seed: s, rain }}>
        <div className="space-y-6">
          <ListHeader back={{ href: GAMES_PATH, label: "The PokéIQ Games" }} kicker="The PokéIQ Games · every event" title="The " accent="Games" blurb="Up to eight nations of three Pokémon (a type, or a team you build) through every event in order, with a live medal table, the medal ceremonies and the Champion of the Games." />
          <section aria-labelledby="games-table" className="space-y-3">
            <h2 id="games-table" className="font-display text-lg font-bold uppercase tracking-wider">Medal table</h2>
            <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4" data-testid="games-list">
              <table className="rct">
                <thead><tr><th>#</th><th>Nation</th><th>Gold</th><th>Silver</th><th>Bronze</th></tr></thead>
                <tbody>
                  {g.table.map((r) => (
                    <tr key={r.nation.id}>
                      <td>{r.rank}</td>
                      <td><span className="n">{r.nation.name}</span><span className="k">{r.nation.athletes.map((a) => a.name).join(" · ")}</span></td>
                      <td><b>{r.gold}</b></td><td>{r.silver}</td><td>{r.bronze}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {champ && <p className="text-sm text-muted-foreground">Champion of the Games (the all-around): <strong className="text-foreground">{champ.name}</strong>.</p>}
          </section>
          <section aria-labelledby="games-events" className="space-y-2">
            <h2 id="games-events" className="font-display text-lg font-bold uppercase tracking-wider">Every event</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {g.outcomes.map((o) => {
                const w = o.podium.gold.map((k) => GAMES_BY_KEY.get(k)?.name).join(", ");
                return <li key={o.event} className="rounded-md border bg-card/40 px-3 py-2 text-sm"><Link href={eventPath(o.event)} className="font-display font-semibold uppercase tracking-wide hover:text-primary">{eventOf(o.event).name}</Link><span className="ml-2 text-muted-foreground">{w}{o.event !== "wrestling" && o.podium.gold[0] ? ` · ${formatMark(o.event, o.marks.get(o.podium.gold[0]))}` : ""}</span></li>;
              })}
            </ul>
          </section>
        </div>
      </GamesExperience>
    </div>
  );
}

/** /lab/games: single events, the Games, the records and head to heads. */
export function GamesHub() {
  const h2h: { event: EventId; a: string; b: string }[] = [
    { event: "weightlifting", a: "snorlax", b: "machamp" },
    { event: "100m", a: "regieleki", b: "shuckle" },
    { event: "50m-freestyle", a: "magikarp", b: "pikachu" },
    { event: "wrestling", a: "wailord", b: "groudon" },
    { event: "high-jump", a: "pikachu", b: "eevee" },
    { event: "shot-put", a: "machamp", b: "conkeldurr" },
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-10" data-testid="games-hub">
      <ListHeader back={{ href: LAB_PATH, label: "3D Lab" }} kicker="3D Lab · real sport, real stats" title="The PokéIQ " accent="Games" blurb="Real track and field, weightlifting, swimming and wrestling for every Pokémon: scored from their base stats, height, weight and body shape with real physics and each sport's real rules, then played out in 3D in a stadium, an arena and an aquatics centre." />
      <section aria-labelledby="hub-events" className="space-y-3">
        <h2 id="hub-events" className="font-display text-xl font-bold uppercase tracking-wider">Single events</h2>
        <p className="text-sm text-muted-foreground">Pick an event and up to eight Pokémon, or let the site pick a fun line-up: heats, a final and the podium, with a share link and a video.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {EVENTS.map((e) => (
            <Link key={e.id} href={eventPath(e.id)} prefetch={false} className="group rounded-lg border bg-card/40 p-3 transition-colors hover:border-primary/50" data-testid={`hub-event-${e.id}`}>
              <span className="text-xl" aria-hidden>{e.emoji}</span>
              <span className="mt-1 block font-display text-sm font-bold uppercase tracking-wide group-hover:text-primary">{e.name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{e.question}</span>
            </Link>
          ))}
        </div>
      </section>
      <section aria-labelledby="hub-games" className="rounded-xl border bg-card/40 p-5">
        <h2 id="hub-games" className="font-display text-xl font-bold uppercase tracking-wider">The Games</h2>
        <p className="mt-1 text-sm text-muted-foreground">Up to eight nations of three: Team Fire, Team Water… or a team you build. Every event in order, a live medal table, the medal ceremonies and a Champion of the Games.</p>
        <Link href={PLAY_PATH} className="rc-go mt-3 inline-flex h-11 items-center gap-2 rounded-lg px-5 font-display text-sm font-bold uppercase tracking-wider" data-testid="hub-play">Open the Games</Link>
      </section>
      <section aria-labelledby="hub-records" className="space-y-3">
        <h2 id="hub-records" className="font-display text-xl font-bold uppercase tracking-wider">Records</h2>
        <p className="text-sm text-muted-foreground">Every event pre-run for all 1,025 Pokémon and their forms: the top ten, the slowest and the record holder.</p>
        <ul className="flex flex-wrap gap-2">
          {EVENTS.map((e) => (
            <li key={e.id}><Link href={recordsPath(e.id)} prefetch={false} className="inline-flex rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">{e.name} records</Link></li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="hub-h2h" className="space-y-3">
        <h2 id="hub-h2h" className="font-display text-xl font-bold uppercase tracking-wider">Head to head</h2>
        <p className="text-sm text-muted-foreground">Two Pokémon, one event, and a vertical video ready for TikTok.</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {h2h.map((x) => {
            const a = GAMES_BY_KEY.get(x.a)!, b = GAMES_BY_KEY.get(x.b)!;
            return <li key={`${x.event}-${x.a}`}><Link href={eventRunPath(x.event, { keys: [x.a, x.b] })} prefetch={false} className="block rounded-md border bg-card/40 px-3 py-2 font-display text-sm font-semibold uppercase tracking-wide hover:border-primary/50" data-testid="hub-h2h">{h2hQuestion(x.event, a.name, b.name)}</Link></li>;
          })}
        </ul>
      </section>
      <section className="rounded-lg border bg-card/40 p-4 text-sm text-muted-foreground">
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-foreground">The rules of the Games</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Only real data: base stats, height, weight, types, abilities, body shape and egg groups, from the Pokédex.</li>
          <li>Real physics (projectiles under g = 9.81 m/s², air drag where it matters) and each sport&apos;s real rules (false starts, fouls, countback, rising-bar lifting).</li>
          <li>The stat-to-ability scale is ours, stated openly: a 70 kg athlete with base 100 lands an elite human mark. Muscle force grows with mass^(2/3), so giants are strong but not proportionally stronger.</li>
          <li>Each attempt has a seeded ±1.5% day-to-day form, so stats decide nearly every result and a share link replays exactly.</li>
        </ul>
      </section>
    </div>
  );
}
