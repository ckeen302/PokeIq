import Link from "@/components/ui/PlainLink";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { LAB_PATH } from "@/lib/lab";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { EVENTS, eventOf, formatMark, localNum, type EventId } from "@/lib/games/events";
import { buildNations, runEvent, runGames, type NationSpec } from "@/lib/games/games";
import { DEFAULT_NATIONS, GAMES_PATH, PLAY_PATH, eventPath, eventRunPath, h2hQuestion, pokemonPath, recordsPath } from "@/lib/games/deeplink";
import { DEFAULT_GAMES_SEED } from "@/lib/games/seed";
import { DEFAULT_FIELDS, RECORDS_FILE } from "@/lib/games/records-data";
import { athleteName, gamesNames, typeName, typeNames } from "@/lib/games/names";
import type { Athlete } from "@/lib/games/athlete";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { BackButton } from "@/components/ui/BackButton";
import { RACE_CSS } from "@/components/race/race-css";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import type { Translator } from "@/i18n/catalog";
import gamesEvents from "@/messages/games-events";
import gamesInfo from "@/messages/games-info";
import gamesPages from "@/messages/games-pages";
import gamesH2h from "@/messages/games-h2h";
import gamesStadium from "@/messages/games-stadium";
import { GAMES_3D_NAMESPACES } from "./namespaces";
import { GamesExperience } from "./GamesExperience";
import { GamesInfo } from "./GamesInfo";
import { GamesStadium } from "./GamesStadium";
import { H2HPicker } from "./H2HPicker";
import { GamesNamesProvider } from "./names";
import { RIVALS, eventMatchups, hubMatchups } from "@/lib/games/h2h-ideas";
import type { Matchup } from "@/lib/games/h2h";
import { cn } from "@/lib/utils";

/**
 * The server-rendered pages of the Games: an event (its results for the
 * line-up, how it works, the records), the Games (the medal table), with
 * the 3D broadcast on top. What search engines, reduced motion and
 * browsers without WebGL get.
 */

const dexSlug = (a: Athlete) => getPokemon(a.entrant.species)?.slug ?? a.key;

/** An athlete's name in the page's language. */
export const localName = (a: Athlete) => athleteName(a, serverT(gamesPages).locale);

/**
 * The roster's names in the page's language, for the client components below (the 3D view and the pickers fetch
 * the English roster); on an English page the children as they are.
 */
export function GamesNames({ children }: { children: React.ReactNode }) {
  const locale = serverT(gamesPages).locale;
  const n = gamesNames(locale);
  if (!n) return children;
  return <GamesNamesProvider value={{ ...n, types: typeNames(locale) }}>{children}</GamesNamesProvider>;
}

/** A nation's name in the page's language ("Team Fire", "Equipo Fuego"). */
export function nationLabel(n: { type: string | null; name: string; athletes: Athlete[] }): string {
  const t = serverT(gamesPages);
  if (t.locale === "en") return n.name;
  return t("team", { name: n.type ? typeName(n.type, t.locale) : n.athletes[0] ? localName(n.athletes[0]) : n.name });
}

/** An event's name in the language, as a sentence takes it ("the long jump" lowercased in English). */
export function lowerEventName(t: Translator<typeof gamesEvents.en>, id: EventId): string {
  const name = t(`events.${id}.name`);
  return t.locale === "de" || t.locale === "ja" ? name : name.toLowerCase();
}

export function EventNav({ current }: { current?: EventId }) {
  const t = serverT(gamesPages);
  const te = serverT(gamesEvents);
  return (
    <nav aria-label={t("events")} className="flex flex-wrap justify-center gap-2">
      {EVENTS.map((e) => (
        <Link key={e.id} href={eventPath(e.id)} prefetch={false} className={cn("tap rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors", e.id === current ? "border-primary/60 text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {te(`events.${e.id}.name`)}
        </Link>
      ))}
    </nav>
  );
}

const rivalNames = () => Object.fromEntries(RIVALS.map((k) => [k, (GAMES_BY_KEY.get(k) && localName(GAMES_BY_KEY.get(k)!)) ?? k]));

/** Example head to heads (each found by running the event: see lib/games/h2h), as links that play them. */
export function H2HIdeas({ ideas }: { ideas: Matchup[] }) {
  const t = serverT(gamesPages);
  const te = serverT(gamesEvents);
  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="h2h-ideas">
      {ideas.map((x) => {
        const a = GAMES_BY_KEY.get(x.a), b = GAMES_BY_KEY.get(x.b);
        if (!a || !b) return null;
        return (
          <li key={`${x.event}-${x.a}-${x.b}`}>
            <Link href={eventRunPath(x.event, { keys: [x.a, x.b] })} prefetch={false} className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-card/40 px-3 py-2 hover:border-primary/50" data-testid="hub-h2h">
              <span className="min-w-0 font-display text-sm font-semibold uppercase tracking-wide">{h2hQuestion(x.event, localName(a), localName(b), te)}</span>
              <span className="shrink-0 font-pixel text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{t(x.why === "close" ? "closeFinish" : "againstOdds")}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Pick two Pokémon and an event, with example match-ups under it. */
export function H2HSection({ id, title, blurb, a, event, ideas }: { id: string; title: string; blurb: string; a?: string; event?: EventId; ideas: Matchup[] }) {
  return (
    <section aria-labelledby={id} className="space-y-3" data-testid="h2h-section">
      <h2 id={id} className="font-display text-lg font-bold uppercase tracking-wider">{title}</h2>
      <p className="text-sm text-muted-foreground">{blurb}</p>
      <H2HPicker a={a ?? null} event={event ?? null} rivals={RIVALS} names={rivalNames()} />
      {ideas.length > 0 && <H2HIdeas ideas={ideas} />}
    </section>
  );
}

export function GamesEventPage({ event, keys = [], seed = null, rain = false }: { event: EventId; keys?: string[]; seed?: number | null; rain?: boolean }) {
  const t = serverT(gamesPages);
  const te = serverT(gamesEvents);
  const lc = t.locale;
  const e = eventOf(event);
  const eName = te(`events.${event}.name`);
  const custom = keys.length > 0;
  const fieldKeys = custom ? keys : DEFAULT_FIELDS[event];
  const field = fieldKeys.map((k) => GAMES_BY_KEY.get(k)).filter((a): a is Athlete => !!a);
  const s = seed ?? DEFAULT_GAMES_SEED;
  const out = runEvent(event, field, s, { rain });
  const h2h = field.length === 2;
  const title = h2h ? h2hQuestion(event, localName(field[0]), localName(field[1]), te) : custom ? t("eventField", { event: eName, names: field.map(localName).join(", ") }) : `${eName}`;
  const path = custom || seed != null || rain ? eventRunPath(event, { keys: custom ? keys : undefined, seed, rain }) : eventPath(event);
  const winner = out.podium.gold[0] ? GAMES_BY_KEY.get(out.podium.gold[0]) : null;
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t("results", { title }),
    url: `${SITE_URL}${path}`,
    numberOfItems: out.standings.length,
    itemListElement: out.standings.map((k, i) => {
      const a = GAMES_BY_KEY.get(k)!;
      return { "@type": "ListItem", position: i + 1, name: event === "wrestling" ? localName(a) : `${localName(a)} (${formatMark(event, out.marks.get(k), lc)})`, url: `${SITE_URL}/pokemon/${dexSlug(a)}` };
    }),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <style>{RACE_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <GamesNames>
      <ClientMessages namespaces={GAMES_3D_NAMESPACES}>
      <GamesExperience init={{ mode: "event", event, keys, defaults: DEFAULT_FIELDS[event], seed: s, rain }}>
        <div className="space-y-6">
          {custom ? (
            <div className="space-y-3 text-center">
              <div className="text-left"><BackButton href={eventPath(event)} label={eName} /></div>
              <p className="hud-label text-screen">{t("kickerEvent", { event: eName })}</p>
              <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{title}</h1>
              {winner && <p className="text-muted-foreground">{event === "wrestling" ? t("winsBracket", { name: localName(winner) }) : t("winsWith", { name: localName(winner), mark: formatMark(event, out.marks.get(winner.key), lc) })}</p>}
            </div>
          ) : (
            <ListHeader back={{ href: GAMES_PATH, label: t("games") }} kicker={t("kickerEmoji", { emoji: e.emoji })} title={`${eName} `} accent={t("inThreeD")} blurb={t("eventBlurb", { question: te(`events.${event}.question`), lower: te(`events.${event}.lower`) })} />
          )}
          <EventNav current={event} />
          <section aria-labelledby="games-results" className="space-y-3">
            <h2 id="games-results" className="font-display text-lg font-bold uppercase tracking-wider">{t("resultsHeading", { event: eName })}</h2>
            <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4" data-testid="games-list">
              <table className="rct" aria-label={t("results", { title })}>
                <thead><tr><th scope="col">#</th><th scope="col">{t("colPokemon")}</th><th scope="col">{t(event === "wrestling" ? "colRing" : "colMark")}</th><th scope="col" className="rct-x">{t("colWeight")}</th></tr></thead>
                <tbody>
                  {out.standings.map((k, i) => {
                    const a = GAMES_BY_KEY.get(k)!;
                    return (
                      <tr key={k} id={`games-${k}`}>
                        <td>{i + 1}</td>
                        <td><Link href={pokemonPath(k)} prefetch={false} className="n">{localName(a)}</Link></td>
                        <td><b>{event === "wrestling" ? `${i === 0 ? t("gold") : i === 1 ? t("silver") : i === 2 ? t("bronze") : "—"}` : formatMark(event, out.marks.get(k), lc)}</b></td>
                        <td className="rct-x g">{localNum(`${a.kg} kg`, lc)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">{t.rich("seeRecords", { event: lowerEventName(te, event), a: (c) => <Link href={recordsPath(event)} className="underline-offset-2 hover:text-foreground hover:underline">{c}</Link> })}</p>
          </section>
          <H2HSection id="games-h2h" title={t("h2h")} blurb={event === "all-around" ? t("h2hBlurbOne") : t("h2hBlurbEvent", { lower: te(`events.${event}.lower`) })} event={event === "all-around" ? undefined : event} a={h2h ? field[0].key : undefined} ideas={custom ? [] : eventMatchups(event)} />
          <section aria-labelledby="games-how" className="rounded-lg border bg-card/40 p-4">
            <h2 id="games-how" className="mb-2 font-display text-lg font-bold uppercase tracking-wider">{t("how")}</h2>
            <GamesInfo t={serverT(gamesInfo)} event={event} athletes={field.map((a) => ({ ...a, name: localName(a) }))} rain={rain} typeName={(x) => typeName(x, lc)} />
          </section>
        </div>
      </GamesExperience>
      </ClientMessages>
      </GamesNames>
    </div>
  );
}

export function GamesPlayPage({ nations = DEFAULT_NATIONS, seed = null, rain = false }: { nations?: NationSpec[]; seed?: number | null; rain?: boolean }) {
  const t = serverT(gamesPages);
  const te = serverT(gamesEvents);
  const lc = t.locale;
  const ns = buildNations(nations, GAMES_BY_KEY, RECORDS_FILE.nations);
  const s = seed ?? DEFAULT_GAMES_SEED;
  const g = runGames(ns, s, { rain });
  const champ = g.champion ? GAMES_BY_KEY.get(g.champion) : null;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <style>{RACE_CSS}</style>
      <GamesNames>
      <ClientMessages namespaces={GAMES_3D_NAMESPACES}>
      <GamesExperience init={{ mode: "games", nations, candidates: RECORDS_FILE.nations, seed: s, rain }}>
        <div className="space-y-6">
          <ListHeader back={{ href: GAMES_PATH, label: t("games") }} kicker={t("playKicker")} title={t("playTitle")} accent={t("playAccent")} blurb={t("playBlurb")} />
          <section aria-labelledby="games-table" className="space-y-3">
            <h2 id="games-table" className="font-display text-lg font-bold uppercase tracking-wider">{t("medalTable")}</h2>
            <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4" data-testid="games-list">
              <table className="rct">
                <thead><tr><th>#</th><th>{t("colNation")}</th><th>{t("gold")}</th><th>{t("silver")}</th><th>{t("bronze")}</th></tr></thead>
                <tbody>
                  {g.table.map((r) => (
                    <tr key={r.nation.id}>
                      <td>{r.rank}</td>
                      <td><span className="n">{nationLabel(r.nation)}</span><span className="k">{r.nation.athletes.map(localName).join(" · ")}</span></td>
                      <td><b>{r.gold}</b></td><td>{r.silver}</td><td>{r.bronze}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {champ && <p className="text-sm text-muted-foreground">{t.rich("champion", { name: localName(champ), b: (c) => <strong className="text-foreground">{c}</strong> })}</p>}
          </section>
          <section aria-labelledby="games-events" className="space-y-2">
            <h2 id="games-events" className="font-display text-lg font-bold uppercase tracking-wider">{t("everyEvent")}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {g.outcomes.map((o) => {
                const w = o.podium.gold.map((k) => { const a = GAMES_BY_KEY.get(k); return a ? localName(a) : undefined; }).join(", ");
                return <li key={o.event} className="rounded-md border bg-card/40 px-3 py-2 text-sm"><Link href={eventPath(o.event)} className="font-display font-semibold uppercase tracking-wide hover:text-primary">{te(`events.${o.event}.name`)}</Link><span className="ml-2 text-muted-foreground">{w}{o.event !== "wrestling" && o.podium.gold[0] ? ` · ${formatMark(o.event, o.marks.get(o.podium.gold[0]), lc)}` : ""}</span></li>;
              })}
            </ul>
          </section>
        </div>
      </GamesExperience>
      </ClientMessages>
      </GamesNames>
    </div>
  );
}

/** The event's group on the stadium's event board. */
const groupOf = (kind: string) => (kind === "sprint" ? "Track" : kind === "swim" ? "Pool" : kind === "lift" || kind === "wrestle" ? "Arena" : "Field");

/** /lab/games: the stadium entry and event board over the plain page (single events, the Games, the records and head to heads). */
export function GamesHub() {
  const t = serverT(gamesPages);
  const te = serverT(gamesEvents);
  const h2h = hubMatchups();
  const group = (g: "Track" | "Field" | "Pool" | "Arena") => t(`groups.${g}`);
  const groups = (["Track", "Field", "Pool", "Arena"] as const).map(group);
  const events = EVENTS.map((e) => ({ id: e.id, name: te(`events.${e.id}.name`), emoji: e.emoji, question: te(`events.${e.id}.question`), href: eventPath(e.id), group: group(groupOf(e.kind)) }));
  const records = EVENTS.map((e) => ({ label: t("recordsOf", { event: te(`events.${e.id}.name`) }), href: recordsPath(e.id) }));
  const pairs = h2h.map((x) => ({ label: h2hQuestion(x.event, localName(GAMES_BY_KEY.get(x.a)!), localName(GAMES_BY_KEY.get(x.b)!), te), href: eventRunPath(x.event, { keys: [x.a, x.b] }) }));
  return (
    <GamesNames>
    <ClientMessages namespaces={[gamesStadium, gamesH2h, gamesEvents]}>
    <GamesStadium events={events} groups={groups} playHref={PLAY_PATH} records={records} h2h={pairs} h2hPicker={<H2HPicker rivals={RIVALS} names={rivalNames()} />} backHref={LAB_PATH}>
    <div className="mx-auto max-w-5xl space-y-10" data-testid="games-hub">
      <ListHeader back={{ href: LAB_PATH, label: t("lab") }} kicker={t("hubKicker")} title={t("hubTitle")} accent={t("playAccent")} blurb={t("hubBlurb")} />
      <section aria-labelledby="hub-events" className="space-y-3">
        <h2 id="hub-events" className="font-display text-xl font-bold uppercase tracking-wider">{t("single")}</h2>
        <p className="text-sm text-muted-foreground">{t("singleBlurb")}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {EVENTS.map((e) => (
            <Link key={e.id} href={eventPath(e.id)} prefetch={false} className="group rounded-lg border bg-card/40 p-3 transition-colors hover:border-primary/50" data-testid={`hub-event-${e.id}`}>
              <span className="text-xl" aria-hidden>{e.emoji}</span>
              <span className="mt-1 block font-display text-sm font-bold uppercase tracking-wide group-hover:text-primary">{te(`events.${e.id}.name`)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{te(`events.${e.id}.question`)}</span>
            </Link>
          ))}
        </div>
      </section>
      <section aria-labelledby="hub-games" className="rounded-xl border bg-card/40 p-5">
        <h2 id="hub-games" className="font-display text-xl font-bold uppercase tracking-wider">{t("theGames")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("theGamesBlurb")}</p>
        <Link href={PLAY_PATH} className="rc-go mt-3 inline-flex h-11 items-center gap-2 rounded-lg px-5 font-display text-sm font-bold uppercase tracking-wider" data-testid="hub-play">{t("openGames")}</Link>
      </section>
      <section aria-labelledby="hub-records" className="space-y-3">
        <h2 id="hub-records" className="font-display text-xl font-bold uppercase tracking-wider">{t("records")}</h2>
        <p className="text-sm text-muted-foreground">{t("recordsBlurb")}</p>
        <ul className="flex flex-wrap gap-2">
          {EVENTS.map((e) => (
            <li key={e.id}><Link href={recordsPath(e.id)} prefetch={false} className="inline-flex rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">{t("recordsOf", { event: te(`events.${e.id}.name`) })}</Link></li>
          ))}
        </ul>
      </section>
      <H2HSection id="hub-h2h" title={t("h2h")} blurb={t("hubH2hBlurb")} ideas={h2h} />
      <section className="rounded-lg border bg-card/40 p-4 text-sm text-muted-foreground">
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-foreground">{t("rules")}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t("rule.0")}</li>
          <li>{t("rule.1")}</li>
          <li>{t("rule.2")}</li>
          <li>{t("rule.3")}</li>
        </ul>
      </section>
    </div>
    </GamesStadium>
    </ClientMessages>
    </GamesNames>
  );
}
