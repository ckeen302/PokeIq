import type { Athlete } from "@/lib/games/athlete";
import { HIGH_JUMP, JAVELIN, LIFT, LONG_JUMP, SHOT, SPRINT, SWIM, THROW, WRESTLE } from "@/lib/games/constants";
import { eventOf, type EventId } from "@/lib/games/events";
import { aquatic, swimSpe } from "@/lib/games/swim";

/**
 * "How it works" for each event: the formula, the inputs it reads (only
 * real data: base stats, height, weight, types, abilities, body shape and
 * egg groups), and what's modelled and what isn't. The same words on the
 * page, in the 3D view's panel and on the records pages.
 */

interface Section {
  formula: string[];
  inputs: string;
  modelled: string[];
  not: string[];
}

const COMMON_NOT = "The numbers that turn stats into strength, speed and spring are ours, anchored so a 70 kg athlete with base 100 lands an elite human mark; every constant and its source is in the open in lib/games/constants.ts.";

export const INFO: Record<EventId, Section> = {
  "100m": sprint(100),
  "200m": sprint(200),
  "400m": sprint(400),
  "long-jump": {
    formula: [
      `Run-up: the Pokémon Race's sprint model over ${LONG_JUMP.runUp} m, × ${LONG_JUMP.boardKeep} at the board (jumpers lose about 5% planting).`,
      `Take-off: vertical speed ${LONG_JUMP.vVertical} m/s × √(Attack/100) × (kg/70)^(−1/6) for bodies over 70 kg (heavy bodies get less spring per kg; lighter ones get no extra, Borelli's law).`,
      `Flight: a projectile from the centre of mass at take-off (${LONG_JUMP.comTakeoff} × height) to touchdown (${LONG_JUMP.comLanding} × height), plus a take-off and a landing distance of ${LONG_JUMP.takeoffShare} × height each.`,
      "The board: the toe lands behind the line by a seeded amount (more scatter the faster and bigger you are); over it is a foul, about one jump in ten. Measured from the line, to the centimetre below.",
    ],
    inputs: "Speed, Attack, HP (stamina), weight, height and body shape.",
    modelled: ["The run-up's acceleration", "Projectile flight under g = 9.81", "Fouls and the distance lost behind the board", "Three attempts, best counts, ties on the second best", "Fliers and Levitate jump too: gliding isn't allowed, so the same physics"],
    not: ["Air drag (about 1% on a jump)", "Wind"],
  },
  "high-jump": {
    formula: [
      `Clearance = centre of mass at take-off (${HIGH_JUMP.com} × height) + rise v²/2g + technique.`,
      `v = ${HIGH_JUMP.vVertical} m/s × √(Attack/100) × (kg/70)^(−1/6) over 70 kg.`,
      `Technique: a Fosbury flop for bipeds (+${HIGH_JUMP.bipedBonus} m: the bar can pass above the centre of mass); four legs or a serpent's body ${HIGH_JUMP.quadPenalty} m.`,
      "The bar rises 5 cm at a time, then 3 cm when three or fewer are left; three failures in a row and you're out; ties by countback (failures at the last height, then in all), a jump-off for first.",
    ],
    inputs: "Attack, weight, height and body shape.",
    modelled: ["Tall Pokémon start high: their centre of mass is already metres up", "Each attempt's day-to-day form", "World Athletics' high jump rules and countback"],
    not: ["The approach's curve and speed (they don't change the result here)"],
  },
  "shot-put": {
    formula: [
      `Release speed ${SHOT.vRef} m/s × √(Attack/100) × (kg/70)^(1/6): big bodies get a little extra from leverage.`,
      `Capped by the shot's mass (${SHOT.mass} kg): Hill's force–velocity relation slows a muscle as the load nears its strength (its best clean & jerk), and no limb swings an implement faster than ${THROW.vCap} m/s.`,
      `Released at ${SHOT.angle}° from ${SHOT.releaseShare} × height (at most ${SHOT.releaseCap} m), with air drag on a ${SHOT.diameter * 100} cm sphere.`,
      `No arms (body shape): a head or tail flick at ${THROW.noArms * 100}% of the speed.`,
    ],
    inputs: "Attack, Defence (through the lift), weight, height and body shape.",
    modelled: ["Projectile with drag, integrated in 1/600 s steps", "Too weak to lift the shot: no mark", "Three throws, best counts"],
    not: ["Spin vs glide technique", "Fouls in the circle"],
  },
  javelin: {
    formula: [
      `Release speed = ${JAVELIN.runKeep} × the race model's speed after a ${JAVELIN.runUp} m run-up + arm speed ${JAVELIN.armRef} m/s × √(Attack/100) × (kg/70)^(1/6), under the same caps as the shot.`,
      `Flight: drag and lift on an ${JAVELIN.mass * 1000} g javelin (Hubbard & Rust, 1984), released at ${JAVELIN.angle}° from ${JAVELIN.releaseShare} × height.`,
      `No arms: ${THROW.noArms * 100}% of the speed.`,
    ],
    inputs: "Speed, Attack, weight, height and body shape.",
    modelled: ["Aerodynamic lift and drag", "The run-up's speed", "The limb-speed cap: strong throwers bunch near it, height decides"],
    not: ["The javelin's pitching (it flies nose along its path)", "Wind"],
  },
  weightlifting: {
    formula: [
      `Best lift = ${LIFT.ref} kg × (kg/70)^(2/3) × (Attack/100) × (Defence/100)^${LIFT.defExp}: muscle force grows with mass^(2/3), the allometric rule behind the Sinclair coefficients.`,
      `Three attempts in the IWF's rising-bar order: open at ${LIFT.opening * 100}%, then about ${LIFT.second * 100}%, then ${LIFT.third * 100}%; a miss repeats the weight.`,
      `Each lift succeeds with a chance that falls quickly above the day's best (a logistic ${LIFT.width * 100}% wide).`,
      "Real plates in 1 kg steps (IWF colours) on a 20 kg bar with 2.5 kg collars; lighter bars for light lifts.",
    ],
    inputs: "Attack, Defence and weight.",
    modelled: ["A heavy Pokémon is strong but not proportionally stronger", "Pound for pound (lift ÷ bodyweight) as its own award"],
    not: ["The snatch", "Technique faults"],
  },
  "50m-freestyle": swim(50),
  "100m-freestyle": swim(100),
  wrestling: {
    formula: [
      `Push = ${WRESTLE.push} N × kg^(2/3) × Attack/100; brace = ${WRESTLE.brace} N × kg^(2/3) × Defence/100 + ${WRESTLE.friction} × its weight in friction.`,
      "The bout: both charge (momentum from Speed and mass), lock up, and whoever's push beats the other's brace drives the pair back; seeded surges swing it; stamina comes from HP.",
      `Out of the ring (a sumo dohyō, ${WRESTLE.ring} m across, or bigger for a giant) loses; after ${WRESTLE.maxTime} s, the one pushed further back does.`,
    ],
    inputs: "Attack, Defence, Speed, HP and weight.",
    modelled: ["A knockout bracket seeded by push + brace", "A bronze bout"],
    not: ["Moves, throws or battle damage (that's Mass Battle): pure strength and mass"],
  },
  "all-around": {
    formula: [
      "Points per event from World Athletics' combined-events formula: A·(B − T)^C for times, A·(M − B)^C for marks.",
      "The real decathlon constants for the 100 m, 400 m, long jump, high jump, shot put and javelin; ours, of the same form, for the 200 m, the lift and the swims (1,000 points at an elite mark).",
      "The best all-rounder is the Champion of the Games.",
    ],
    inputs: "Every event's mark.",
    modelled: ["Ten events with marks (wrestling is head to head)"],
    not: ["Event order or fatigue across events"],
  },
};

function sprint(d: number): Section {
  return {
    formula: [
      "The Pokémon Race's model, unchanged: top speed = base Speed ÷ 10 m/s, a Furusawa–Hill sprint start (τ from weight and Attack), a fade after 150 m from HP, integrated with RK4.",
      `Reaction to the gun: ${SPRINT.reactionFast}–${SPRINT.reactionSlow} s from Speed, seeded; under ${SPRINT.falseStart.toFixed(3)} s is a false start and a disqualification (World Athletics TR 16).`,
      `A dip at the line: an upright sprinter's torso crosses ${SPRINT.dip} × its height ahead of its hips.`,
      "Times to 1/100 s rounded up; a tie split by the photo finish at 1/1000 s.",
    ],
    inputs: d === 100 ? "Speed, Attack and weight." : "Speed, Attack, HP and weight.",
    modelled: [d === 100 ? "Heats and a final in the Games (the Race's knockout)" : "Staggered starts round the bend", "Day-to-day form within ±1.5%"],
    not: ["Wind", "Lane draw effects"],
  };
}

function swim(d: number): Section {
  return {
    formula: [
      `Water speed = ${SWIM.vRef} m/s × (Speed/100)^${SWIM.speedExp} × an aquatic factor.`,
      `Aquatic factor: Water types and the Water 1/2/3 egg groups ${SWIM.water}; Fire, Rock and Ground types ${SWIM.sinkers} (they sink or hate water); everyone else ${SWIM.other}; a fish- or fin-shaped body × ${SWIM.fin}.`,
      `Swift Swim doubles Speed (its real effect), only with the rain on.`,
      `The start: a reaction, a dive (speed from Attack), a glide; stamina fades after ${SWIM.fadeOnset} m from HP${d === 100 ? "; a flip turn at 50 m and a push-off from Attack" : ""}.`,
    ],
    inputs: "Speed, Attack, HP, weight, length, types, egg groups, Swift Swim and body shape.",
    modelled: ["A 50 m pool, eight lanes", "Big bodies reach further at the start and the turn"],
    not: ["Strokes other than freestyle", "Drafting off a neighbour"],
  };
}

export function GamesInfo({ event, compact = false, athletes = [], rain = false }: { event: EventId; compact?: boolean; athletes?: Athlete[]; rain?: boolean }) {
  const s = INFO[event];
  const e = eventOf(event);
  return (
    <div className={compact ? "space-y-3 text-sm" : "space-y-4 text-sm text-muted-foreground"}>
      <div>
        <h3 className={compact ? "font-display text-xs font-bold uppercase tracking-wider text-[#ffd84a]" : "font-display text-sm font-bold uppercase tracking-wider text-foreground"}>The formula</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {s.formula.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </div>
      <p><span className={compact ? "text-white" : "text-foreground"}>Inputs:</span> {s.inputs}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className={compact ? "font-display text-xs font-bold uppercase tracking-wider text-[#9fd8ff]" : "font-display text-sm font-bold uppercase tracking-wider text-foreground"}>Modelled</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">{s.modelled.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <h3 className={compact ? "font-display text-xs font-bold uppercase tracking-wider text-[#9fd8ff]" : "font-display text-sm font-bold uppercase tracking-wider text-foreground"}>Not modelled</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">{s.not.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
      {e.kind === "swim" && athletes.length > 0 && (
        <div>
          <h3 className={compact ? "font-display text-xs font-bold uppercase tracking-wider text-[#ffd84a]" : "font-display text-sm font-bold uppercase tracking-wider text-foreground"}>This field&apos;s aquatic factors</h3>
          <ul className="mt-1 space-y-0.5">
            {athletes.map((a) => {
              const q = aquatic(a);
              const ss = swimSpe(a, rain) !== a.stats.spe;
              return <li key={a.key}><span className={compact ? "text-white" : "text-foreground"}>{a.name}</span>: {q.parts.map((p) => `${p.label} (${p.k})`).join(" × ")}{ss ? " · Swift Swim in rain: Speed ×2" : ""} = {q.factor.toFixed(2)}</li>;
            })}
          </ul>
        </div>
      )}
      <p className="text-xs opacity-75">{COMMON_NOT}</p>
    </div>
  );
}
