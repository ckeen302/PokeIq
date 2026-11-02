import { ACCEL, FADE } from "@/lib/race/model";

/**
 * "How the race works": the model in plain words, with its sources. Shown
 * in the 3D view's info panel and in the page's server-rendered text.
 */
export function RaceInfo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "space-y-3 text-sm leading-relaxed" : "space-y-3 text-sm leading-relaxed text-muted-foreground"} data-testid="race-info">
      <p>
        <strong className="text-foreground">Pokémon have no official real-world speeds.</strong> So every speed here is scaled from the base Speed stat, with
        100 Speed set to 10 m/s, a world-class sprinter&apos;s top speed. Regieleki (200 Speed) tops out at 20 m/s; Shuckle (5 Speed) at 0.5 m/s.
      </p>
      <p>
        <strong className="text-foreground">Getting going:</strong> each runner follows the classic sprint curve of Furusawa, Hill and Parkinson (1927), where speed
        rises as v(t) = v<sub>max</sub>(1 − e<sup>−t/τ</sup>). The time constant τ comes from power-to-weight: {ACCEL.tau0} s for a 70 kg runner with 100 Attack,
        a little longer for heavier Pokémon and a little shorter for stronger ones (between {ACCEL.min} s and {ACCEL.max} s). Base Speed decides the race; two Pokémon
        with the same Speed are split by how fast they get away, often by hundredths.
      </p>
      <p>
        <strong className="text-foreground">Stamina (200 m and 400 m):</strong> base HP is endurance. After {FADE.onset} m, about where sprinters start to tie up, the
        speed a runner can hold fades, more slowly the more HP it has: with 100 HP it keeps about 96% of its top speed at 200 m and 84% at 400 m, like an elite
        400 m runner.
      </p>
      <p>
        <strong className="text-foreground">How they move:</strong> stride length and rhythm follow R. McNeill Alexander&apos;s dynamic similarity (Nature, 1976):
        relative stride λ = 2.3 · (v²/gh)<sup>0.3</sup>, with h the hip height. At the same speed small Pokémon patter and giants lope. Winged Pokémon and
        Flying types fly low over their lane (wingbeats slow with size), Levitate and floating Ghosts hover, serpents slither, fish flop, balls roll, blobs
        bounce, quadrupeds gallop. Heavy runners shake the ground.
      </p>
      <p>
        <strong className="text-foreground">The track:</strong> a regulation 400 m track (84.39 m straights, 36.5 m bends, eight 1.22 m lanes) with staggered
        starts for 200 m and 400 m. Times are to the hundredth, and to the thousandth when a photo finish needs it.
      </p>
      {!compact && <p className="text-xs">Stats, heights and weights from the Pokédex (PokéAPI), forms included. A hypothetical race for fun, not game mechanics.</p>}
    </div>
  );
}
