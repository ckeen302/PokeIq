import type { Difficulty } from "../types";
import { aOrAn } from "../shared";
import { handwrittenLoc, harder, pool, ROMAN, slug, type HandwrittenRow, type TriviaItem } from "./bank";
import { must } from "../localize";
import { gameIn, genIn, genOption, personIn, placeIn, regionIn, typeIn } from "./words";
import GAMES from "@/data/quiz/games/games.json";
import GYMS from "@/data/quiz/games/gyms.json";
import ELITE_FOUR from "@/data/quiz/games/elite-four.json";
import CHAMPIONS from "@/data/quiz/games/champions.json";
import PROFESSORS from "@/data/quiz/games/professors.json";
import STARTERS from "@/data/quiz/games/starters.json";
import BOX_ART from "@/data/quiz/games/box-art.json";
import EXCLUSIVES from "@/data/quiz/games/exclusives.json";
import VILLAINS from "@/data/quiz/games/villains.json";
import TEAM_STAR from "@/data/quiz/games/team-star.json";
import MECHANICS from "@/data/quiz/games/mechanics.json";
import REGIONS from "@/data/quiz/games/regions.json";
import PLACES from "@/data/quiz/games/places.json";
import HANDWRITTEN from "@/data/quiz/games/handwritten.json";

/**
 * The Mainline Games bank: questions generated from the data tables in
 * src/data/quiz/games plus hand-written ones. Every prompt about something
 * that changed between versions names the game it's about, and distractors
 * come from the same category (other leaders of that region, other regions…)
 * minus anything that would also be right.
 */

type GymRow = (typeof GYMS)[number] & { badge?: string; type?: string; ask?: boolean };

/** Types each trainer is known for anywhere (Larry: Normal Gym, Flying Elite Four). */
const PERSON_TYPES = new Map<string, Set<string>>();
for (const r of [...(GYMS as GymRow[]), ...ELITE_FOUR.map((e) => ({ leader: e.member, type: e.type }))]) {
  if (!r.type) continue;
  if (!PERSON_TYPES.has(r.leader)) PERSON_TYPES.set(r.leader, new Set());
  PERSON_TYPES.get(r.leader)!.add(r.type);
}
const ALL_TYPES = ["Normal", "Fire", "Water", "Grass", "Electric", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"];

/**
 * Wrong types for a trainer: the other specialties of the same Gym or Elite
 * Four line-up, topped up (only if needed) with types that existed in that
 * generation, so no Gen 1 question offers Fairy. Never a type the trainer
 * is known for anywhere.
 */
function typeDistractors(gen: number, siblings: (string | undefined)[], answer: string, person: string): string[] {
  const exclude = PERSON_TYPES.get(person) ?? [];
  const own = pool(siblings, answer, exclude);
  if (own.length >= 3) return own;
  const existing = ALL_TYPES.filter((t) => !(gen < 2 && (t === "Dark" || t === "Steel")) && !(gen < 6 && t === "Fairy"));
  return pool([...own, ...existing], answer, exclude);
}

const FAMILY_DIFFICULTY: Record<string, Difficulty> = {
  kanto: "easy", johto: "medium", hoenn: "medium", sinnoh: "medium", unova: "medium", unova2: "hard",
  kalos: "medium", alola: "hard", galar: "medium", paldea: "medium",
};

function gymItems(): TriviaItem[] {
  const rows = GYMS as GymRow[];
  const items: TriviaItem[] = [];
  let n = 0;
  rows.forEach((r, index) => {
    if (r.ask === false) return;
    const family = rows.filter((o) => o.family === r.family);
    const base = FAMILY_DIFFICULTY[r.family];
    const rotation = ["leader", "type", "leader", r.badge ? "badge" : "place"][n++ % 4];
    const kind = rotation === "type" && !r.type ? "leader" : rotation;
    const common = { topic: "gyms", group: r.gen, source: r.source };
    const id = `gym-${slug(r.game)}-${slug(r.place)}-${kind}`;
    if (kind === "leader") {
      items.push({
        ...common, id, difficulty: base,
        prompt: `In ${r.game}, who is the ${r.place} Gym Leader?`,
        answer: r.leader,
        distractors: pool(family.filter((o) => o.place !== r.place).map((o) => o.leader), r.leader),
        explanation: `${r.leader} leads the ${r.place} Gym in ${r.game}.`,
        from: { table: "gyms", index, field: "leader" },
        loc: (L) => {
          const v = { game: gameIn(L, r.game), place: placeIn(L, r.place), leader: personIn(L, r.leader) };
          return { prompt: L.t("trivia.gym.leaderPrompt", v), explanation: L.t("trivia.gym.explanation", v), option: (o) => L.proper(o) };
        },
      });
    } else if (kind === "type") {
      items.push({
        ...common, id, difficulty: base,
        prompt: `In ${r.game}, which type does Gym Leader ${r.leader} specialize in?`,
        answer: r.type!,
        distractors: typeDistractors(r.gen, family.map((o) => o.type), r.type!, r.leader),
        explanation: `${r.leader} is ${aOrAn(r.type!)} ${r.type}-type specialist in ${r.game}.`,
        from: { table: "gyms", index, field: "type" },
        loc: (L) => {
          const v = { game: gameIn(L, r.game), leader: personIn(L, r.leader), type: typeIn(L, r.type!) };
          return { prompt: L.t("trivia.gym.typePrompt", v), explanation: L.t("trivia.gym.typeExplanation", v), option: (o) => typeIn(L, o) };
        },
      });
    } else if (kind === "badge") {
      items.push({
        ...common, id, difficulty: harder(base, r.family === "kanto" ? 1 : 2),
        prompt: `In ${r.game}, which Badge does ${r.leader} award?`,
        answer: r.badge!,
        distractors: pool(family.filter((o) => o.place !== r.place).map((o) => o.badge), r.badge!),
        explanation: `${r.leader} awards the ${r.badge} at the ${r.place} Gym.`,
        from: { table: "gyms", index, field: "badge" },
      });
    } else {
      items.push({
        ...common, id, difficulty: harder(base),
        prompt: `In ${r.game}, where is ${r.leader}'s Gym?`,
        answer: r.place,
        distractors: pool(family.map((o) => o.place), r.place),
        explanation: `${r.leader} leads the ${r.place} Gym in ${r.game}.`,
        from: { table: "gyms", index, field: "place" },
        loc: (L) => {
          const v = { game: gameIn(L, r.game), place: placeIn(L, r.place), leader: personIn(L, r.leader) };
          return { prompt: L.t("trivia.gym.placePrompt", v), explanation: L.t("trivia.gym.explanation", v), option: (o) => L.name("locations", o) ?? L.proper(o) };
        },
      });
    }
  });
  return items;
}

function eliteFourItems(): TriviaItem[] {
  // Two questions per Elite Four (one of each kind); every member still serves as a distractor.
  return ELITE_FOUR.flatMap((r, index): TriviaItem[] => {
    if (index % 4 >= 2) return [];
    const family = ELITE_FOUR.filter((o) => o.family === r.family);
    const common = { topic: "elite-four", group: r.gen, source: r.source, difficulty: FAMILY_DIFFICULTY[r.family] };
    if (index % 2 === 0) {
      return [{
        ...common,
        id: `e4-${slug(r.game)}-${slug(r.member)}-type`,
        prompt: `In ${r.game}, which type does Elite Four member ${r.member} specialize in?`,
        answer: r.type,
        distractors: typeDistractors(r.gen, family.map((o) => o.type), r.type, r.member),
        explanation: `${r.member} of the Elite Four specializes in ${r.type}-type Pokémon.`,
        from: { table: "elite-four", index, field: "type" },
        loc: (L) => {
          const v = { game: gameIn(L, r.game), member: personIn(L, r.member), type: typeIn(L, r.type) };
          return { prompt: L.t("trivia.e4.typePrompt", v), explanation: L.t("trivia.e4.typeExplanation", v), option: (o) => typeIn(L, o) };
        },
      }];
    }
    return [{
      ...common,
      id: `e4-${slug(r.game)}-${slug(r.type)}-member`,
      prompt: `In ${r.game}, which Elite Four member specializes in ${r.type}-type Pokémon?`,
      answer: r.member,
      distractors: pool(family.filter((o) => o.type !== r.type).map((o) => o.member), r.member),
      explanation: `${r.member} is the ${r.type}-type specialist of the Elite Four.`,
      from: { table: "elite-four", index, field: "member" },
      loc: (L) => {
        const v = { game: gameIn(L, r.game), member: personIn(L, r.member), type: typeIn(L, r.type) };
        return { prompt: L.t("trivia.e4.memberPrompt", v), explanation: L.t("trivia.e4.memberExplanation", v), option: (o) => L.proper(o) };
      },
    }];
  });
}

function championItems(): TriviaItem[] {
  return CHAMPIONS.map((r, index) => {
    const row = r as typeof r & { avoid?: string[]; title?: string };
    const title = row.title ?? "Champion";
    return {
      id: `champion-${slug(r.game)}`,
      topic: "champions",
      group: r.gen,
      difficulty: row.avoid ? "medium" : r.gen <= 4 ? "easy" : "medium",
      prompt: `Who is the Pokémon League ${title} in ${r.game}?`,
      answer: r.champion,
      distractors: pool(CHAMPIONS.map((o) => o.champion), r.champion, row.avoid),
      explanation: `${r.champion} is the ${title} in ${r.game}.`,
      source: r.source,
      from: { table: "champions", index, field: "champion" },
      // Paldea's Top Champion is a rank of its own (Nemona is a Champion too): asked in English only.
      loc: row.title
        ? undefined
        : (L) => {
            const v = { game: gameIn(L, r.game), champion: personIn(L, r.champion) };
            return { prompt: L.t("trivia.champion.prompt", v), explanation: L.t("trivia.champion.explanation", v), option: (o) => L.proper(o) };
          },
    } as TriviaItem;
  });
}

function professorItems(): TriviaItem[] {
  return PROFESSORS.map((r, index) => {
    const avoid = (r as typeof r & { avoid?: string[] }).avoid;
    return {
      id: `professor-${slug(r.game)}`,
      topic: "professors",
      group: r.gen,
      difficulty: r.gen <= 4 ? "easy" : r.gen >= 8 ? "medium" : "easy",
      prompt: `Who is the regional Pokémon Professor in ${r.game}?`,
      answer: r.professor,
      distractors: pool(PROFESSORS.map((o) => o.professor), r.professor, avoid),
      explanation: `${r.professor} is the Pokémon Professor in ${r.game}.`,
      source: r.source,
      from: { table: "professors", index, field: "professor" },
      loc: (L) => {
        const v = { game: gameIn(L, r.game), professor: personIn(L, r.professor) };
        return { prompt: L.t("trivia.professor.prompt", v), explanation: L.t("trivia.professor.explanation", v), option: (o) => L.proper(o) };
      },
    } as TriviaItem;
  });
}

function starterItems(): TriviaItem[] {
  const kinds = ["grass", "fire", "water"] as const;
  return STARTERS.map((r, index) => {
    const kind = kinds[index % 3];
    const label = kind[0].toUpperCase() + kind.slice(1);
    const answer = r[kind];
    return {
      id: `starter-${slug(r.game)}-${kind}`,
      topic: "starters",
      group: r.gen,
      difficulty: r.gen <= 3 || r.gen === 9 ? "easy" : "medium",
      prompt: `In ${r.game}, which Pokémon is the ${label}-type starter?`,
      answer,
      // Other games' starters of the same type; none of this game's three.
      distractors: pool(STARTERS.map((o) => o[kind]), answer, kinds.map((k) => r[k])),
      explanation: `${r.game} lets you choose ${r.grass}, ${r.fire} or ${r.water}.`,
      source: r.source,
      from: { table: "starters", index, field: kind },
      loc: (L) => {
        const mon = (n: string) => must(L.pokemonNamed(n), n);
        const game = gameIn(L, r.game);
        return {
          prompt: L.t("trivia.starter.prompt", { game, type: L.type(kind) }),
          explanation: L.t("trivia.starter.explanation", { game, grass: mon(r.grass), fire: mon(r.fire), water: mon(r.water) }),
          option: (o) => L.pokemonNamed(o),
        };
      },
    } as TriviaItem;
  });
}

function boxArtItems(): TriviaItem[] {
  const relatedOf = (r: (typeof BOX_ART)[number]) => (r as typeof r & { related?: string[] }).related ?? [];
  return BOX_ART.map((r, index) => {
    // Fusions count as their parts both ways: Dusk Mane Necrozma is never a distractor for Sun.
    const related = new Set([r.species, ...relatedOf(r)]);
    const clash = (o: (typeof BOX_ART)[number]) => related.has(o.species) || relatedOf(o).includes(r.species);
    return {
      id: `box-${slug(r.game)}`,
      topic: "box-art",
      group: r.gen,
      difficulty: r.gen <= 4 ? "easy" : r.gen === 7 && related.size > 1 ? "hard" : "medium",
      prompt: `Which Pokémon appears on the box art of ${r.game}?`,
      answer: r.pokemon,
      distractors: pool(
        BOX_ART.filter((o) => !clash(o)).map((o) => o.pokemon),
        r.pokemon
      ),
      explanation: `${r.pokemon} is the mascot of ${r.game}.`,
      source: r.source,
      from: { table: "box-art", index, field: "pokemon" },
      loc: (L) => {
        const v = { game: gameIn(L, r.game), pokemon: must(L.pokemonNamed(r.pokemon) ?? L.proper(r.pokemon), r.pokemon) };
        return { prompt: L.t("trivia.boxArt.prompt", v), explanation: L.t("trivia.boxArt.explanation", v), option: (o) => L.pokemonNamed(o) ?? L.proper(o) };
      },
    } as TriviaItem;
  });
}

function exclusiveItems(): TriviaItem[] {
  const items: TriviaItem[] = [];
  EXCLUSIVES.forEach((r, index) => {
    const perSide = r.onlyA.length >= 6 ? 2 : 1;
    for (const [mine, theirs, side, other, field] of [
      [r.onlyA, r.onlyB, r.a, r.b, "onlyA"],
      [r.onlyB, r.onlyA, r.b, r.a, "onlyB"],
    ] as const) {
      for (let k = 0; k < perSide; k++) {
        items.push({
          id: `exclusive-${slug(side)}-${slug(mine[k])}`,
          topic: "exclusives",
          group: r.gen,
          difficulty: r.gen <= 2 ? "medium" : "hard",
          prompt: `Which of these Pokémon is exclusive to ${side}, compared with ${other}?`,
          answer: mine[k],
          distractors: pool(theirs, mine[k], mine),
          explanation: `${mine[k]} is exclusive to ${side}.`,
          source: r.source,
          from: { table: "exclusives", index, field: `${field}.${k}` },
          loc: (L) => {
            // Japan's first pair is Red and Green: the West's Blue has Green's Pokémon.
            const title = (t: string) => gameIn(L, L.locale === "ja" && t === "Pokémon Blue" ? "Pokémon Green" : t);
            const v = { side: title(side), other: title(other), pokemon: must(L.pokemonNamed(mine[k]), mine[k]) };
            return { prompt: L.t("trivia.exclusive.prompt", v), explanation: L.t("trivia.exclusive.explanation", v), option: (o) => L.pokemonNamed(o) };
          },
        });
      }
    }
  });
  return items;
}

function villainItems(): TriviaItem[] {
  const items: TriviaItem[] = VILLAINS.map((r, index) => {
    const reverse = (r as typeof r & { ask?: string }).ask === "team" || index % 2 === 1;
    const common = { topic: "villains", group: r.gen, source: r.source, difficulty: (r.gen <= 4 ? "easy" : "medium") as Difficulty };
    return reverse
      ? {
          ...common,
          id: `villain-${slug(r.leader)}-team`,
          prompt: `In ${r.game}, which organization is led by ${r.leader}?`,
          answer: r.team,
          distractors: pool(VILLAINS.map((o) => o.team), r.team),
          explanation: `${r.leader} leads ${r.team}.`,
          from: { table: "villains", index, field: "team" },
          loc: (L) => {
            const v = { game: gameIn(L, r.game), leader: personIn(L, r.leader), team: personIn(L, r.team) };
            return { prompt: L.t("trivia.villain.teamPrompt", v), explanation: L.t("trivia.villain.explanation", v), option: (o) => L.proper(o) };
          },
        }
      : {
          ...common,
          id: `villain-${slug(r.team)}-leader`,
          prompt: `In ${r.game}, who leads ${r.team}?`,
          answer: r.leader,
          distractors: pool(VILLAINS.map((o) => o.leader), r.leader),
          explanation: `${r.leader} leads ${r.team}.`,
          from: { table: "villains", index, field: "leader" },
          loc: (L) => {
            const v = { game: gameIn(L, r.game), leader: personIn(L, r.leader), team: personIn(L, r.team) };
            return { prompt: L.t("trivia.villain.leaderPrompt", v), explanation: L.t("trivia.villain.explanation", v), option: (o) => L.proper(o) };
          },
        };
  });
  TEAM_STAR.forEach((r, index) =>
    items.push({
      id: `team-star-${slug(r.boss)}`,
      topic: "villains",
      group: 9,
      difficulty: "hard",
      prompt: `In Pokémon Scarlet and Violet, which type does Team Star boss ${r.boss} use?`,
      answer: r.type,
      distractors: pool(TEAM_STAR.map((o) => o.type), r.type),
      explanation: `${r.boss} leads Team Star's ${r.squad}, ${aOrAn(r.type)} ${r.type}-type crew.`,
      source: r.source,
      from: { table: "team-star", index, field: "type" },
      loc: (L) => {
        const v = { game: gameIn(L, "Pokémon Scarlet and Violet"), boss: personIn(L, r.boss), team: personIn(L, "Team Star"), type: typeIn(L, r.type) };
        return { prompt: L.t("trivia.teamStar.prompt", v), explanation: L.t("trivia.teamStar.explanation", v), option: (o) => typeIn(L, o) };
      },
    })
  );
  return items;
}

const genLabel = (g: number) => `Generation ${ROMAN[g]}`;
/** Each mechanic's message key (its name is a phrase of its own in every language). */
const MECHANIC_KEY: Record<string, "abilities" | "natures" | "doubles" | "contests" | "heldItems" | "breeding" | "shiny" | "steelDark" | "split" | "gts" | "hiddenAbilities" | "triples" | "fairy" | "mega" | "zMoves" | "dynamax" | "tera"> = {
  Abilities: "abilities",
  Natures: "natures",
  "Double Battles": "doubles",
  "Pokémon Contests": "contests",
  "held items": "heldItems",
  "Pokémon breeding and Eggs": "breeding",
  "Shiny Pokémon": "shiny",
  "the Steel and Dark types": "steelDark",
  "the physical/special split": "split",
  "the Global Trade Station (GTS)": "gts",
  "Hidden Abilities": "hiddenAbilities",
  "Triple Battles": "triples",
  "the Fairy type": "fairy",
  "Mega Evolution": "mega",
  "Z-Moves": "zMoves",
  Dynamax: "dynamax",
  Terastallization: "tera",
};
/** The real places the regions are modelled on. */
const BASIS_KEY: Record<string, "kyushu" | "hokkaido" | "newYork" | "france" | "hawaii" | "britain" | "iberia"> = {
  Kyushu: "kyushu",
  Hokkaido: "hokkaido",
  "New York City": "newYork",
  France: "france",
  Hawaii: "hawaii",
  "Great Britain": "britain",
  "the Iberian Peninsula": "iberia",
};
/** Gimmicks whose debut games are well known enough to ask about by title. */
const ASK_GAMES = new Set(["Abilities", "the physical/special split", "Mega Evolution", "Z-Moves", "Dynamax", "Terastallization"]);

function mechanicItems(): TriviaItem[] {
  const items: TriviaItem[] = [];
  MECHANICS.forEach((r, index) => {
    const nearby = [r.gen - 1, r.gen + 1, r.gen - 2, r.gen + 2, r.gen - 3, r.gen + 3].filter((g) => g >= 1 && g <= 9);
    items.push({
      id: `mechanic-${slug(r.name)}-gen`,
      topic: "mechanics",
      group: r.gen,
      difficulty: r.gen >= 6 ? "easy" : "medium",
      prompt: `Which generation introduced ${r.name}?`,
      answer: genLabel(r.gen),
      distractors: pool(nearby.map(genLabel), genLabel(r.gen)),
      explanation: `${r.name[0].toUpperCase()}${r.name.slice(1)} debuted in ${r.games} (${genLabel(r.gen)}).`,
      source: r.source,
      from: { table: "mechanics", index, field: "gen" },
      loc: (L) => {
        const v = { name: L.t(`trivia.mechanic.${MECHANIC_KEY[r.name]}`), games: gameIn(L, r.games), gen: genIn(L, r.gen) };
        return { prompt: L.t("trivia.mechanic.genPrompt", v), explanation: L.t("trivia.mechanic.genExplanation", v), option: (o) => genOption(L, o) };
      },
    });
    if (ASK_GAMES.has(r.name)) {
      items.push({
        id: `mechanic-${slug(r.name)}-games`,
        topic: "mechanics",
        group: r.gen,
        difficulty: r.gen >= 6 ? "easy" : "medium",
        prompt: `Which games introduced ${r.name}?`,
        answer: r.games,
        distractors: pool(MECHANICS.filter((o) => o.gen !== r.gen).map((o) => o.games), r.games),
        explanation: `${r.name[0].toUpperCase()}${r.name.slice(1)} debuted in ${r.games}.`,
        source: r.source,
        from: { table: "mechanics", index, field: "games" },
        loc: (L) => {
          const v = { name: L.t(`trivia.mechanic.${MECHANIC_KEY[r.name]}`), games: gameIn(L, r.games) };
          return { prompt: L.t("trivia.mechanic.gamesPrompt", v), explanation: L.t("trivia.mechanic.gamesExplanation", v), option: (o) => L.game(o) };
        },
      });
    }
  });
  return items;
}

const REGION_NAMES = [...new Set(GAMES.map((g) => g.region))];
/** Hisui is Sinnoh long ago: never a wrong answer for a Sinnoh game, and the other way round. */
const SAME_LAND: Record<string, string[]> = { Sinnoh: ["Hisui"], Hisui: ["Sinnoh"] };

/** Sets of games from different generations: the answer is the one released first (lowest generation). */
export const RELEASE_ORDER_SETS: string[][] = [
  ["Pokémon Gold and Silver", "Pokémon Ruby and Sapphire", "Pokémon Diamond and Pearl", "Pokémon X and Y"],
  ["Pokémon Emerald", "Pokémon Platinum", "Pokémon Black 2 and White 2", "Pokémon Sun and Moon"],
  ["Pokémon Yellow", "Pokémon Crystal", "Pokémon FireRed and LeafGreen", "Pokémon HeartGold and SoulSilver"],
  ["Pokémon Black and White", "Pokémon X and Y", "Pokémon Sword and Shield", "Pokémon Scarlet and Violet"],
  ["Pokémon Omega Ruby and Alpha Sapphire", "Pokémon Ultra Sun and Ultra Moon", "Pokémon Brilliant Diamond and Shining Pearl", "Pokémon Legends: Z-A"],
  ["Pokémon: Let's Go, Pikachu! and Let's Go, Eevee!", "Pokémon Legends: Arceus", "Pokémon Scarlet and Violet", "Pokémon Legends: Z-A"],
];

function gameItems(): TriviaItem[] {
  const items: TriviaItem[] = [];
  // Paired versions share a region: ask once per pair.
  const skipRegion = new Set(["Pokémon Yellow", "Pokémon Crystal", "Pokémon Platinum", "Pokémon Ultra Sun and Ultra Moon"]);
  GAMES.forEach((r, index) => {
    const also = (r as typeof r & { alsoRegions?: string[] }).alsoRegions ?? [];
    if (!skipRegion.has(r.title)) items.push({
      id: `region-of-${slug(r.title)}`,
      topic: "regions",
      group: r.gen,
      difficulty: r.gen <= 4 ? "easy" : "medium",
      prompt: `In which region is ${r.title} set?`,
      answer: r.region,
      distractors: pool(REGION_NAMES, r.region, [...also, ...(SAME_LAND[r.region] ?? [])]),
      explanation: `${r.title} is set in the ${r.region} region.`,
      source: r.source,
      from: { table: "games", index, field: "region" },
      loc: (L) => {
        const v = { title: gameIn(L, r.title), region: regionIn(L, r.region) };
        return { prompt: L.t("trivia.games.regionPrompt", v), explanation: L.t("trivia.games.regionExplanation", v), option: (o) => L.name("regions", o) };
      },
    });
    if ((r as typeof r & { askGen?: boolean }).askGen) {
      const nearby = [r.gen - 1, r.gen + 1, r.gen - 2, r.gen + 2, r.gen - 3].filter((g) => g >= 1 && g <= 9);
      items.push({
        id: `gen-of-${slug(r.title)}`,
        topic: "release",
        group: r.gen,
        difficulty: "hard",
        prompt: `Which generation does ${r.title} belong to?`,
        answer: genLabel(r.gen),
        distractors: pool(nearby.map(genLabel), genLabel(r.gen)),
        explanation: `${r.title} is a ${genLabel(r.gen)} game.`,
        source: r.source,
        from: { table: "games", index, field: "gen" },
        loc: (L) => {
          const v = { title: gameIn(L, r.title), gen: genIn(L, r.gen) };
          return { prompt: L.t("trivia.games.genPrompt", v), explanation: L.t("trivia.games.genExplanation", v), option: (o) => genOption(L, o) };
        },
      });
    }
  });
  RELEASE_ORDER_SETS.forEach((set, k) => {
    const rows = set.map((title) => GAMES.find((g) => g.title === title)!);
    const first = rows.reduce((a, b) => (b.gen < a.gen ? b : a));
    items.push({
      id: `release-order-${k}`,
      topic: "release",
      group: first.gen,
      difficulty: k < 2 ? "easy" : "medium",
      prompt: "Which of these games came out first?",
      answer: first.title,
      distractors: pool(set, first.title),
      explanation: `${first.title} is a ${genLabel(first.gen)} game, older than the others.`,
      source: first.source,
      from: { table: "games", index: GAMES.indexOf(first), field: "title" },
      loc: (L) => {
        const v = { title: gameIn(L, first.title), gen: genIn(L, first.gen) };
        return { prompt: L.t("trivia.games.firstPrompt"), explanation: L.t("trivia.games.firstExplanation", v), option: (o) => L.game(o) };
      },
    });
  });
  REGIONS.forEach((r, index) =>
    items.push({
      id: `region-basis-${slug(r.region)}`,
      topic: "regions",
      group: r.gen,
      difficulty: "medium",
      prompt: `Which real-world place inspired the ${r.region} region?`,
      answer: r.basis,
      distractors: pool(REGIONS.map((o) => o.basis), r.basis),
      explanation: `${r.region} is based on ${r.basis}.`,
      source: r.source,
      from: { table: "regions", index, field: "basis" },
      loc: (L) => {
        const v = { region: regionIn(L, r.region), basis: L.t(`trivia.basis.${BASIS_KEY[r.basis]}`) };
        return { prompt: L.t("trivia.games.basisPrompt", v), explanation: L.t("trivia.games.basisExplanation", v), option: (o) => (BASIS_KEY[o] ? L.t(`trivia.basis.${BASIS_KEY[o]}`) : undefined) };
      },
    })
  );
  const placeRegions = [...new Set(PLACES.map((p) => p.region))];
  PLACES.forEach((r, index) =>
    items.push({
      id: `place-${slug(r.place)}`,
      topic: "places",
      group: r.gen,
      difficulty: r.difficulty as Difficulty,
      prompt: `In which region is ${r.place}?`,
      answer: r.region,
      distractors: pool(placeRegions, r.region),
      explanation: `${r.place} is in the ${r.region} region.`,
      source: r.source,
      from: { table: "places", index, field: "region" },
      loc: (L) => {
        const v = { place: placeIn(L, r.place), region: regionIn(L, r.region) };
        return { prompt: L.t("trivia.games.placePrompt", v), explanation: L.t("trivia.games.placeExplanation", v), option: (o) => L.name("regions", o) };
      },
    })
  );
  return items;
}

function handwrittenItems(): TriviaItem[] {
  return (HANDWRITTEN as (HandwrittenRow & { gen: number })[]).map((r) => ({
    id: r.id,
    topic: r.topic,
    group: r.gen,
    difficulty: r.difficulty,
    prompt: r.prompt,
    answer: r.answer,
    distractors: r.distractors,
    source: r.source,
    explanation: r.explanation,
    loc: handwrittenLoc("games", r),
  }));
}

export const GAMES_BANK: TriviaItem[] = [
  ...gymItems(),
  ...eliteFourItems(),
  ...championItems(),
  ...professorItems(),
  ...starterItems(),
  ...boxArtItems(),
  ...exclusiveItems(),
  ...villainItems(),
  ...mechanicItems(),
  ...gameItems(),
  ...handwrittenItems(),
];

/** Data tables behind generated questions, for the integrity tests and scripts/quiz-verify.ts. */
export const GAMES_TABLES: Record<string, readonly object[]> = {
  games: GAMES, gyms: GYMS, "elite-four": ELITE_FOUR, champions: CHAMPIONS, professors: PROFESSORS,
  starters: STARTERS, "box-art": BOX_ART, exclusives: EXCLUSIVES, villains: VILLAINS, "team-star": TEAM_STAR,
  mechanics: MECHANICS, regions: REGIONS, places: PLACES,
};
