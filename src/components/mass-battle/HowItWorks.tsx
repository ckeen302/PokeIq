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

/** What Real PP does to the ready-made answers (scripts/mass-battle-presets.ts --rules pp). */
const PP_NOTE = "With it on, every ready-made answer here comes out the same: none of their battles lasts long enough for anyone to run out.";

export function HowItWorksBody() {
  const item = "flex gap-2";
  const li = (k: string, children: React.ReactNode) => (
    <li key={k} className={item}><span aria-hidden>•</span><span>{children}</span></li>
  );
  const b = (t: string) => <b className="text-foreground">{t}</b>;
  return (
    <div className="space-y-5 text-sm leading-relaxed text-muted-foreground" data-testid="mb-how-body">
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">The real games&apos; maths</h3>
        <ul className="space-y-1.5">
          {li("damage", <>{b("Damage")} is Smogon&apos;s damage calculator, the one Pokémon Showdown uses: STAB, the type chart, abilities, items, weather, terrain, screens, Terastallization, stat stages, burns, critical hits and the 16 random damage rolls are exact.</>)}
          {li("stats", <>{b("Stats")} come from the Pokédex with the games&apos; stat formula at each Pokémon&apos;s level (any from 1 to 100) with its nature, EVs and IVs; by default a neutral nature, {EV} EVs and {IV} IVs in every stat (the random battles&apos; spread).</>)}
          {li("sets", <>{b("Sets")}: by default, Pokémon in Showdown&apos;s random battles bring four moves of their random-battle set: up to two of its status moves this battle plays (one boost, then healing, then a status condition, Leech Seed, Protect or a screen) and its strongest attacks, with its ability. The rest use the attacking moves they know by levelling up to their level and their first regular ability. In Advanced you can give any species any moves it can legally learn, any of its abilities, a nature, an EV and IV spread and a Tera type.</>)}
          {li("items", <>{b("No held items unless you choose them.")} Items change matchups a lot (Pikachu&apos;s Light Ball doubles its Attack), so armies hold nothing by default, and every answer here is item-free unless its battle says otherwise. Pick an item per species, or turn on random-battle items in Advanced.</>)}
          {li("turns", <>{b("Turns")}: everyone acts once a round. Priority moves go first (Prankster&apos;s status moves too), then higher Speed (with its stages, paralysis, Choice Scarf and the weather abilities), ties at random.</>)}
          {li("choice", <>{b("Choosing a move")}: an attack is worth its expected damage (accuracy × average damage, over everyone a spread move would hit, minus the partners it would hit, never more than the HP they have left). Everything else is weighed against attacking over the turns ahead: as many as the Pokémon expects to last at the damage aimed at it, or as its foes last at the damage its side plans to deal, at most five. A boost is used when the harder hits after it beat the turn it costs; healing when the turns it buys are worth more; a status condition for its chip damage and the hits it stops; Protect to buy a turn of a foe&apos;s poison or Leech Seed; Explosion when what it does now beats what the user would do in the turns it has left. So a boss never sets up against a horde (each foe it knocks out is a fresh one), and no one uses a status move on a foe that already has a status or can&apos;t get it.</>)}
          {li("hits", <>{b("Hits")}: accuracy and evasion (with their stages, No Guard, Compound Eyes, Wide Lens, Bright Powder, Thunder in the rain…), critical hits, recoil, drain, Life Orb and High Jump Kick&apos;s crash. Multi-hit moves play hit by hit; Sturdy, Focus Sash and Disguise only hold a hit taken at full HP. A spread move that hits more than one Pokémon does 0.75× damage, as in double battles.</>)}
          {li("status", <>{b("Status moves")}, with Showdown&apos;s numbers: boosts (Swords Dance, Nasty Plot, Calm Mind, Dragon Dance, Shell Smash, Quiver Dance, Bulk Up, Growth in the sun, Curse); healing (Recover, Roost, Soft-Boiled, Slack Off, and Moonlight, Synthesis, Morning Sun and Shore Up by the weather); Rest (full HP, two turns asleep); Will-O-Wisp, Thunder Wave, Toxic, Spore and the other status moves, with every immunity (Grass types and Overcoat against powders, Ground types against Thunder Wave, Magic Bounce, Prankster against Dark types, Synchronize); Leech Seed; Protect and Detect (a third as likely each time in a row); Reflect, Light Screen and Aurora Veil for five rounds on the user&apos;s whole side (2732/4096 on a side of several, as in doubles), broken by Brick Break and Psychic Fangs; Memento.</>)}
          {li("special", <>{b("Moves with their own rules")}: two-turn moves charge first (Solar Beam and Solar Blade fire at once in the sun, Electro Shot in the rain; Meteor Beam and Skull Bash boost; during Fly, Dig, Dive, Bounce, Phantom Force and Shadow Force the user is out of reach, except to No Guard and the moves that reach it, Earthquake on Dig and Surf on Dive at double damage); Hyper Beam and Giga Impact need a turn to recharge after a hit; Explosion, Self-Destruct and Misty Explosion knock the user out (Damp stops them; when both sides&apos; last Pokémon fall, the user&apos;s side loses); Super Fang, Ruination and Nature&apos;s Madness halve the target&apos;s HP, Seismic Toss and Night Shade do the user&apos;s level, Dragon Rage 40, Sonic Boom 20, Endeavor and Final Gambit the user&apos;s HP; Fissure, Guillotine, Horn Drill and Sheer Cold hit 30% of the time plus the level gap (Sheer Cold 20% from a non-Ice user), never a higher level or Sturdy; Fake Out and First Impression only work on the user&apos;s first action; Counter and Mirror Coat return twice the last physical or special hit taken that round, Metal Burst and Comeuppance 1.5×; Focus Punch fails if the user is hit before it moves; Dream Eater needs a sleeping target; Wrap, Fire Spin and the other binding moves take an eighth of the target&apos;s HP for four or five rounds.</>)}
          {li("effects", <>{b("Side effects and status")}: Thunderbolt&apos;s paralysis, Scald&apos;s burns, Crunch&apos;s Defense drop, Close Combat&apos;s own drops, Iron Head&apos;s flinch, Hurricane&apos;s confusion and Outrage&apos;s lock-in, with Serene Grace, Sheer Force and Shield Dust. Paralysis, burns, poison, bad poison, sleep and freezing work as in the games, with the types, abilities and terrains that block them.</>)}
          {li("entry", <>{b("Abilities as a Pokémon comes in")}, in Speed order: Drizzle, Drought, Sand Stream, Snow Warning and Orichalcum Pulse set their weather for five rounds, and Electric, Grassy, Psychic and Misty Surge and Hadron Engine their terrain (the slowest setter&apos;s stands; a weather already up isn&apos;t set again). Intimidate lowers the Attack of every foe in reach (Inner Focus, Oblivious, Own Tempo and Scrappy ignore it, Guard Dog turns it into a boost, Rattled speeds up, Defiant and Competitive answer it); Trace copies the ability of a random foe in reach (and uses it at once if it acts on entry); Download raises Attack or Sp. Atk by the foes&apos; defences; Neutralizing Gas turns every other ability off while its user stands, and they all come back, acting again, when it falls; Pressure makes foes&apos; moves at it cost two PP. Intrepid Sword and Dauntless Shield act as the battle starts. On the battlefield, the ones that need a foe wait until one is in reach.</>)}
          {li("weatherpick", <>{b("The weather you pick and the setters")}: the weather and terrain you pick are the ground state of the field, for the whole battle. A setter&apos;s weather or terrain replaces them for its five rounds, then the field goes back to what you picked.</>)}
          {li("abilities", <>{b("Abilities in battle")}: contact abilities (Static, Flame Body, Effect Spore, Rough Skin), Poison Touch, Toxic Chain and Poison Puppeteer; Cursed Body (a three-in-ten chance to disable the move that hit it); abilities that grow with the battle (Moxie, Beast Boost, Speed Boost, Stamina, Justified, Weak Armor, Defiant); absorbing abilities (Lightning Rod, Volt Absorb, Sap Sipper, Flash Fire against Will-O-Wisp); Truant and Slow Start; abilities that change a Pokémon as it fights (Stance Change, Schooling, Shields Down, Ice Face, Disguise, Protean and Libero once, as in Gen 9); Mold Breaker; Protosynthesis and Quark Drive in the sun or on Electric Terrain; Shed Skin and Hydration.</>)}
          {li("items-play", <>{b("Items in battle")} (when held): Choice items lock their move; Leftovers, Sitrus and Lum Berries, Focus Sash, Air Balloon, Rocky Helmet, King&apos;s Rock, Punching Glove and Weakness Policy do their jobs, and Knock Off takes an item away.</>)}
          {li("field", <>{b("The field")}: sun, rain, sandstorm or snow and Electric, Grassy, Psychic or Misty Terrain, through the calculator and at the end of each round (sandstorm damage, Grassy Terrain healing, Psychic Terrain stopping priority moves), as do Leftovers, Leech Seed, poison, burns and binding. Castform takes the weather&apos;s type as the battle starts.</>)}
        </ul>
      </section>
      <section className="space-y-2" data-testid="mb-rules-how">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">Two rules you can change</h3>
        <ul className="space-y-1.5">
          {li("ff", <>{b("Friendly fire")} (on by default): Earthquake, Surf, Discharge, Explosion and the other moves that hit everyone around the user hit its partners too, as in the games&apos; double battles (Telepathy keeps a partner safe), and Lightning Rod and Storm Drain pull a partner&apos;s single-target Electric and Water moves into themselves. It&apos;s on because that&apos;s how the games and Showdown play, and Pokémon weigh it: they don&apos;t Earthquake into their own army. Off, spread moves only hit foes.</>)}
          {li("pp", <>{b("Real PP")} (off by default, so answers stay comparable with earlier ones): every move has its PP with three PP Ups, as in every Showdown set; Pressure makes a move aimed at its user cost two; a Pokémon with none left uses Struggle (typeless, a quarter of its max HP back on itself). Off, PP never runs out. {PP_NOTE}</>)}
        </ul>
      </section>
      <section className="space-y-2" data-testid="mb-how-check">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">Checked against Showdown&apos;s simulator</h3>
        <p>
          The same sets were played {CROSSCHECK.battles.toLocaleString("en-US")} times each in this battle and in Pokémon Showdown&apos;s own simulator, in {CROSSCHECK.matchups} battles at levels 50 and 100: one against one, two and three against one, and bigger ones in Showdown&apos;s triples and doubles, where the rest wait and come in as others faint (six and ten against one, six against six), with everyone in reach of everyone and Real PP on. Both sides choose with this battle&apos;s own rule: before every turn the simulator&apos;s battle (HP, status, stat stages, items, forms, PP, Protect, charging, the field) is copied into this one, which picks every Pokémon&apos;s move and target, so only the mechanics differ. In {CROSSCHECK.agree} of the {CROSSCHECK.rows} comparisons the two win rates are within the noise of that many battles. The matchups cover every status move kind, the entry abilities, the special moves, friendly fire and Pressure with PP, most against an opponent found by searching for a close fight. {CROSSCHECK.note}
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
          {li("pos", <>Positions are this page&apos;s own addition. A round lasts {ROUND_S} seconds of battle time. Pokémon run toward their target at 10 m/s per 100 base Speed (Pokémon Race&apos;s scale): the nearest foe they can hurt, the weakest or strongest one near them, or the other side&apos;s boss, as each side is told. A side holding the line waits for foes to come close (both waiting, they advance after a while). A Pokémon with no foe in reach can still use its turn on itself (a boost, healing), so armies set up as they charge.</>)}
          {li("reach", <>A move that makes contact needs the two side by side (within {CONTACT_REACH} m); any other move reaches {RANGED_REACH} m. Spread moves hit every Pokémon within {SPREAD_REACH} m of the user (partners too, with friendly fire). Screens cover the user&apos;s whole side, as in the games.</>)}
          {li("bodies", <>Bodies take room by height and the shape of their art and push each other apart (heavier ones harder); formations can be tight, normal or loose. A hit knocks its target back by its damage over the target&apos;s weight.</>)}
          {li("end", <>A battle still going after {MAX_SECONDS / 60} minutes of battle time is a draw, and so is one where neither side can hurt the other at all.</>)}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">Not in this version</h3>
        <p>Switching, and so everything that needs it: entry hazards (Stealth Rock, Spikes), U-turn and Volt Switch&apos;s switch (they&apos;re plain attacks here), Roar and Whirlwind, Baton Pass, Healing Wish. Status moves that depend on what others did or will do (Taunt, Encore, Disable, Substitute, Sleep Talk, Wish, Pain Split, Trick Room, Tailwind, weather moves like Rain Dance), and moves that only boost Speed are never worth a turn to the choice rule (it doesn&apos;t look ahead at turn order). Roost doesn&apos;t take away the user&apos;s Flying type for the turn. Electromorphosis and Wind Power, Flash Fire&apos;s boost, the moves of other abilities the calculator doesn&apos;t know, Mega Evolution during the battle (Megas start Mega Evolved), Dynamax, and moves whose power depends on what the battle doesn&apos;t track (Last Resort, Stored Power, Poltergeist, Future Sight…). Primal Kyogre and Groudon aren&apos;t on the roster (they have no model here), so heavy rain and harsh sunshine don&apos;t come up.</p>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-foreground">&ldquo;How many?&rdquo;</h3>
        <p>The answer is the smallest army that wins at least half its battles (or nine in ten, if you ask in Advanced), given two ways: {b("On the battlefield")}, with positions, running and reach, and {b("Pure battle maths")}, with everyone in reach of everyone from the start, the model the simulator check uses. Every size is tried on the same seeded battles: doubling first, then a binary search with {SOLVER.runs} battles per size (20 to 200 in Advanced), stopping a size early once its result is decided. The ± is half the range of army sizes that could go either way (winning a quarter to three quarters of their battles), measured on all the battles at the answer and at sizes either side of it. An army of several species, or a group, is shared evenly between them. Battles run in your browser, on every spare core, and well past the number the view can draw.</p>
        <p>Above the view&apos;s limit (lower on phones), the battle is still fought by every unit, and the view draws an even share of each army, labelled on screen. Every battle is seeded: its share link replays the same battle, hit for hit, with the same sets, field, rules and settings.</p>
      </section>
      <p className="text-xs">
        Data: the Pokédex (PokéAPI), Showdown&apos;s random-battle sets, learnsets and move data (@pkmn), Smogon&apos;s damage calculator (@smogon/calc), checked against Showdown&apos;s simulator (@pkmn/sim). Figures: Pokémon HOME renders made solid with depth maps (Depth Anything V2). Music: &ldquo;Epic Endgame Cinematic&rdquo; by cynicmusic (CC0). The colosseum&apos;s crowd: &ldquo;Crowd Shouting/Speaking Ambience&rdquo; by StarNinjas (CC0); the other sounds are made in the browser. Ground textures: Poly Haven (CC0).
      </p>
    </div>
  );
}
