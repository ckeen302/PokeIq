import Link from "@/components/ui/PlainLink";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { DEFAULT_PRESET, PRESETS, type RacePreset } from "@/lib/race/presets";
import { fieldFor, specFor } from "@/lib/race/lineup";
import { displayTimes, formatGap, formatTime, kmh, makeRace } from "@/lib/race/race";
import { motionAt } from "@/lib/race/model";
import { HUB_PRESET, presetPath, vsPath } from "@/lib/race/deeplink";
import { GAMES_LIVE, LAB_PATH } from "@/lib/lab";
import type { Entrant } from "@/lib/race/types";
import type { Distance } from "@/lib/race/track";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { BackButton } from "@/components/ui/BackButton";
import { RaceExperience } from "./RaceExperience";
import { raceInfoText } from "./RaceInfo";
import { RACE_CSS } from "./race-css";
import { cn } from "@/lib/utils";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import racePages from "@/messages/race-pages";
import raceNs from "@/messages/race";
import raceInfo from "@/messages/race-info";
import { pageEntrants, pageRaceLocal } from "./local";
import { fieldText, presetLabel, roundName } from "./words";

const dexSlug = (e: Entrant) => getPokemon(e.species)?.slug ?? e.key;

/**
 * /pokedex/race, a preset's page and a shared race: the 3D broadcast over
 * the server-rendered results (what search engines, reduced motion and
 * browsers without WebGL get): the finishing order with times, gaps and
 * base Speed, where everyone was when the winner crossed, and how the
 * model works.
 */
export function RacePage({ preset = DEFAULT_PRESET, vs, distance, seed }: { preset?: RacePreset; vs?: Entrant[]; distance?: Distance | null; seed?: number | null }) {
  const t = serverT(racePages);
  const rt = serverT(raceNs);
  // In another language every runner carries its name there (English pages: the data's own list).
  const RACE_ENTRANTS = pageEntrants();
  const local = pageRaceLocal();
  const spec = specFor(preset.id, vs?.map((e) => e.key) ?? [], distance, seed);
  const field0 = fieldFor(spec, RACE_ENTRANTS);
  const field = { ...field0, ...fieldText(spec, field0.entrants, rt) };
  const race = makeRace(field.entrants, spec.distance);
  const times = displayTimes(race);
  const custom = (vs?.length ?? 0) > 0;
  const winner = race.order[0];
  const path = custom ? vsPath(spec.vs, spec.distance) : presetPath(preset.id);
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t("results.aria", { title: field.title, d: spec.distance }),
    url: `${SITE_URL}${path}`,
    numberOfItems: race.order.length,
    itemListElement: race.order.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: t("results.item", { name: r.entrant.name, time: formatTime(r.time) }), url: `${SITE_URL}/pokemon/${dexSlug(r.entrant)}` })),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <style>{RACE_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <ClientMessages namespaces={[raceNs, raceInfo]}>
      <RaceExperience preset={preset.id} vs={spec.vs} distance={distance ?? null} seed={seed ?? null} {...(local && { local })}>
        <div className="space-y-6">
          {custom ? (
            <div className="space-y-3 text-center">
              <div className="text-left"><BackButton href="/pokedex/race" label={t("page.back")} /></div>
              <p className="hud-label text-screen">{t("page.customKicker", { d: spec.distance })}</p>
              <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{field.title}</h1>
              <p className="text-muted-foreground">{t("page.wins", { name: winner.entrant.name, time: formatTime(winner.time) })}</p>
            </div>
          ) : preset.id === HUB_PRESET ? (
            <ListHeader
              back={{ href: LAB_PATH, label: t("page.lab") }}
              kicker={t("page.hubKicker")}
              title={t("page.hubTitle")}
              accent={t("page.hubAccent")}
              blurb={t("page.hubBlurb")}
            />
          ) : (
            <ListHeader back={{ href: "/pokedex/race", label: t("page.back") }} kicker={t("page.presetKicker", { d: spec.distance })} title={t("page.presetTitle", { label: presetLabel(preset.id, rt) })} accent={t("page.presetAccent")} blurb={t(`blurbs.${preset.id as keyof typeof racePages.en.blurbs}`)} />
          )}
          <nav aria-label={t("page.races")} className="flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => (
              <Link key={p.id} href={presetPath(p.id)} prefetch={false} className={cn("tap rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors", !custom && p.id === preset.id ? "border-primary/60 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {presetLabel(p.id, rt)}
              </Link>
            ))}
          </nav>

          {field.tournament && (
            <section className="rounded-lg border bg-card/40 p-4 text-sm" aria-labelledby="race-ko">
              <h2 id="race-ko" className="font-display text-base font-bold uppercase tracking-wider">{t("ko.title")}</h2>
              <p className="mt-1 text-muted-foreground">
                {t.rich("ko.body", { name: local ? race.order[0].entrant.name : getPokemon(race.order[0].entrant.species)?.name ?? race.order[0].entrant.name, b: (c) => <strong className="text-foreground">{c}</strong> })}
              </p>
              <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {field.tournament.rounds.map((r) => (
                  <li key={r.name}><span className="text-foreground">{roundName(r.name, rt)}</span>: {r.heats.length === 1 ? t("ko.one") : r.byPlace ? t("ko.through", { who: r.byPlace === 1 ? t("ko.winner") : t("ko.first", { n: r.byPlace }), losers: r.byTime ? t("ko.losers", { n: r.byTime }) : "" }) : t("ko.heats")}</li>
                ))}
              </ol>
            </section>
          )}

          <section aria-labelledby="race-results" className="space-y-3">
            <h2 id="race-results" className="font-display text-lg font-bold uppercase tracking-wider">{t(field.tournament ? "results.final" : "results.title", { d: spec.distance })}</h2>
            <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4" data-testid="race-list">
              <table className="rct" aria-label={t("results.aria", { title: field.title, d: spec.distance })}>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t("results.pokemon")}</th>
                    <th scope="col">{t("results.time")}</th>
                    <th scope="col" className="rct-x">{t("results.gap")}</th>
                    <th scope="col">{t("results.speed")}</th>
                    <th scope="col" className="rct-x">{t("results.top")}</th>
                  </tr>
                </thead>
                <tbody>
                  {race.order.map((r) => (
                    <tr key={r.lane} id={`race-${r.entrant.key}`}>
                      <td>{r.place}</td>
                      <td>
                        <Link href={`/pokemon/${dexSlug(r.entrant)}`} prefetch={false} className="n">{r.entrant.name}</Link>
                        {r.entrant.kind !== "pokemon" && <span className="k">{t(`kind.${r.entrant.kind}`)}</span>}
                        <span className="k">{t("results.lane", { motion: t(`motion.${r.entrant.motion}`), n: r.lane })}</span>
                      </td>
                      <td><b>{times.get(r)}</b></td>
                      <td className="rct-x g">{formatGap(r.gap)}</td>
                      <td>{r.entrant.stats.spe}</td>
                      <td className="rct-x g">{t("results.kmh", { v: kmh(r.runner.vmax).toFixed(0) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {race.order.length > 1 && (
              <div className="rounded-lg border bg-card/40 p-4" aria-label={t("results.crossedAria")}>
                <h3 className="font-display text-sm font-bold uppercase tracking-wider">{t("results.crossed", { name: winner.entrant.name })}</h3>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {race.order.map((r) => {
                    const x = Math.min(race.distance, motionAt(r.profile, race.first).x);
                    const behind = race.distance - x;
                    return (
                      <li key={r.lane} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2">
                        <span className="truncate">{r.entrant.name}</span>
                        <span className="h-2 rounded-full bg-foreground/10"><span className="rc-bar block" style={{ width: `${Math.max(1, (x / race.distance) * 100).toFixed(1)}%` }} /></span>
                        <span className="tabular-nums text-muted-foreground">{behind < 0.005 ? t("results.won") : t("results.back", { m: behind < 10 ? behind.toFixed(2) : behind.toFixed(1) })}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          <section aria-labelledby="race-how" className="rounded-lg border bg-card/40 p-4">
            <h2 id="race-how" className="mb-2 font-display text-lg font-bold uppercase tracking-wider">{t("how")}</h2>
            {raceInfoText(serverT(raceInfo))}
          </section>
          {GAMES_LIVE && (
            <section aria-labelledby="race-games" className="rounded-lg border bg-card/40 p-4 text-sm" data-testid="race-games">
              <h2 id="race-games" className="font-display text-lg font-bold uppercase tracking-wider">{t("games.title")}</h2>
              <p className="mt-1 text-muted-foreground">{t("games.body")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/lab/games" prefetch={false} className="rc-go inline-flex h-10 items-center rounded-lg px-4 font-display text-xs font-bold uppercase tracking-wider">{t("games.open")}</Link>
                <Link href="/lab/games/records/100m" prefetch={false} className="inline-flex h-10 items-center rounded-lg border px-4 font-display text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">{t("games.records")}</Link>
              </div>
            </section>
          )}
        </div>
      </RaceExperience>
      </ClientMessages>
    </div>
  );
}
