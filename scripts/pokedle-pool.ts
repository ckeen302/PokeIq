/**
 * Pokédle's curated daily answer pool.
 *
 *   npx tsx scripts/pokedle-pool.ts
 *
 * Writes src/data/pokedle-pool.json: the Pokémon a daily Pokédle can be,
 * in three difficulty tiers (easier, medium, harder). Daily answers come
 * from this pool only (see src/lib/server/pokedle-schedule.ts); practice
 * and duels still draw from every Pokémon.
 *
 * - Easier: the hand-picked ICONIC list below, about 30 to 75 per
 *   generation: starters, mascots, box legendaries and the Pokémon most
 *   players have met.
 * - Always kept (medium or harder): the rest of an iconic Pokémon's
 *   evolution family (Pidgeotto, Drilbur, Gimmighoul), and the legendary
 *   and mythical Pokémon of Generations 1 to 7.
 * - Every other Pokémon is scored by how many regional Pokédexes it
 *   appears in and how many games have a Pokédex entry for it, both ranked
 *   within its own generation (so every generation keeps its best-known
 *   Pokémon), with a small bonus for final forms and a small penalty for
 *   middle stages. Each generation keeps its best-scored share (all of
 *   Gen 1 down to 60% of Gen 9: newer generations have more deep cuts),
 *   and the kept ones split into medium (top half) and harder.
 * - Never an answer: Paradox Pokémon, Ultra Beasts, the Treasures of Ruin,
 *   the Loyal Three, Terapagos and Pecharunt.
 *
 * The week follows the tiers: Monday to Wednesday draw from the easier
 * tier, Thursday and Friday the medium one, the weekend the harder one.
 *
 * IMPORTANT: changing the pool changes every daily of the era that uses
 * it. Once an era has started, add a new era with a later start date in
 * pokedle-schedule.ts (and a new pool file) instead of editing this one.
 */
import fs from "node:fs";
import path from "node:path";

interface Species {
  id: number;
  name: string;
  gen: number;
  stage: number;
  fullyEvolved: boolean;
  chain: number;
  legendary: boolean;
  mythical: boolean;
}

const root = process.cwd();
const pokedex = JSON.parse(fs.readFileSync(path.join(root, "src/data/pokedex.json"), "utf8")) as Species[];
const details = JSON.parse(fs.readFileSync(path.join(root, "src/data/pokedex-details.json"), "utf8")) as Record<
  string,
  { dexNumbers: unknown[]; entries: { games: string[] }[] }
>;
const OUT = path.join(root, "src/data/pokedle-pool.json");

const key = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_NAME = new Map(pokedex.map((p) => [key(p.name), p]));
function ids(names: string): number[] {
  return names
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => {
      const p = BY_NAME.get(key(n));
      if (!p) throw new Error(`Unknown Pokémon: ${n}`);
      return p.id;
    });
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** The easier tier: Pokémon most players know on sight. */
const ICONIC = new Set(
  ids(`
    Bulbasaur, Ivysaur, Venusaur, Charmander, Charmeleon, Charizard, Squirtle, Wartortle, Blastoise, Butterfree,
    Pidgey, Pidgeot, Rattata, Ekans, Arbok, Nidoqueen, Nidoking, Pikachu, Raichu, Clefairy, Vulpix, Ninetales, Jigglypuff, Zubat, Golbat,
    Diglett, Meowth, Psyduck, Growlithe, Arcanine, Poliwag, Abra, Alakazam, Machop, Machamp, Geodude, Golem, Ponyta,
    Rapidash, Slowpoke, Slowbro, Magnemite, Farfetch'd, Grimer, Muk, Gastly, Haunter, Gengar, Onix, Cubone, Marowak,
    Hitmonlee, Hitmonchan, Koffing, Weezing, Chansey, Staryu, Starmie, Mr. Mime, Scyther, Jynx, Magikarp, Gyarados,
    Lapras, Ditto, Eevee, Vaporeon, Jolteon, Flareon, Snorlax, Articuno, Zapdos, Moltres, Dratini, Dragonite, Mewtwo, Mew,

    Chikorita, Bayleef, Meganium, Cyndaquil, Quilava, Typhlosion, Totodile, Croconaw, Feraligatr, Crobat, Pichu, Cleffa,
    Igglybuff, Togepi, Togetic, Mareep, Ampharos, Marill, Azumarill, Sudowoodo, Quagsire, Espeon, Umbreon, Murkrow,
    Slowking, Unown, Wobbuffet, Steelix, Scizor, Heracross, Sneasel, Teddiursa, Houndoom, Donphan, Kingdra, Blissey,
    Larvitar, Tyranitar, Lugia, Ho-Oh, Suicune,

    Treecko, Grovyle, Sceptile, Torchic, Combusken, Blaziken, Mudkip, Marshtomp, Swampert, Zigzagoon, Ludicolo, Ralts,
    Kirlia, Gardevoir, Shroomish, Breloom, Slaking, Exploud, Sableye, Mawile, Plusle, Minun, Aron, Aggron, Wailord, Trapinch, Flygon,
    Altaria, Zangoose, Seviper, Feebas, Milotic, Absol, Bagon, Salamence, Beldum, Metagross, Latias, Latios, Kyogre,
    Groudon, Rayquaza, Jirachi, Deoxys,

    Turtwig, Grotle, Torterra, Chimchar, Monferno, Infernape, Piplup, Prinplup, Empoleon, Starly, Staraptor, Bidoof,
    Shinx, Luxray, Roserade, Cranidos, Pachirisu, Drifloon, Lopunny, Mismagius, Honchkrow, Spiritomb, Gible, Gabite,
    Garchomp, Munchlax, Riolu, Lucario, Croagunk, Weavile, Magnezone, Togekiss, Leafeon, Glaceon, Mamoswine, Gallade,
    Froslass, Rotom, Dialga, Palkia, Giratina, Darkrai, Arceus,

    Snivy, Servine, Serperior, Tepig, Pignite, Emboar, Oshawott, Dewott, Samurott, Lillipup, Purrloin, Woobat, Excadrill,
    Audino, Conkeldurr, Whimsicott, Scrafty, Darmanitan, Zorua, Zoroark, Minccino, Reuniclus, Vanilluxe, Emolga,
    Galvantula, Ferrothorn, Chandelure, Axew, Haxorus, Golurk, Bisharp, Braviary, Hydreigon, Volcarona, Victini, Reshiram,
    Zekrom, Kyurem,

    Chespin, Quilladin, Chesnaught, Fennekin, Braixen, Delphox, Froakie, Frogadier, Greninja, Fletchling, Talonflame,
    Pyroar, Flabébé, Pancham, Espurr, Honedge, Aegislash, Sylveon, Hawlucha, Dedenne, Goomy, Goodra, Klefki, Noivern,
    Xerneas, Yveltal, Zygarde,

    Rowlet, Dartrix, Decidueye, Litten, Torracat, Incineroar, Popplio, Brionne, Primarina, Pikipek, Toucannon, Rockruff,
    Lycanroc, Wishiwashi, Toxapex, Mudsdale, Salazzle, Stufful, Bewear, Wimpod, Golisopod, Komala, Togedemaru, Mimikyu,
    Tapu Koko, Solgaleo, Lunala,

    Grookey, Thwackey, Rillaboom, Scorbunny, Raboot, Cinderace, Sobble, Drizzile, Inteleon, Rookidee, Corviknight, Wooloo,
    Yamper, Toxtricity, Polteageist, Hatterene, Grimmsnarl, Sirfetch'd, Alcremie, Snom, Eiscue, Morpeko, Dragapult,
    Zacian, Zamazenta,

    Sprigatito, Floragato, Meowscarada, Fuecoco, Crocalor, Skeledirge, Quaxly, Quaxwell, Quaquaval, Lechonk, Pawmi,
    Tandemaus, Maushold, Fidough, Armarouge, Ceruledge, Tinkatink, Tinkaton, Wiglett, Palafin, Dondozo, Tatsugiri,
    Clodsire, Kingambit, Baxcalibur, Gholdengo, Koraidon, Miraidon
  `)
);

/** Never a daily answer: deep cuts with odd names and no evolution family to reason from. */
const EXCLUDED = new Set([
  ...range(793, 799), // Ultra Beasts
  ...range(803, 806),
  ...range(984, 995), // Paradox
  1005,
  1006,
  1009,
  1010,
  ...range(1020, 1023),
  ...range(1001, 1004), // Treasures of Ruin
  ...range(1014, 1016), // Loyal Three
  1024, // Terapagos
  1025, // Pecharunt
]);

/** Share of each generation that can be a daily answer. */
const KEEP: Record<number, number> = { 1: 1, 2: 0.9, 3: 0.85, 4: 0.85, 5: 0.75, 6: 0.8, 7: 0.75, 8: 0.65, 9: 0.6 };

const dexCount = (p: Species) => details[p.id].dexNumbers.length;
const gameCount = (p: Species) => new Set(details[p.id].entries.flatMap((e) => e.games)).size;

/** Percentile rank (0..1, ties share the average rank) of each value. */
function percentiles(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    if (sorted.length < 2) return 1;
    return (sorted.indexOf(v) + sorted.lastIndexOf(v)) / 2 / (sorted.length - 1);
  });
}

const longest = new Map<number, number>();
for (const p of pokedex) longest.set(p.chain, Math.max(longest.get(p.chain) ?? 0, p.stage));

const score = new Map<number, number>();
const gens = [...new Set(pokedex.map((p) => p.gen))].sort((a, b) => a - b);
for (const gen of gens) {
  const members = pokedex.filter((p) => p.gen === gen);
  const dex = percentiles(members.map(dexCount));
  const games = percentiles(members.map(gameCount));
  members.forEach((p, i) => {
    const middle = p.stage === 2 && !p.fullyEvolved && (longest.get(p.chain) ?? 0) >= 3;
    score.set(p.id, 0.7 * dex[i] + 0.3 * games[i] + (p.fullyEvolved ? 0.1 : 0) - (middle ? 0.1 : 0));
  });
}
const byScore = (a: Species, b: Species) => score.get(b.id)! - score.get(a.id)! || a.id - b.id;

const iconicChains = new Set(pokedex.filter((p) => ICONIC.has(p.id)).map((p) => p.chain));
/** Kept whatever their score: an iconic Pokémon's family, and the older generations' legends. */
const kept = (p: Species) => iconicChains.has(p.chain) || ((p.legendary || p.mythical) && p.gen <= 7);

const easy: number[] = [];
const rest: Species[] = [];
for (const gen of gens) {
  const members = pokedex.filter((p) => p.gen === gen);
  const iconic = members.filter((p) => ICONIC.has(p.id));
  const candidates = members.filter((p) => !ICONIC.has(p.id) && !EXCLUDED.has(p.id));
  const always = candidates.filter(kept);
  const others = candidates.filter((p) => !kept(p)).sort(byScore);
  const room = Math.max(0, Math.round(members.length * KEEP[gen]) - iconic.length - always.length);
  easy.push(...iconic.map((p) => p.id));
  rest.push(...always, ...others.slice(0, room));
}
for (const id of ICONIC) if (EXCLUDED.has(id)) throw new Error(`${id} is both iconic and excluded`);

// The rest split in half by score, within each generation, so both halves keep every generation.
const medium: number[] = [];
const hard: number[] = [];
for (const gen of gens) {
  const members = rest.filter((p) => p.gen === gen).sort(byScore);
  const half = Math.ceil(members.length / 2);
  medium.push(...members.slice(0, half).map((p) => p.id));
  hard.push(...members.slice(half).map((p) => p.id));
}

const tiers = [easy, medium, hard].map((t) => [...t].sort((a, b) => a - b));
fs.writeFileSync(
  OUT,
  JSON.stringify({
    about: "Pokédle's daily answer pool, from scripts/pokedle-pool.ts: Pokédex numbers in three tiers, easier first.",
    tiers,
  }) + "\n"
);

const total = tiers.reduce((n, t) => n + t.length, 0);
console.log(`✓ ${path.relative(root, OUT)}: ${total} of ${pokedex.length} Pokémon, tiers ${tiers.map((t) => t.length).join(" / ")}`);
for (const gen of gens) {
  const counts = tiers.map((t) => t.filter((id) => pokedex[id - 1].gen === gen).length);
  console.log(`  Gen ${gen}: ${counts.join(" / ")}`);
}
