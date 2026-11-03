import { CONTACT_REACH, MAX_SECONDS, RANGED_REACH, ROUND_TICKS, SPREAD_REACH, TICK_HZ } from "@/lib/mass-battle/constants";
import { SOLVER } from "@/lib/mass-battle/solver";
import { EV, IV } from "@/lib/mass-battle/stats";

/**
 * What the battle models and what it doesn't, stated plainly. Rendered on
 * the page (for everyone, and for search engines) and in the stage's
 * "How it works" panel.
 */

const ROUND_S = ROUND_TICKS / TICK_HZ;

/** The simulator check's summary (scripts/mass-battle-crosscheck.ts, 1,000 battles a row; rerun it after changing the rules). */
export const CROSSCHECK = {
  battles: 1000,
  matchups: 34,
  rows: 68,
  agree: 65,
  examples: [
    { label: "Charizard vs Armarouge, level 100", engine: 63.5, sim: 63.3 },
    { label: "3 Poliwrath vs Bruxish, level 100", engine: 80.6, sim: 80.1 },
    { label: "Delphox vs 2 Exeggutor, level 50", engine: 73.5, sim: 72.6 },
    { label: "Slaking (Truant) vs Typhlosion, level 50", engine: 37.4, sim: 37.8 },
    { label: "Greninja (Protean) vs Samurott, level 100", engine: 43.6, sim: 42.7 },
    { label: "Cloyster (Skill Link) vs Skarmory (Sturdy), level 100", engine: 50.7, sim: 50.3 },
  ],
} as const;

export function HowItWorksBody() {
  const item = "flex gap-2";
  const li = (k: string, children: React.ReactNode) => (
    <li key={k} className={item}><span aria-hidden>•</span><span>{children}</span></li>
  );
  return (
    <div className="space-y-5 text-sm leading-relaxed text-muted-foreground" data-testid="mb-how-body">
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">The real games&apos; maths</h3>
        <ul className="space-y-1.5">
          {li("damage", <><b className="text-foreground">Damage</b> is Smogon&apos;s damage calculator, the one Pokémon Showdown uses: STAB, the type chart, abilities, items, weather, terrain, Terastallization, stat stages, burns, critical hits and the 16 random damage rolls are exact.</>)}
          {li("stats", <><b className="text-foreground">Stats</b> come from the Pokédex with the games&apos; stat formula at each Pokémon&apos;s level (any from 1 to 100) with its nature, EVs and IVs; by default a neutral nature, {EV} EVs and {IV} IVs in every stat (the random battles&apos; spread).</>)}
          {li("sets", <><b className="text-foreground">Sets</b>: by default, Pokémon in Showdown&apos;s random battles bring up to four attacking moves of their random-battle set and its ability; the rest use the attacking moves they know by levelling up to their level (the strongest first, then new types) and their first regular ability. In Advanced you can give any species any moves it can legally learn, any of its abilities, a nature, an EV and IV spread and a Tera type.</>)}
          {li("items", <><b className="text-foreground">No held items unless you choose them.</b> Items change matchups a lot (Pikachu&apos;s Light Ball doubles its Attack), so armies hold nothing by default, and every answer here is item-free unless its battle says otherwise (the Light Ball one does). Pick an item per species, or turn on random-battle items in Advanced.</>)}
          {li("turns", <><b className="text-foreground">Turns</b>: everyone acts once a round, choosing its move as the round starts: the one that does the most expected damage (accuracy × average damage) to the foes it would hit. Priority moves go first, then higher Speed (with its stages, paralysis, Choice Scarf and the weather abilities), ties at random.</>)}
          {li("hits", <><b className="text-foreground">Hits</b>: accuracy and evasion (with their stages, No Guard, Compound Eyes, Wide Lens, Bright Powder, Thunder in the rain…), critical hits, recoil, drain, Life Orb and High Jump Kick&apos;s crash. Multi-hit moves play hit by hit, as in the games: each hit can be a critical hit, and Sturdy, Focus Sash and Disguise only hold a hit taken at full HP, so Icicle Spear and Population Bomb break through them. A spread move (Earthquake, Surf, Blizzard…) that hits more than one foe does 0.75× damage, as in double battles.</>)}
          {li("effects", <><b className="text-foreground">Side effects and status</b>: Thunderbolt&apos;s paralysis, Scald&apos;s burns, Crunch&apos;s Defense drop, Close Combat&apos;s own drops, Iron Head&apos;s flinch, Hurricane&apos;s confusion and Outrage&apos;s lock-in, with Serene Grace, Sheer Force and Shield Dust. Paralysis, burns, poison, bad poison, sleep and freezing work as in the games, with the types, abilities and terrains that block them.</>)}
          {li("abilities", <><b className="text-foreground">Abilities in battle</b>: contact abilities (Static, Flame Body, Effect Spore, Rough Skin), Poison Touch, Toxic Chain and Poison Puppeteer; abilities that grow with the battle (Moxie, Beast Boost, Speed Boost, Stamina, Justified, Weak Armor, Defiant); absorbing abilities (Lightning Rod, Volt Absorb, Sap Sipper); Truant (Slaking loafs every other turn) and Slow Start (Regigigas at half Attack and Speed for five turns); abilities that change a Pokémon as it fights (Aegislash&apos;s Stance Change, Wishiwashi&apos;s Schooling, Minior&apos;s Shields Down, Eiscue&apos;s Ice Face, Mimikyu&apos;s Disguise, and Protean and Libero, once, as in Gen 9); Mold Breaker, which goes through Sturdy and the like; Intrepid Sword and Dauntless Shield as the battle starts; Protosynthesis and Quark Drive in the sun or on the Electric Terrain you pick; Shed Skin and Hydration.</>)}
          {li("items-play", <><b className="text-foreground">Items in battle</b> (when held): Choice items lock their move; Leftovers, Sitrus and Lum Berries, Focus Sash, Air Balloon, Rocky Helmet, King&apos;s Rock, Punching Glove and Weakness Policy do their jobs, and Knock Off takes an item away.</>)}
          {li("field", <><b className="text-foreground">The field</b>: sun, rain, sandstorm or snow and Electric, Grassy, Psychic or Misty Terrain, through the calculator and at the end of each round (sandstorm damage, Grassy Terrain healing, Psychic Terrain stopping priority moves), as do Leftovers, poison and burns. Castform takes the weather&apos;s type.</>)}
        </ul>
      </section>
      <section className="space-y-2" data-testid="mb-how-check">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">Checked against Showdown&apos;s simulator</h3>
        <p>
          The same sets were played {CROSSCHECK.battles.toLocaleString("en-US")} times each in this battle and in Pokémon Showdown&apos;s own simulator, in {CROSSCHECK.matchups} small battles (one against one, two against one, one against two, three against one) at levels 50 and 100, with both choosing moves the same way and everyone in reach of everyone (the battlefield below is left out). In {CROSSCHECK.agree} of the {CROSSCHECK.rows} comparisons the two win rates are within the noise of that many battles. The matchups include one for each ability here that changes a Pokémon as it fights (Truant, Slow Start, Stance Change, Schooling, Shields Down, Ice Face, Disguise, Protean, Libero, Toxic Chain, Poison Puppeteer, Mold Breaker and Skill Link against Sturdy, Intrepid Sword, and Protosynthesis and Quark Drive in their weather and terrain). Two of the other three are a known gap: in a double battle, Lightning Rod pulls a partner&apos;s Electric moves into itself, and this battle has no moves between allies. The third is chance: played again with 4,000 fresh battles, it agrees.
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {CROSSCHECK.examples.map((e) => (
            <li key={e.label} className="rounded-md bg-foreground/[0.04] px-2.5 py-1.5 text-xs">
              <span className="block text-foreground">{e.label}</span>
              <span className="tabular-nums">This battle {e.engine.toFixed(1)}% · Showdown {e.sim.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">Our battlefield</h3>
        <ul className="space-y-1.5">
          {li("pos", <>Positions are this page&apos;s own addition. A round lasts {ROUND_S} seconds of battle time. Pokémon run toward their target at 10 m/s per 100 base Speed (Pokémon Race&apos;s scale): the nearest foe they can hurt, the weakest or strongest one near them, or the other side&apos;s boss, as each side is told. A side holding the line waits for foes to come close (both waiting, they advance after a while).</>)}
          {li("reach", <>A move that makes contact needs the two side by side (within {CONTACT_REACH} m); any other move reaches {RANGED_REACH} m. Spread moves hit every foe within {SPREAD_REACH} m of the user, never its own side (in the games Earthquake and Surf also hit allies).</>)}
          {li("bodies", <>Bodies take room by height and the shape of their art and push each other apart (heavier ones harder); formations can be tight, normal or loose. A hit knocks its target back by its damage over the target&apos;s weight.</>)}
          {li("end", <>A battle still going after {MAX_SECONDS / 60} minutes of battle time is a draw, and so is one where neither side can hurt the other at all.</>)}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">Not in this version</h3>
        <p>Status moves (Swords Dance, Protect, Will-O-Wisp), switching, abilities that act on others as a Pokémon comes in (Intimidate, Trace, Neutralizing Gas, and Drizzle and the other weather and terrain setters: the field is the one you pick), anything between allies (Earthquake hitting partners, Lightning Rod drawing a partner&apos;s moves, Helping Hand), the damage trapping moves do over the next turns, Flash Fire&apos;s boost, Mega Evolution during the battle (Megas start Mega Evolved) and Dynamax, and moves that need what the battle doesn&apos;t track: charging or recharging moves, moves that make the user faint, one-hit KO moves, Fake Out, Focus Punch, Dream Eater, Super Fang, Counter and the like.</p>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">&ldquo;How many?&rdquo;</h3>
        <p>The answer is the smallest army that wins at least half its battles (or nine in ten, if you ask in Advanced). Every size is tried on the same seeded battles: doubling first, then a binary search with {SOLVER.runs} battles per size (20 to 200 in Advanced), stopping a size early once its result is decided. The ± is half the range of army sizes that could go either way (winning a quarter to three quarters of their battles), measured on all the battles at the answer and at sizes either side of it. An army of several species, or a group, is shared evenly between them. Battles run in your browser, on every spare core, and well past the number the view can draw.</p>
        <p>Above the view&apos;s limit (lower on phones), the battle is still fought by every unit, and the view draws an even share of each army, labelled on screen. Every battle is seeded: its share link replays the same battle, hit for hit, with the same sets, field and settings.</p>
      </section>
      <p className="text-xs">
        Data: the Pokédex (PokéAPI), Showdown&apos;s random-battle sets, learnsets and move data (@pkmn), Smogon&apos;s damage calculator (@smogon/calc), checked against Showdown&apos;s simulator (@pkmn/sim). Figures: Pokémon HOME renders made solid with depth maps (Depth Anything V2). Music: &ldquo;Epic Endgame Cinematic&rdquo; by cynicmusic (CC0). The colosseum&apos;s crowd: &ldquo;Crowd Shouting/Speaking Ambience&rdquo; by StarNinjas (CC0); the other sounds are made in the browser. Ground textures: Poly Haven (CC0).
      </p>
    </div>
  );
}
