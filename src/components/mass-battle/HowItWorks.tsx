import { CONTACT_REACH, MAX_SECONDS, RANGED_REACH, ROUND_TICKS, SPREAD_REACH, TICK_HZ } from "@/lib/mass-battle/engine";
import { SOLVER } from "@/lib/mass-battle/solver";
import { EV, IV } from "@/lib/mass-battle/stats";

/**
 * What the battle models and what it doesn't, stated plainly. Rendered on
 * the page (for everyone, and for search engines) and in the stage's
 * "How it works" panel.
 */

const ROUND_S = ROUND_TICKS / TICK_HZ;

export function HowItWorksBody() {
  const item = "flex gap-2";
  return (
    <div className="space-y-5 text-sm leading-relaxed text-muted-foreground" data-testid="mb-how-body">
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">The real games&apos; maths</h3>
        <ul className="space-y-1.5">
          <li className={item}><span aria-hidden>•</span><span><b className="text-foreground">Damage</b> is Smogon&apos;s damage calculator, the one Pokémon Showdown uses: STAB, the type chart, abilities such as Huge Power, Levitate or Thick Fat, damage items, critical hits and the 16 random damage rolls are exact.</span></li>
          <li className={item}><span aria-hidden>•</span><span><b className="text-foreground">Stats</b> come from the Pokédex with the games&apos; stat formula at the chosen level (50 or 100), a neutral nature, {IV} IVs and {EV} EVs in every stat.</span></li>
          <li className={item}><span aria-hidden>•</span><span><b className="text-foreground">Sets</b>: Pokémon in Showdown&apos;s random battles bring up to four attacking moves of their random-battle set, its ability and its item if it changes damage (Life Orb, Choice Band, Light Ball…). The rest use the attacking moves they learn by levelling up to that level (up to four, the strongest first, then new types), their first regular ability and no item.</span></li>
          <li className={item}><span aria-hidden>•</span><span><b className="text-foreground">Turns</b>: everyone acts once a round. Priority moves go first, then higher Speed, ties at random. Each Pokémon uses the move that does the most expected damage (accuracy × average damage) to the foes it can reach.</span></li>
          <li className={item}><span aria-hidden>•</span><span><b className="text-foreground">Hits</b>: accuracy, critical hits (1 in 24, more for high-critical moves), multi-hit counts, recoil, drain, Life Orb recoil and Sturdy work as in the games. A spread move (Earthquake, Surf, Blizzard…) that hits more than one foe does 0.75× damage, as in double battles.</span></li>
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">Our battlefield</h3>
        <ul className="space-y-1.5">
          <li className={item}><span aria-hidden>•</span><span>Positions are this page&apos;s own addition. A round lasts {ROUND_S} seconds of battle time. Pokémon run toward the nearest foe they can hurt at 10 m/s per 100 base Speed (Pokémon Race&apos;s scale).</span></li>
          <li className={item}><span aria-hidden>•</span><span>A move that makes contact needs the two side by side (within {CONTACT_REACH} m); any other move reaches {RANGED_REACH} m. Spread moves hit every foe within {SPREAD_REACH} m of the user, never its own side (in the games Earthquake and Surf also hit allies).</span></li>
          <li className={item}><span aria-hidden>•</span><span>Bodies take room by height and the shape of their art and push each other apart (heavier ones harder). A hit knocks its target back by its damage over the target&apos;s weight.</span></li>
          <li className={item}><span aria-hidden>•</span><span>A battle still going after {MAX_SECONDS / 60} minutes of battle time is a draw, and so is one where neither side can hurt the other at all.</span></li>
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">Not in this version</h3>
        <p>Status moves and status conditions, stat changes (Swords Dance, Intimidate), weather and terrain (Drizzle does nothing here), healing, held-item effects beyond damage (Leftovers, berries, Focus Sash), switching, Terastallization, and moves that need what the battle doesn&apos;t track: charging or recharging moves, moves that make the user faint, one-hit KO moves, Fake Out, Focus Punch, Dream Eater, Super Fang, Counter and the like.</p>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">&ldquo;How many?&rdquo;</h3>
        <p>The answer is the smallest army that wins at least half its battles. Every size is tried on the same seeded battles: doubling first, then a binary search with {SOLVER.runs} battles per size, stopping a size early once the majority is decided. The ± is half the range of army sizes that win between a quarter and three quarters of their battles, measured on all {SOLVER.runs} battles at the answer and at sizes either side of it. Battles run in your browser, on every spare core.</p>
        <p>Above the view&apos;s limit (lower on phones), the battle is still fought by every unit, and the view draws an even share of each army, labelled on screen. Every battle is seeded: its share link replays the same battle, hit for hit.</p>
      </section>
      <p className="text-xs">
        Data: the Pokédex (PokéAPI), Showdown&apos;s random-battle sets and move data (@pkmn), Smogon&apos;s damage calculator (@smogon/calc). Figures: Pokémon HOME renders made solid with depth maps (Depth Anything V2). Music: &ldquo;Epic Endgame Cinematic&rdquo; by cynicmusic (CC0). Ground textures: Poly Haven (CC0).
      </p>
    </div>
  );
}
