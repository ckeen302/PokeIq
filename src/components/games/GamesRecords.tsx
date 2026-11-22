import Link from "@/components/ui/PlainLink";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { EVENTS, EVENT_IDS, eventOf, formatMark, localNum, type EventId } from "@/lib/games/events";
import { GAMES_PATH, eventPath, eventRunPath, h2hQuestion, pokemonPath, recordsPath } from "@/lib/games/deeplink";
import { RECORDS_ALL } from "@/lib/games/records-data";
import type { Athlete } from "@/lib/games/athlete";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { RACE_CSS } from "@/components/race/race-css";
import { EventNav, GamesNames, H2HSection, localName } from "./GamesPages";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import gamesEvents from "@/messages/games-events";
import gamesH2h from "@/messages/games-h2h";
import gamesPages from "@/messages/games-pages";
import { pokemonMatchups } from "@/lib/games/h2h-ideas";

/**
 * The records of the Games (every event pre-run for all 1,025 Pokémon and
 * their forms: scripts/games-records.ts) and each Pokémon's own page of
 * results. Server components.
 */

const nameOf = (k: string) => { const a = GAMES_BY_KEY.get(k); return a ? localName(a) : k; };
const dexSlug = (a: Athlete) => getPokemon(a.entrant.species)?.slug ?? null;

/** A record's mark as shown: wrestling's column is the ring strength (push + brace). */
export function recordMark(event: EventId, v: number | null, locale = "en"): string {
  if (v == null) return "—";
  if (event === "wrestling") return localNum(`${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kN`, locale);
  return formatMark(event, v, locale);
}

function Table({ event, keys, start, label }: { event: EventId; keys: string[]; start: number; label: string }) {
  const t = serverT(gamesPages);
  const lc = t.locale;
  return (
    <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4">
      <table className="rct" aria-label={label}>
        <thead><tr><th scope="col">#</th><th scope="col">{t("colPokemon")}</th><th scope="col">{t(event === "wrestling" ? "colRing" : "colMark")}</th><th scope="col" className="rct-x">{t("colWeight")}</th></tr></thead>
        <tbody>
          {keys.map((k, i) => {
            const a = GAMES_BY_KEY.get(k);
            return (
              <tr key={k}>
                <td>{start + i}</td>
                <td><Link href={pokemonPath(k)} prefetch={false} className="n">{nameOf(k)}</Link></td>
                <td><b>{recordMark(event, RECORDS_ALL.mark(k, event), lc)}</b></td>
                <td className="rct-x g">{a ? localNum(`${a.kg} kg`, lc) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GamesRecordsPage({ event }: { event: EventId }) {
  const t = serverT(gamesPages);
  const te = serverT(gamesEvents);
  const lc = t.locale;
  const e = eventOf(event);
  const eName = te(`events.${event}.name`);
  const question = te(`events.${event}.question`);
  const nFmt = (x: number) => localNum(x.toLocaleString("en"), lc);
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
    name: t("rec.ldName", { event: eName, question }),
    url: `${SITE_URL}${recordsPath(event)}`,
    numberOfItems: top.length,
    itemListElement: top.map((k, i) => ({ "@type": "ListItem", position: i + 1, name: `${nameOf(k)} (${recordMark(event, RECORDS_ALL.mark(k, event), lc)})`, url: `${SITE_URL}${pokemonPath(k)}` })),
  };
  return (
    <GamesNames>
    <ClientMessages namespaces={[gamesH2h, gamesEvents]}>
    <div className="mx-auto max-w-4xl space-y-6" data-testid="games-records">
      <style>{RACE_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <ListHeader back={{ href: GAMES_PATH, label: t("games") }} kicker={t("rec.kicker", { emoji: e.emoji })} title={`${eName} `} accent={t("rec.accent")} blurb={t("rec.blurb", { question, event: eName, n: nFmt(n) })} />
      <EventNav current={event} />
      <section aria-labelledby="rec-holder" className="rounded-xl border bg-card/40 p-5">
        <p className="hud-label text-screen">{t("rec.record")}</p>
        <h2 id="rec-holder" className="mt-1 font-display text-2xl font-bold uppercase tracking-tight sm:text-3xl">
          <Link href={pokemonPath(holder.key)} className="hover:text-primary">{localName(holder)}</Link>
          <span className="ml-2 text-primary">{recordMark(event, RECORDS_ALL.mark(holder.key, event), lc)}</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {event === "wrestling" ? t("rec.wrestlingHolder") : t("rec.bestOf", { lower: te(`events.${event}.lower`), n: nFmt(n) })}{t("rec.middle", { mark: recordMark(event, median, lc) })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={eventPath(event)} prefetch={false} className="rc-go inline-flex h-10 items-center rounded-lg px-4 font-display text-xs font-bold uppercase tracking-wider" data-testid="records-watch">{t("rec.watch")}</Link>
          {rival !== holder.key && <Link href={eventRunPath(event, { keys: [holder.key, rival] })} prefetch={false} className="inline-flex h-10 items-center rounded-lg border px-4 font-display text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">{h2hQuestion(event, localName(holder), nameOf(rival), te)}</Link>}
        </div>
      </section>
      <section aria-labelledby="rec-top" className="space-y-3">
        <h2 id="rec-top" className="font-display text-lg font-bold uppercase tracking-wider">{t("rec.top")}</h2>
        <Table event={event} keys={top} start={1} label={t("rec.topLabel", { event: eName })} />
      </section>
      <section aria-labelledby="rec-bottom" className="space-y-3">
        <h2 id="rec-bottom" className="font-display text-lg font-bold uppercase tracking-wider">{t(`rec.worst.${event}`)}</h2>
        <Table event={event} keys={bottom} start={n} label={t("rec.bottomLabel", { event: eName, worst: t(`rec.worstLower.${event}`) })} />
        <p className="text-xs text-muted-foreground">{t("rec.numbered", { n: nFmt(n) })}</p>
      </section>
      <p className="text-sm text-muted-foreground">{t.rich("rec.howMarks", { event: eName, a: (c) => <Link href={eventPath(event)} className="underline-offset-2 hover:text-foreground hover:underline">{c}</Link> })}</p>
    </div>
    </ClientMessages>
    </GamesNames>
  );
}

export function GamesPokemonPage({ athlete }: { athlete: Athlete }) {
  const t = serverT(gamesPages);
  const te = serverT(gamesEvents);
  const lc = t.locale;
  const a = athlete;
  const name = localName(a);
  const ev = (id: EventId) => te(`events.${id}.name`);
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
    name: t("pk.ldName", { name }),
    url: `${SITE_URL}${pokemonPath(a.key)}`,
    numberOfItems: rows.length,
    itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: `${t("pk.ldItem", { event: ev(r.id), mark: recordMark(r.id, r.mark, lc) })}${r.rank ? ` (#${r.rank})` : ""}`, url: `${SITE_URL}${recordsPath(r.id)}` })),
  };
  return (
    <GamesNames>
    <ClientMessages namespaces={[gamesH2h, gamesEvents]}>
    <div className="mx-auto max-w-4xl space-y-6" data-testid="games-pokemon">
      <style>{RACE_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <ListHeader back={{ href: GAMES_PATH, label: t("games") }} kicker={t("playKicker")} title={`${name} `} accent={t("pk.accent")} blurb={t("pk.blurb", { name, spe: a.stats.spe, atk: a.stats.atk, def: a.stats.def, hp: a.stats.hp, kg: localNum(String(a.kg), lc), m: localNum(String(a.height), lc) })} />
      {best && (
        <section className="rounded-xl border bg-card/40 p-5">
          <p className="hud-label text-screen">{t("pk.best")}</p>
          <h2 className="mt-1 font-display text-2xl font-bold uppercase tracking-tight">{ev(best.id)} <span className="text-primary">#{best.rank}</span></h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("pk.better", { mark: recordMark(best.id, best.mark, lc), pct: Math.max(0, Math.round((1 - best.rank! / best.n) * 100)) })}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {best.holder !== a.key && <Link href={eventRunPath(best.id, { keys: [a.key, best.holder] })} prefetch={false} className="rc-go inline-flex h-10 items-center rounded-lg px-4 font-display text-xs font-bold uppercase tracking-wider">{h2hQuestion(best.id, name, nameOf(best.holder), te)}</Link>}
            {slug && <Link href={`/pokemon/${slug}`} className="inline-flex h-10 items-center rounded-lg border px-4 font-display text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">{t("pk.inDex", { name })}</Link>}
          </div>
        </section>
      )}
      <H2HSection id="pk-h2h" title={t("h2h")} blurb={t("pk.h2hBlurb", { name })} a={a.key} ideas={pokemonMatchups(a)} />
      <section aria-labelledby="pk-events" className="space-y-3">
        <h2 id="pk-events" className="font-display text-lg font-bold uppercase tracking-wider">{t("everyEvent")}</h2>
        <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4">
          <table className="rct" aria-label={t("pk.everyLabel", { name })}>
            <thead><tr><th scope="col">{t("pk.colEvent")}</th><th scope="col">{t("colMark")}</th><th scope="col">{t("pk.colRank")}</th><th scope="col" className="rct-x">{t("pk.colRecord")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={recordsPath(r.id)} prefetch={false} className="n">{ev(r.id)}</Link></td>
                  <td><b>{recordMark(r.id, r.mark, lc)}</b></td>
                  <td>{r.rank ? t("pk.rankOf", { rank: r.rank, n: localNum(r.n.toLocaleString("en"), lc) }) : "—"}</td>
                  <td className="rct-x g">{r.holder === a.key ? t("pk.theRecord") : `${nameOf(r.holder)} ${recordMark(r.id, RECORDS_ALL.mark(r.holder, r.id), lc)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="pk-race" className="space-y-2">
        <h2 id="pk-race" className="font-display text-lg font-bold uppercase tracking-wider">{t("pk.watch")}</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {EVENTS.filter((e) => e.id !== "all-around").map((e) => {
            const holder = RECORDS_ALL.ranking(e.id)[0];
            const vs = holder === a.key ? RECORDS_ALL.ranking(e.id)[1] : holder;
            return <li key={e.id}><Link href={eventRunPath(e.id, { keys: [a.key, vs] })} prefetch={false} className="block rounded-md border bg-card/40 px-3 py-2 text-sm hover:border-primary/50"><span className="font-display font-semibold uppercase tracking-wide">{ev(e.id)}</span><span className="ml-2 text-muted-foreground">{t("pk.vs", { name: nameOf(vs) })}</span></Link></li>;
          })}
        </ul>
      </section>
    </div>
    </ClientMessages>
    </GamesNames>
  );
}
