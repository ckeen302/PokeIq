import { Rng } from "@/lib/rng";
import { AXES, type Answer, type Axis, type Profile, type Question } from "./types";

/**
 * The question bank: in-world scenario statements modelled on public-domain
 * IPIP items (one trait per statement, half of them reverse-keyed), rated on
 * a five-point "Not me at all" to "Totally me" scale. Six per axis, three
 * keyed each way; a run draws eighteen (two per axis, one of each keying,
 * plus four more) and up to two tie-breakers.
 */

const q = (id: string, axis: Axis, key: 1 | -1, text: string): Question => ({ id, axis, key, text });

export const QUESTION_BANK: readonly Question[] = [
  // Extraversion
  q("e1", "extraversion", 1, "After a long day of training, you'd rather celebrate at a packed Pokémon Center than rest alone."),
  q("e2", "extraversion", 1, "You're the trainer who starts the chant in the stadium crowd."),
  q("e3", "extraversion", 1, "On a new route, you talk to every trainer you pass, not just the ones who challenge you."),
  q("e4", "extraversion", -1, "You'd happily spend a week in a quiet cave with a good book and one Pokémon."),
  q("e5", "extraversion", -1, "At a big town festival, you drift to the edge of the crowd and watch."),
  q("e6", "extraversion", -1, "Long conversations with strangers at the Pokémon Center drain you."),
  // Agreeableness
  q("a1", "agreeableness", 1, "You'd give your last Potion to a rival's injured Pokémon without thinking twice."),
  q("a2", "agreeableness", 1, "When a wild Pokémon is cornered, your first instinct is to calm it, not catch it."),
  q("a3", "agreeableness", 1, "You'd stop mid-journey to help a lost kid find their Pokémon, badge deadline or not."),
  q("a4", "agreeableness", -1, "If a trainer blocks the bridge, you push past rather than wait your turn."),
  q("a5", "agreeableness", -1, "You keep score of favours, and you expect them returned."),
  q("a6", "agreeableness", -1, "Teasing a nervous trainer before a battle feels like fair game to you."),
  // Conscientiousness
  q("c1", "conscientiousness", 1, "Your bag is sorted: Potions in one pocket, Poké Balls in another, badges polished."),
  q("c2", "conscientiousness", 1, "You plan the whole route through Victory Road before taking a single step."),
  q("c3", "conscientiousness", 1, "You train every single day, even when nobody is watching."),
  q("c4", "conscientiousness", -1, "You've walked into a Gym with no idea what type the leader uses."),
  q("c5", "conscientiousness", -1, "Your Pokémon's held items are whatever happened to be in your bag."),
  q("c6", "conscientiousness", -1, "Gym schedules, ferry times, league deadlines: close enough is good enough."),
  // Openness
  q("o1", "openness", 1, "A strange ruin with glowing symbols? You're inside before anyone can stop you."),
  q("o2", "openness", 1, "You'd rather learn a weird new move than master an old reliable one."),
  q("o3", "openness", 1, "You've genuinely wondered what the Unown are trying to say."),
  q("o4", "openness", -1, "You like the Pokémon you've always liked; new regions can keep their novelties."),
  q("o5", "openness", -1, "You've used the same team for years and see no reason to change it."),
  q("o6", "openness", -1, "Legends, dreams, mysteries: you'd rather deal with what's in front of you."),
  // Emotional stability
  q("s1", "stability", 1, "When your last Pokémon is at 1 HP, your hands stay steady."),
  q("s2", "stability", 1, "A loss at the Pokémon League stings for an afternoon, then it's gone."),
  q("s3", "stability", 1, "Storms, Ghost-types, dark forests: you're hard to rattle."),
  q("s4", "stability", -1, "One critical hit against you can ruin your whole day."),
  q("s5", "stability", -1, "Before a Gym battle, your stomach is in knots."),
  q("s6", "stability", -1, "You replay a lost battle in your head for days."),
  // Competitiveness
  q("k1", "competitiveness", 1, "You've reset a run because your starter's nature wasn't perfect."),
  q("k2", "competitiveness", 1, "Being the very best, like no one ever was, is a real goal for you, not a song."),
  q("k3", "competitiveness", 1, "A friendly battle still has a winner, and it had better be you."),
  q("k4", "competitiveness", -1, "You'd rather raise a happy team than a strong one."),
  q("k5", "competitiveness", -1, "Contests, battles, races: you join for the fun and forget who won."),
  q("k6", "competitiveness", -1, "When a rival wants a rematch, you'd honestly rather go get lunch."),
  // Independence vs loyalty
  q("i1", "independence", 1, "You'd set out on your journey alone before you'd wait around for a travel companion."),
  q("i2", "independence", 1, "You'd leave a trainer who holds you back, even one you like."),
  q("i3", "independence", 1, "You make your own rules on the road; a Gym Leader's advice is optional."),
  q("i4", "independence", -1, "You'd give up a badge before you'd leave a friend behind."),
  q("i5", "independence", -1, "You stay with the same travel companions for the whole journey."),
  q("i6", "independence", -1, "One trainer, for life: that's the only kind of bond you'd want."),
];

/** Questions in a run before any tie-breaker. */
export const RUN_LENGTH = 18;
/** Tie-breakers asked when the top two matches are within TIE_MARGIN points. */
export const TIE_BREAKERS_MAX = 2;
export const TIE_MARGIN = 2;

const BY_ID = new Map(QUESTION_BANK.map((qq) => [qq.id, qq]));
export const questionById = (id: string): Question | undefined => BY_ID.get(id);

/**
 * Draws a run: for each axis one + and one − item, then four more from the
 * rest (never a fourth item on one axis), shuffled. Seeded, so a test can
 * reproduce a draw.
 */
export function drawQuestions(seed: string | number = Date.now()): Question[] {
  const rng = new Rng(seed);
  const picked: Question[] = [];
  for (const axis of AXES) {
    for (const key of [1, -1] as const) {
      picked.push(rng.pick(QUESTION_BANK.filter((qq) => qq.axis === axis && qq.key === key)));
    }
  }
  const perAxis = new Map<Axis, number>(AXES.map((a) => [a, 2]));
  let rest = rng.shuffle(QUESTION_BANK.filter((qq) => !picked.includes(qq)));
  while (picked.length < RUN_LENGTH && rest.length) {
    const next = rest.find((qq) => (perAxis.get(qq.axis) ?? 0) < 3)!;
    picked.push(next);
    perAxis.set(next.axis, (perAxis.get(next.axis) ?? 0) + 1);
    rest = rest.filter((qq) => qq !== next);
  }
  return rng.shuffle(picked);
}

/** One answer to one question. */
export interface Response {
  id: string;
  answer: Answer;
}

/** The seven scores from a set of answers: 50 + 25 × the mean keyed deviation on each axis (0–100). */
export function scoreResponses(responses: readonly Response[]): Profile {
  const sum = new Map<Axis, number>();
  const n = new Map<Axis, number>();
  for (const r of responses) {
    const qq = BY_ID.get(r.id);
    if (!qq) continue;
    sum.set(qq.axis, (sum.get(qq.axis) ?? 0) + qq.key * (r.answer - 3));
    n.set(qq.axis, (n.get(qq.axis) ?? 0) + 1);
  }
  return AXES.map((axis) => {
    const count = n.get(axis) ?? 0;
    return count ? Math.round(50 + (25 * (sum.get(axis) ?? 0)) / count) : 50;
  }) as unknown as Profile;
}

/**
 * The tie-breaker: an unasked question on the axis where the two leading
 * profiles differ most, keyed in whichever direction the asked items on that
 * axis have used less. Null when every item on that axis has been asked.
 */
export function tieBreaker(asked: readonly string[], a: Profile, b: Profile): Question | null {
  const askedSet = new Set(asked);
  const order = AXES.map((axis, i) => ({ axis, gap: Math.abs(a[i] - b[i]) })).sort((x, y) => y.gap - x.gap);
  for (const { axis } of order) {
    const items = QUESTION_BANK.filter((qq) => qq.axis === axis);
    const used = items.filter((qq) => askedSet.has(qq.id));
    const plus = used.filter((qq) => qq.key === 1).length;
    const minus = used.length - plus;
    const open = items.filter((qq) => !askedSet.has(qq.id));
    if (!open.length) continue;
    const wantKey = plus > minus ? -1 : 1;
    return open.find((qq) => qq.key === wantKey) ?? open[0];
  }
  return null;
}
