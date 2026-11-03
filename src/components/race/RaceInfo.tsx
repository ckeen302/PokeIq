import { ACCEL, FADE, SPEED_PER_POINT } from "@/lib/race/model";

/**
 * "How the race works": the model in plain words, what is measured and what
 * is a choice, with its sources. Shown in the 3D view's info panel and in
 * the page's server-rendered text.
 */
export function RaceInfo({ compact = false }: { compact?: boolean }) {
  const strong = "text-foreground";
  const v100 = 100 * SPEED_PER_POINT;
  return (
    <div className={compact ? "space-y-3 text-sm leading-relaxed" : "space-y-3 text-sm leading-relaxed text-muted-foreground"} data-testid="race-info">
      <p>
        <strong className={strong}>Pokémon have no official real-world speeds,</strong> so this is a model, not game data. Every speed is scaled from the
        base Speed stat by one rule we chose: 100 Speed = {v100}&nbsp;m/s ({(v100 * 3.6).toFixed(0)}&nbsp;km/h), about a world-class sprinter&apos;s average
        speed over 100&nbsp;m. Regieleki (200 Speed) tops out at 20&nbsp;m/s; Shuckle (5 Speed) at 0.5&nbsp;m/s.
      </p>
      <p>
        <strong className={strong}>Getting going:</strong> each runner follows the classic sprint curve of Furusawa, Hill and Parkinson (1927), where speed
        rises as v(t) = v<sub>max</sub>(1 − e<sup>−t/τ</sup>). We set the time constant τ from power-to-weight: {ACCEL.tau0}&nbsp;s, a human sprinter&apos;s,
        for a 70&nbsp;kg runner with 100 Attack, a little longer for heavier Pokémon and a little shorter for stronger ones (between {ACCEL.min}&nbsp;s and {ACCEL.max}&nbsp;s).
        The effect is kept small on purpose: base Speed decides the race, and two Pokémon with the same Speed are split by how fast they get away.
      </p>
      <p>
        <strong className={strong}>Stamina (200&nbsp;m and 400&nbsp;m only):</strong> we let base HP stand for endurance. After {FADE.onset}&nbsp;m the speed a runner can
        hold fades towards {Math.round(FADE.floor * 100)}% of its top speed, more slowly the more HP it has: with 100 HP it keeps about 96% at 200&nbsp;m and 84% at
        400&nbsp;m, roughly how much an elite 400&nbsp;m runner slows.
      </p>
      <p>
        <strong className={strong}>How they move</strong> changes the animation, never the time. Stride length and rhythm follow R. McNeill Alexander&apos;s
        dynamic similarity (Nature, 1976): relative stride λ = 2.3 · (v²/gh)<sup>0.3</sup>, with h the hip height, so at the same speed small Pokémon patter
        and giants lope; legs, arms, wings and tails swing in time with it. Winged Pokémon and Flying types fly low over their lane, Levitate and floating
        Ghosts hover, serpents slither, balls roll, blobs bounce and quadrupeds gallop, going by each Pokémon&apos;s body shape, types and abilities. Fish
        and legless Water types swim in a pool lane, beating their tails at the rate R. Bainbridge measured in fish (J. Exp. Biol., 1958): speed ≈ 0.75 ×
        body length × tail beats a second.
      </p>
      <p>
        <strong className={strong}>The track:</strong> a regulation 400&nbsp;m track (84.39&nbsp;m straights, bends with a 36.5&nbsp;m inner radius, eight 1.22&nbsp;m lanes)
        with staggered starts for 200&nbsp;m and 400&nbsp;m. Times are to the hundredth, and to the thousandth when two would otherwise tie.
      </p>
      <p className="text-xs">Stats, heights and weights from the Pokédex (PokéAPI), forms included. A what-if race for fun, not game mechanics.</p>
    </div>
  );
}
