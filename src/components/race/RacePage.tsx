import Link from "next/link";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { RACE_ENTRANTS } from "@/lib/race/data";
import { DEFAULT_PRESET, PRESETS, type RacePreset } from "@/lib/race/presets";
import { fieldFor, specFor } from "@/lib/race/lineup";
import { displayTimes, formatGap, formatTime, kmh, makeRace } from "@/lib/race/race";
import { motionAt } from "@/lib/race/model";
import { MOTION_LABEL } from "@/lib/race/gait";
import { HUB_PRESET, presetPath, vsPath } from "@/lib/race/deeplink";
import { GAMES_LIVE, LAB_PATH } from "@/lib/lab";
import { KIND_LABEL, type Entrant } from "@/lib/race/types";
import type { Distance } from "@/lib/race/track";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { BackButton } from "@/components/ui/BackButton";
import { RaceExperience } from "./RaceExperience";
import { RaceInfo } from "./RaceInfo";
import { RACE_CSS } from "./race-css";
import { cn } from "@/lib/utils";

const dexSlug = (e: Entrant) => getPokemon(e.species)?.slug ?? e.key;

/**
 * /pokedex/race, a preset's page and a shared race: the 3D broadcast over
 * the server-rendered results (what search engines, reduced motion and
 * browsers without WebGL get): the finishing order with times, gaps and
 * base Speed, where everyone was when the winner crossed, and how the
 * model works.
 */
export function RacePage({ preset = DEFAULT_PRESET, vs, distance, seed }: { preset?: RacePreset; vs?: Entrant[]; distance?: Distance | null; seed?: number | null }) {
  const spec = specFor(preset.id, vs?.map((e) => e.key) ?? [], distance, seed);
  const field = fieldFor(spec, RACE_ENTRANTS);
  const race = makeRace(field.entrants, spec.distance);
  const times = displayTimes(race);
  const custom = (vs?.length ?? 0) > 0;
  const winner = race.order[0];
  const path = custom ? vsPath(spec.vs, spec.distance) : presetPath(preset.id);
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${field.title}: ${spec.distance} m results`,
    url: `${SITE_URL}${path}`,
    numberOfItems: race.order.length,
    itemListElement: race.order.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: `${r.entrant.name} (${formatTime(r.time)} s)`, url: `${SITE_URL}/pokemon/${dexSlug(r.entrant)}` })),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <style>{RACE_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <RaceExperience preset={preset.id} vs={spec.vs} distance={distance ?? null} seed={seed ?? null}>
        <div className="space-y-6">
          {custom ? (
            <div className="space-y-3 text-center">
              <div className="text-left"><BackButton href="/pokedex/race" label="Pokémon Race" /></div>
              <p className="hud-label text-screen">Pokémon race · {spec.distance} m</p>
              <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{field.title}</h1>
              <p className="text-muted-foreground">{winner.entrant.name} wins in {formatTime(winner.time)} s, based on their stats.</p>
            </div>
          ) : preset.id === HUB_PRESET ? (
            <ListHeader
              back={{ href: LAB_PATH, label: "3D Lab" }}
              kicker="Pokémon race · 3D"
              title="Pokémon "
              accent="Race"
              blurb="Who is the fastest Pokémon? Watch them race 100, 200 or 400 m under the floodlights of a 3D stadium, with speeds from their stats and a sprint model from sports science. Pick any of them, share the race or make a video."
            />
          ) : (
            <ListHeader back={{ href: "/pokedex/race", label: "Pokémon Race" }} kicker={`Pokémon race · ${spec.distance} m`} title={`${preset.label} `} accent="race" blurb={preset.blurb} />
          )}
          <nav aria-label="Races" className="flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => (
              <Link key={p.id} href={presetPath(p.id)} prefetch={false} className={cn("tap rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors", !custom && p.id === preset.id ? "border-primary/60 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {p.label}
              </Link>
            ))}
          </nav>

          {field.tournament && (
            <section className="rounded-lg border bg-card/40 p-4 text-sm" aria-labelledby="race-ko">
              <h2 id="race-ko" className="font-display text-base font-bold uppercase tracking-wider">The knockout</h2>
              <p className="mt-1 text-muted-foreground">
                Every Pokémon is drawn into heats of eight. Each round keeps about a quarter: the first places of each heat (Q) and the fastest losers (q).
                Champion: <strong className="text-foreground">{getPokemon(race.order[0].entrant.species)?.name ?? race.order[0].entrant.name}</strong>.
              </p>
              <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {field.tournament.rounds.map((r) => (
                  <li key={r.name}><span className="text-foreground">{r.name}</span>: {r.heats.length === 1 ? "one race" : r.byPlace ? `${r.byPlace === 1 ? "each heat's winner" : `the first ${r.byPlace} of each heat`}${r.byTime ? ` and the ${r.byTime} fastest losers` : ""} go through` : "heats"}</li>
                ))}
              </ol>
            </section>
          )}

          <section aria-labelledby="race-results" className="space-y-3">
            <h2 id="race-results" className="font-display text-lg font-bold uppercase tracking-wider">{field.tournament ? "The final" : "Results"} · {spec.distance} m</h2>
            <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4" data-testid="race-list">
              <table className="rct" aria-label={`${field.title}: ${spec.distance} m results`}>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Pokémon</th>
                    <th scope="col">Time</th>
                    <th scope="col" className="rct-x">Gap</th>
                    <th scope="col">Speed</th>
                    <th scope="col" className="rct-x">Top speed</th>
                  </tr>
                </thead>
                <tbody>
                  {race.order.map((r) => (
                    <tr key={r.lane} id={`race-${r.entrant.key}`}>
                      <td>{r.place}</td>
                      <td>
                        <Link href={`/pokemon/${dexSlug(r.entrant)}`} prefetch={false} className="n">{r.entrant.name}</Link>
                        {r.entrant.kind !== "pokemon" && <span className="k">{KIND_LABEL[r.entrant.kind]}</span>}
                        <span className="k">{MOTION_LABEL[r.entrant.motion]} · lane {r.lane}</span>
                      </td>
                      <td><b>{times.get(r)}</b></td>
                      <td className="rct-x g">{formatGap(r.gap)}</td>
                      <td>{r.entrant.stats.spe}</td>
                      <td className="rct-x g">{kmh(r.runner.vmax).toFixed(0)} km/h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {race.order.length > 1 && (
              <div className="rounded-lg border bg-card/40 p-4" aria-label="Where everyone was as the winner crossed the line">
                <h3 className="font-display text-sm font-bold uppercase tracking-wider">As {winner.entrant.name} crossed the line</h3>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {race.order.map((r) => {
                    const x = Math.min(race.distance, motionAt(r.profile, race.first).x);
                    const behind = race.distance - x;
                    return (
                      <li key={r.lane} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2">
                        <span className="truncate">{r.entrant.name}</span>
                        <span className="h-2 rounded-full bg-foreground/10"><span className="rc-bar block" style={{ width: `${Math.max(1, (x / race.distance) * 100).toFixed(1)}%` }} /></span>
                        <span className="tabular-nums text-muted-foreground">{behind < 0.005 ? "won" : `${behind < 10 ? behind.toFixed(2) : behind.toFixed(1)} m back`}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          <section aria-labelledby="race-how" className="rounded-lg border bg-card/40 p-4">
            <h2 id="race-how" className="mb-2 font-display text-lg font-bold uppercase tracking-wider">How the race works</h2>
            <RaceInfo />
          </section>
          {GAMES_LIVE && (
            <section aria-labelledby="race-games" className="rounded-lg border bg-card/40 p-4 text-sm" data-testid="race-games">
              <h2 id="race-games" className="font-display text-lg font-bold uppercase tracking-wider">More than sprints: the PokéIQ Games</h2>
              <p className="mt-1 text-muted-foreground">The same runners in the 100, 200 and 400 m, plus the long jump, high jump, shot put, javelin, weightlifting, swimming and wrestling, with medals and a medal table.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/lab/games" prefetch={false} className="rc-go inline-flex h-10 items-center rounded-lg px-4 font-display text-xs font-bold uppercase tracking-wider">Open the Games</Link>
                <Link href="/lab/games/records/100m" prefetch={false} className="inline-flex h-10 items-center rounded-lg border px-4 font-display text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">100 m records</Link>
              </div>
            </section>
          )}
        </div>
      </RaceExperience>
    </div>
  );
}
