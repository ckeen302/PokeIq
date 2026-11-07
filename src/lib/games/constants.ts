import { G as RACE_G } from "@/lib/race/model";

/**
 * The PokéIQ Games: every constant the events use, in one place, each with
 * where it comes from. Pure and client-safe.
 *
 * Pokémon have no real-world athletic marks, so every event maps game
 * stats to physical ability. The mapping is ours and stated openly: it is
 * anchored so a 70 kg reference athlete with base 100 in the stat that
 * matters lands an elite human mark (the same convention as the Pokémon
 * Race, where base 100 Speed is a 10 m/s top speed). The physics after
 * that is real: projectiles under g = 9.81 m/s², air drag where it
 * changes the result, force–velocity limits, the real rules of each sport.
 *
 * Muscle force scales with mass^(2/3) (a muscle's force goes with its
 * cross-section, which grows as length², while mass grows as length³):
 * the allometric rule behind the Sinclair coefficients that compare
 * weightlifters across bodyweight classes. That is why a 950 kg Groudon is
 * strong, but not 14 times stronger than a 70 kg athlete.
 *
 * A constant that was changed from the design so a result reads right is
 * marked "changed:" with the reason. Results are never edited by hand.
 */

/** Standard gravity (m/s²), the Race model's. */
export const G = RACE_G;
/** Air at 20 °C and sea level (kg/m³). */
export const AIR_DENSITY = 1.204;

/** The reference athlete every anchor is set on: 70 kg, 1.8 m, base 100 in every stat. */
export const REF = { kg: 70, height: 1.8, stat: 100 } as const;

/**
 * Day-to-day form: each attempt (a run, a jump, a throw, a lift, a swim, a
 * shove) is scaled by a seeded factor within ±1.5%, bell-shaped (the sum
 * of three uniform draws), like an athlete's spread of results across a
 * season (elite sprinters vary by about ±1% race to race). Stats still
 * decide nearly every result, and the seed makes a share link replay
 * exactly.
 */
export const FORM = { spread: 0.015 } as const;

/** Allometric strength: force ∝ mass^(2/3) (Sinclair-style). */
export const STRENGTH_EXP = 2 / 3;

/** Spring per kg for take-offs (jumps, dives, push-offs): (kg/70)^(−1/6) for bodies heavier than the reference, 1 below it (Borelli's law). */
export const spring = (kg: number) => Math.min(1, Math.pow(Math.max(0.01, kg) / REF.kg, -1 / 6));

// ---------------------------------------------------------------------------
// Running: 100 m, 200 m and 400 m (the Race model, unchanged: lib/race/model)
// ---------------------------------------------------------------------------

export const SPRINT = {
  /** Reaction to the gun: from 0.20 s (base Speed near 0) to 0.12 s (very high Speed). Elite sprinters react in about 0.13–0.17 s (World Athletics biomechanics reports, 2009–2017 finals). */
  reactionSlow: 0.2,
  reactionFast: 0.12,
  /** How quickly the reaction improves with Speed: 0.12 + 0.08·e^(−Speed/60). Base 100 reacts in 0.135 s. */
  reactionScale: 60,
  /** Day-to-day spread of a reaction (s): a bell curve within ±2.5σ. */
  reactionSpread: 0.009,
  /** World Athletics TR 16.6: a reaction under 0.100 s after the gun is a false start, and the athlete is disqualified (TR 16.8). */
  falseStart: 0.1,
  /** The dip at the line: the torso crosses this share of the runner's height ahead of its hips (upright sprinters only). A good dip gains about 0.01–0.03 s. */
  dip: 0.12,
} as const;

/** World Athletics TR 19.24: hand-held and fully automatic times are read to 1/100 s, rounded up; the photo-finish image reads 1/1000 s to separate a tie. */
export const TIMING = { official: 0.01, photo: 0.001 } as const;

// ---------------------------------------------------------------------------
// Long jump
// ---------------------------------------------------------------------------

export const LONG_JUMP = {
  /** Run-up length (m): elite run-ups are about 35–45 m (18–22 strides). */
  runUp: 40,
  /** Share of the run-up speed kept at take-off: jumpers lose about 5% planting at the board. */
  boardKeep: 0.95,
  /** Vertical take-off speed of the reference (m/s): measured elite values are 3.2–3.5 m/s (Lees, Graham-Smith & Fowler, J. Appl. Biomech. 1994). */
  vVertical: 3.3,
  /**
   * Heavy bodies get less spring per kg: v_v ∝ (kg/70)^(−1/6).
   * changed: for bodies heavier than the reference only. Below 70 kg the
   * take-off speed doesn't grow (Borelli's law: animals of every size jump
   * about as high; a cat takes off at about 5 m/s), or a 0.1 kg Kartana
   * would clear 18 m.
   */
  massExp: -1 / 6,
  /** Centre of mass at take-off, share of height. */
  comTakeoff: 0.55,
  /**
   * changed: the centre of mass at touchdown, share of height (0.22: about
   * 0.4 m for a 1.8 m jumper, hips low, legs out in front; Hay, "The
   * biomechanics of the long jump", 1986). The design's flight to the
   * ground overshoots its own 8.4 m anchor by 0.7 m.
   */
  comLanding: 0.22,
  /** The take-off distance (toe to centre of mass) and the landing distance (centre of mass to heels), each a share of height. */
  takeoffShare: 0.2,
  landingShare: 0.2,
  /**
   * The board: where the toe lands behind the foul line (m), aimed
   * 1.28 σ behind it so the reference fouls one jump in ten; σ grows with
   * take-off speed (faster is less accurate) and with body size. A legal
   * jump is measured from the line, so the distance behind it is lost.
   */
  boardSigma: 0.07,
  boardAim: 1.2816,
  attempts: 3,
  /** The elite mark the reference is anchored on (m). */
  anchor: 8.4,
} as const;

// ---------------------------------------------------------------------------
// High jump
// ---------------------------------------------------------------------------

export const HIGH_JUMP = {
  /**
   * changed: vertical take-off speed of the reference (m/s). The design's
   * 4.4 m/s clears 2.23 m with its own centre-of-mass and technique terms,
   * short of its 2.35 m anchor; 4.65 m/s clears it. Measured elite values
   * are 4.4–4.8 m/s (Dapena's analyses of US national meets, 1980s–2000s).
   */
  vVertical: 4.65,
  /** As the long jump: less spring per kg for bodies heavier than 70 kg, none extra below it. */
  massExp: -1 / 6,
  /** Centre of mass at take-off, share of standing height. */
  com: 0.55,
  /** Technique (m): a Fosbury flop clears a bar above its centre of mass's peak; four legs or a serpent's body can't arch over it. */
  bipedBonus: 0.2,
  quadPenalty: -0.2,
  /** The bar: 5 cm steps, then 3 cm once three or fewer athletes are left (World Athletics TR 26.4: never less than 2 cm). */
  stepBig: 0.05,
  stepSmall: 0.03,
  /** Athletes open about 7% under their best, on the 5 cm grid. */
  opening: 0.93,
  /** Bar wobble: a clearance within this margin (m) brushes the bar; a failure within it knocks the bar off after a wobble. */
  brush: 0.015,
  anchor: 2.35,
  anchorHeight: 1.9,
} as const;

// ---------------------------------------------------------------------------
// Throws
// ---------------------------------------------------------------------------

/** The shot (World Athletics TR 32.11): 7.26 kg, 110–130 mm. Throws from a 2.135 m circle into a 34.92° sector. */
export const SHOT = {
  mass: 7.26,
  diameter: 0.12,
  circle: 2.135,
  sector: 34.92,
  /** Drag coefficient of a sphere at these speeds (Re ≈ 10⁵). */
  cd: 0.47,
  /**
   * changed: release speed of the reference (m/s). The design's 13.7 m/s
   * puts 21.1 m, short of its 22 m anchor; 14.1 m/s reaches it. Elite
   * release speeds are 13.5–14.5 m/s (Linthorne, "Optimum release angle in
   * the shot put", J. Sports Sci. 2001).
   */
  vRef: 14.1,
  /** Big bodies get a little extra speed from leverage: v ∝ (kg/70)^(1/6). */
  massExp: 1 / 6,
  /** Release angle (°): elite putters release at 35–38° (Linthorne 2001). */
  angle: 37,
  /** Release height, share of height, capped so giants still land in the sector (m). */
  releaseShare: 1.15,
  releaseCap: 30,
  /** The hand is this share of height beyond the stop board at release. */
  reachShare: 0.15,
  anchor: 22,
} as const;

/** The javelin (World Athletics TR 32.13): 800 g, 2.6–2.7 m. Thrown from behind an 8 m arc into a 28.96° sector. */
export const JAVELIN = {
  mass: 0.8,
  length: 2.65,
  arcRadius: 8,
  sector: 28.96,
  /** Run-up speed is read from the race model at 25 m. */
  runUp: 25,
  /** Share of the run-up speed carried into the release (the block turns most of it into the throw). */
  runKeep: 0.25,
  /** Arm speed of the reference (m/s): with 0.25 × the run-up it makes an elite release of about 29.5 m/s (Bartlett & Best, J. Sports Sci. 1988: 28–31 m/s). */
  armRef: 27.1,
  massExp: 1 / 6,
  /** Release angle (°): elite throwers release at 32–36°. */
  angle: 35,
  releaseShare: 1.05,
  releaseCap: 30,
  reachShare: 0.1,
  /**
   * Simple aerodynamics: drag and lift (½ρv²·area·coefficient), the lift
   * perpendicular to the flight path, the javelin weathervaning along it.
   * Areas × coefficients for a men's javelin at small angles of attack
   * (Hubbard & Rust, "Simulation of javelin flight", J. Biomech. 1984).
   */
  cdA: 0.0028,
  clA: 0.0046,
  anchor: 88,
} as const;

/** Throwing limits that apply to both implements. */
export const THROW = {
  /** Pokémon without arms (body shape) throw with a head or tail flick at 60% of the speed. */
  noArms: 0.6,
  /** No body moves an implement faster than a limb can swing (m/s): an elite javelin release, about 30 m/s, caps every throw. */
  vCap: 31,
  /**
   * Hill's force–velocity relation (A. V. Hill, 1938): a muscle moves a
   * load more slowly the closer it is to its strength, v ∝ (1 − r)/(1 + r/k)
   * with r = implement mass ÷ the thrower's best clean & jerk. A thrower
   * that can't lift the implement gets no mark.
   */
  hillK: 0.25,
} as const;

/** Body shapes (PokéAPI) with arms to throw with. */
export const ARMED_SHAPES: ReadonlySet<string> = new Set(["upright", "humanoid", "arms", "tentacles", "armor", "bug-wings"]);
/** Bipeds (for the Fosbury flop). */
export const BIPED_SHAPES: ReadonlySet<string> = new Set(["upright", "humanoid", "legs"]);
/** Four legs or a serpent's body. */
export const LOW_SHAPES: ReadonlySet<string> = new Set(["quadruped", "squiggle"]);

// ---------------------------------------------------------------------------
// Weightlifting (clean & jerk)
// ---------------------------------------------------------------------------

export const LIFT = {
  /** The reference's clean & jerk (kg): the 73 kg world record is 198 kg (Shi Zhiyong, 2021); 190 kg is an elite lift. */
  ref: 190,
  /** Defence keeps a lift stable: × (Def/100)^0.25. */
  defExp: 0.25,
  /** The athlete opens at 90% of its best, then about 96%, then goes for 100%. */
  opening: 0.9,
  second: 0.96,
  third: 1.0,
  /** Each attempt's chance of success falls quickly above the day's best: a logistic curve 1% wide. */
  width: 0.01,
  /** IWF TCRR 2024: the bar loads in 1 kg steps; a men's bar weighs 20 kg and each collar 2.5 kg. */
  step: 1,
  bar: 20,
  collar: 2.5,
  /** Lighter training bars for light lifts: a women's 15 kg bar, 10 and 5 kg technique bars, a 2 kg junior bar. Below 2 kg nothing can be lifted. */
  bars: [20, 15, 10, 5, 2] as readonly number[],
  attempts: 3,
} as const;

/** IWF bumper and change plates (kg) and their colours. */
export const PLATES: readonly { kg: number; color: string; d: number; w: number }[] = [
  { kg: 25, color: "#d32f2f", d: 0.45, w: 0.067 },
  { kg: 20, color: "#1e5bbf", d: 0.45, w: 0.054 },
  { kg: 15, color: "#f2c230", d: 0.4, w: 0.046 },
  { kg: 10, color: "#2e9d4f", d: 0.325, w: 0.037 },
  { kg: 5, color: "#f2f2f2", d: 0.23, w: 0.027 },
  { kg: 2.5, color: "#d32f2f", d: 0.19, w: 0.019 },
  { kg: 2, color: "#1e5bbf", d: 0.175, w: 0.017 },
  { kg: 1.5, color: "#f2c230", d: 0.16, w: 0.015 },
  { kg: 1, color: "#2e9d4f", d: 0.145, w: 0.013 },
  { kg: 0.5, color: "#f2f2f2", d: 0.13, w: 0.011 },
];

// ---------------------------------------------------------------------------
// Swimming: 50 m and 100 m freestyle in a 50 m pool
// ---------------------------------------------------------------------------

export const SWIM = {
  /** World Aquatics FR 2: a 50 m pool, lanes 2.5 m wide, 8 lanes raced; starting platforms 0.5–0.75 m above the water. */
  pool: 50,
  laneWidth: 2.5,
  lanes: 8,
  block: 0.75,
  depth: 3,
  /** Free-swimming speed of the reference (m/s), × (Speed/100)^0.6 × the aquatic factor. */
  vRef: 2.2,
  speedExp: 0.6,
  /** Aquatic factor: Water types and the Water 1/2/3 egg groups 1, everyone else 0.55, Fire, Rock and Ground types 0.4 (they sink or hate water). */
  water: 1,
  other: 0.55,
  sinkers: 0.4,
  /** Fish- or fin-shaped bodies (the fish shape, or the Water 2 "fish" egg group) × 1.15. */
  fin: 1.15,
  /** Swift Swim doubles Speed in rain (its real in-game effect), only with the rain toggle on. */
  swiftSwim: 2,
  /** Reaction to the start signal (s): elite swimmers leave the block in about 0.6–0.7 s; faster with Speed. */
  reactionSlow: 0.78,
  reactionFast: 0.6,
  reactionSpread: 0.02,
  /** Dive: take-off speed of the reference (m/s), from leg power, ∝ (Atk/100)^0.5 (kg/70)^(−1/6). Elite: 4.5–5 m/s. */
  vDive: 4.6,
  /** The body enters the water this many body lengths out, plus its flight from the block. */
  reach: 0.9,
  /** Underwater glide: speed relaxes from the dive (or push-off) to swimming speed with this time constant (s). */
  glide: 1.1,
  /** A flip turn takes about 0.6 s at the wall for a 1.8 m swimmer (longer for bigger bodies, ∝ √length). */
  turn: 0.6,
  /** Push-off speed of the reference (m/s), from Atk (elite: 2.8–3.2 m/s). */
  vPush: 3.0,
  /** Stamina, as on the track: after 25 m the pace fades towards 80% of it, over 40 m × (HP/100)^0.8 (set so the reference swims 21.3 s and 47 s). */
  fadeOnset: 25,
  fadeFloor: 0.8,
  fadeRef: 40,
  anchor50: 21.3,
  anchor100: 47,
} as const;

// ---------------------------------------------------------------------------
// Wrestling (push-out, sumo-style ring)
// ---------------------------------------------------------------------------

export const WRESTLE = {
  /** The ring: a sumo dohyō is 15 shaku (4.55 m) across. A wrestler too big for it gets a ring 1.5 × its body length across. */
  ring: 4.55,
  giantRing: 1.5,
  /** Push = 88 N × kg^(2/3) × Atk/100: the reference shoves with about 1,500 N, an elite sumo charge. */
  push: 88,
  /** Brace = 46 N × kg^(2/3) × Def/100, plus 0.6 × body weight of friction (rubber on clay). */
  brace: 46,
  friction: 0.6,
  /** Bouts are decided within this long (s); at the bell the one pushed further back loses. */
  maxTime: 30,
  /** Momentum swings: surges of +35% for about 0.3 s, about 1.4 a second. */
  surge: 0.35,
  surgeRate: 1.4,
  /** Stamina: effort fades by e^(−t/τ), τ = 40 s × (HP/100)^0.8. */
  stamina: 40,
} as const;

// ---------------------------------------------------------------------------
// All-around (World Athletics combined-events scoring)
// ---------------------------------------------------------------------------

/**
 * Points = A·(B − T)^C for times (s) and A·(M − B)^C for marks (m, or cm
 * for jumps, as in the tables). The 100 m, 400 m, long jump, high jump,
 * shot put and javelin use World Athletics' decathlon constants (IAAF
 * Scoring Tables for Combined Events, 2001). The 200 m, weightlifting and
 * swims have no table: ours follow the same form (C = 1.81 for races, 1.1
 * for the lift; B about twice the elite time, or 10 kg), with A set so an
 * elite mark scores 1,000 (200 m 20.00 s, 190 kg, 50 m 21.30 s, 100 m
 * 47.00 s).
 */
export const TABLES = {
  "100m": { A: 25.4347, B: 18, C: 1.81, unit: "s" },
  "200m": { A: 5.3451, B: 38, C: 1.81, unit: "s" },
  "400m": { A: 1.53775, B: 82, C: 1.81, unit: "s" },
  "long-jump": { A: 0.14354, B: 220, C: 1.4, unit: "cm" },
  "high-jump": { A: 0.8465, B: 75, C: 1.42, unit: "cm" },
  "shot-put": { A: 51.39, B: 1.5, C: 1.05, unit: "m" },
  javelin: { A: 10.14, B: 7, C: 1.08, unit: "m" },
  weightlifting: { A: 3.3052, B: 10, C: 1.1, unit: "kg" },
  "50m-freestyle": { A: 3.2487, B: 45, C: 1.81, unit: "s" },
  "100m-freestyle": { A: 0.643, B: 105, C: 1.81, unit: "s" },
} as const;
