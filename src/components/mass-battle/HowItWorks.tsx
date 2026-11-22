import { CONTACT_REACH, MAX_SECONDS, RANGED_REACH, ROUND_TICKS, SPREAD_REACH, TICK_HZ } from "@/lib/mass-battle/constants";
import { SOLVER } from "@/lib/mass-battle/solver";
import { EV, IV } from "@/lib/mass-battle/stats";
import { localNum } from "@/lib/games/events";
import type { Translator } from "@/i18n/catalog";
import type mbHow from "@/messages/mass-battle-how";

/**
 * What the battle models and what it doesn't, stated plainly. Rendered on
 * the page (for everyone, and for search engines) and in the stage's
 * "How it works" panel.
 */

const ROUND_S = ROUND_TICKS / TICK_HZ;

/** The simulator check's summary (scripts/mass-battle-crosscheck.ts, 1,000 battles a row; rerun it after changing the rules). */
export const CROSSCHECK = {
  battles: 1000,
  matchups: 64,
  rows: 128,
  agree: 125,
  examples: [
    { label: "Breloom (Spore, Focus Punch) vs Wyrdeer, level 100", engine: 50.3, sim: 51.5 },
    { label: "Ferrothorn (Leech Seed, Protect) vs Iron Valiant, level 100", engine: 57.9, sim: 55.1 },
    { label: "Suicune (Calm Mind, Rest, Pressure) vs Lanturn, level 100", engine: 53.1, sim: 54.4 },
    { label: "2 Electrode (Explosion) vs Gliscor, level 100", engine: 45.5, sim: 46.9 },
    { label: "Gardevoir (Trace) vs Arcanine (Intimidate), level 100", engine: 73.4, sim: 72.6 },
    { label: "2 Garchomp (Earthquake hits the partner) vs Inteleon, level 100", engine: 64.8, sim: 68.2 },
    { label: "Venusaur (Solar Beam, two turns) vs Toedscruel, level 100", engine: 50.2, sim: 47.9 },
    { label: "6 Lucario vs 6 Bronzong (doubles), level 100", engine: 42.0, sim: 41.5 },
  ],
  note: "The other three (Okidogi vs Kingdra and Pelipper vs Hitmontop at level 100, six Lucario against six Bronzong at level 50) were played again with 3,000 fresh battles each, and agree.",
} as const;

export function HowItWorksBody({ t }: { t: Translator<typeof mbHow.en> }) {
  const item = "flex gap-2";
  const li = (k: string, children: React.ReactNode) => (
    <li key={k} className={item}><span aria-hidden>•</span><span>{children}</span></li>
  );
  const b = (c: React.ReactNode[]) => <b className="text-foreground">{c}</b>;
  const n = (v: number | string) => localNum(String(v), t.locale);
  const values = { b, ev: EV, iv: IV, round: n(ROUND_S), contact: n(CONTACT_REACH), ranged: n(RANGED_REACH), spreadReach: n(SPREAD_REACH), minutes: n(MAX_SECONDS / 60), runs: SOLVER.runs, ppNote: t("ppNote"), battles: localNum(CROSSCHECK.battles.toLocaleString("en-US"), t.locale), matchups: CROSSCHECK.matchups, agree: CROSSCHECK.agree, rows: CROSSCHECK.rows, note: t("note") };
  const r = (k: keyof typeof mbHow.en.items) => t.rich(`items.${k}`, values);
  return (
    <div className="space-y-5 text-sm leading-relaxed text-muted-foreground" data-testid="mb-how-body">
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">{t("h.maths")}</h3>
        <ul className="space-y-1.5">
          {li("damage", r("damage"))}
          {li("stats", r("stats"))}
          {li("sets", r("sets"))}
          {li("items", r("items"))}
          {li("turns", r("turns"))}
          {li("choice", r("choice"))}
          {li("hits", r("hits"))}
          {li("status", r("status"))}
          {li("special", r("special"))}
          {li("effects", r("effects"))}
          {li("entry", r("entry"))}
          {li("weatherpick", r("weatherpick"))}
          {li("abilities", r("abilities"))}
          {li("items-play", r("items_play"))}
          {li("field", r("field"))}
        </ul>
      </section>
      <section className="space-y-2" data-testid="mb-rules-how">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">{t("h.rules")}</h3>
        <ul className="space-y-1.5">
          {li("ff", r("ff"))}
          {li("pp", r("pp"))}
        </ul>
      </section>
      <section className="space-y-2" data-testid="mb-how-check">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">{t("h.check")}</h3>
        <p>
          {t.rich("check", values)}
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {CROSSCHECK.examples.map((e, i) => (
            <li key={e.label} className="rounded-md bg-foreground/[0.04] px-2.5 py-1.5 text-xs">
              <span className="block text-foreground">{t(`ex.${i as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`)}</span>
              <span className="tabular-nums">{t("exLine", { engine: n(e.engine.toFixed(1)), sim: n(e.sim.toFixed(1)) })}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">{t("h.field")}</h3>
        <ul className="space-y-1.5">
          {li("pos", r("pos"))}
          {li("reach", r("reach"))}
          {li("bodies", r("bodies"))}
          {li("end", r("end"))}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">{t("h.not")}</h3>
        <p>
          {t.rich("not", values)}
        </p>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">{t("h.howMany")}</h3>
        <p>
          {t.rich("howMany1", values)}
        </p>
        <p>
          {t.rich("howMany2", values)}
        </p>
      </section>
      <p className="text-xs">
          {t.rich("data", values)}
        </p>
    </div>
  );
}
