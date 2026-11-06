/**
 * The answers the hero recordings play towards, worked out by the site's own
 * code (the browser never gets them). Run with the server's POKEIQ_SECRET:
 *
 *   npx tsx --conditions=react-server scripts/hero-videos/answers.ts pokedle 2026-10-28
 *   npx tsx --conditions=react-server scripts/hero-videos/answers.ts pokedle-days 2026-10-17 2026-11-06
 *
 * pokedle: the day's answer and a good player's route to it: an opener, then
 * only guesses that fit every clue so far (as if each were the answer, the
 * earlier guesses would have got the same clues), solved on the fourth.
 */
import { POKEDEX, getPokemon, type Pokemon } from "@/lib/pokemon/pokedex";
import { compare, dailyPuzzleOf, answerFor } from "@/lib/server/pokedle";

const [what, ...args] = process.argv.slice(2);

const sig = (g: Pokemon, a: Pokemon) => JSON.stringify(Object.values(compare(g, a).cells).map((c) => c.status));

/** Well-known Pokémon a player reaches for first (starters, mascots, fan favourites). */
const FAMOUS = [25, 6, 9, 3, 94, 143, 131, 133, 150, 448, 445, 658, 282, 248, 149, 130, 59, 197, 196, 700, 384, 249, 250, 157, 160, 154, 257, 260, 254, 392, 395, 389, 609, 635, 637, 663, 778, 887, 908, 911, 914, 6, 65, 68, 76, 112, 121, 123, 127, 135, 134, 136, 142, 144, 145, 146, 151, 181, 212, 214, 229, 230, 242, 243, 244, 245, 306, 330, 334, 350, 359, 373, 376, 380, 381, 382, 383, 405, 407, 409, 411, 425, 430, 442, 461, 462, 466, 467, 468, 472, 473, 474, 475, 477, 479, 491, 493, 497, 500, 503, 530, 553, 571, 612, 623, 625, 643, 644, 646, 652, 655, 681, 697, 706, 715, 716, 717, 724, 727, 730, 745, 760, 784, 800, 812, 815, 818, 823, 849, 884, 888, 889, 890, 937, 959, 970, 987, 998, 1000, 1007, 1008];

function route(answer: Pokemon, openers = [25, 6, 94, 143, 448, 133]): Pokemon[] | null {
  for (const op of openers) {
    const opener = getPokemon(op)!;
    if (opener.id === answer.id) continue;
    const path = [opener];
    for (let step = 0; step < 3; step++) {
      const fits = POKEDEX.filter((c) => !path.some((p) => p.id === c.id) && path.every((g) => sig(g, c) === sig(g, answer)));
      if (step === 2) {
        if (!fits.some((c) => c.id === answer.id)) break;
        path.push(answer);
        return path;
      }
      // A guess that fits but isn't the answer, famous if possible, that leaves the answer in reach.
      const pick = fits
        .filter((c) => c.id !== answer.id)
        .sort((a, b) => {
          const fa = FAMOUS.indexOf(a.id);
          const fb = FAMOUS.indexOf(b.id);
          return (fa < 0 ? 999 : fa) - (fb < 0 ? 999 : fb) || a.id - b.id;
        })[0];
      if (!pick) break;
      path.push(pick);
    }
  }
  return null;
}

if (what === "pokedle") {
  const date = args[0];
  const answer = answerFor(dailyPuzzleOf(date));
  const path = route(answer);
  console.log(JSON.stringify({ date, answer: { id: answer.id, name: answer.name }, guesses: path?.map((p) => ({ id: p.id, name: p.name, row: Object.values(compare(p, answer).cells).map((c) => c.status) })) }));
} else if (what === "pokedle-days") {
  const [from, to] = args;
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    const date = d.toISOString().slice(0, 10);
    const a = answerFor(dailyPuzzleOf(date));
    console.log(date, a.id, a.name, route(a) ? "route" : "-");
  }
}
