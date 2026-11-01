import { describe, expect, it } from "vitest";
import fs from "node:fs";
import ROUNDS from "@/data/trainer-teams.json";
import NAMES from "@/data/trainer-team-names.json";
import pokedex from "@/data/pokedex.json";
import { buildQuestion } from "@/engines";
import { isValidQuestion } from "@/engines/validate";
import { roundsFor, TEAM_ROUNDS, teamQuestion } from "@/engines/modules/whose-team";
import { Rng } from "@/lib/rng";
import { ANSWER_NAMES, monLabel, resolveGuess, revealFactor, revealOrder, suggest, teamKey, type TeamEntry } from "@/lib/whose-team";
import { gradeAnswer, questionAt, readSession, revealCard, revealClaimKey, startSession, toPublic, FORMAT_RULES } from "@/lib/server/session";
import { answerQuiz, createQuizDuel, duelQuestion, quizView, revealQuiz, type QuizDuel } from "@/lib/server/quiz-duel";
import { joinDuel, readyDuel } from "@/lib/server/duels";
import type { PvpOutcome } from "@/lib/server/duel-core";
import { PVP_LEAD_MS, quizDuelPoints } from "@/lib/pvp-types";
import type { SessionSpec } from "@/lib/session-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const rounds = ROUNDS as TeamEntry[];
const DEX = new Map((pokedex as { id: number; name: string }[]).map((p) => [p.id, p.name]));
const GAME_KEYS = new Set(fs.readdirSync("src/data/trainers").map((f) => f.replace(/\.json$/, "")));

describe("whose team: data", () => {
  it("has a few hundred rounds, every game generation and the anime", () => {
    expect(rounds.length).toBeGreaterThan(300);
    for (let gen = 1; gen <= 9; gen++) expect(rounds.some((r) => r.kind === "game" && r.gen === gen), `gen ${gen}`).toBe(true);
    expect(rounds.filter((r) => r.kind === "anime").length).toBeGreaterThanOrEqual(10);
    expect(rounds.some((r) => r.trainer === "Red" && /Mt\. Silver/.test(r.appearance))).toBe(true);
  });

  it("gives every round a well-formed entry, with its source", () => {
    const ids = new Set<string>();
    for (const r of rounds) {
      expect(ids.has(r.id), r.id).toBe(false);
      ids.add(r.id);
      expect(r.trainer.trim(), r.id).toBe(r.trainer);
      expect(r.trainer.length, r.id).toBeGreaterThan(0);
      expect(["game", "anime"]).toContain(r.kind);
      expect(Number.isInteger(r.gen) && r.gen >= 1 && r.gen <= 9, r.id).toBe(true);
      expect(r.appearance.length, r.id).toBeGreaterThan(10);
      // The trainer's Bulbapedia page, and where the team itself was taken from.
      expect(r.source, r.id).toMatch(/^https:\/\/bulbapedia\.bulbagarden\.net\/wiki\/\S+$/);
      expect(r.data.length, r.id).toBeGreaterThan(10);
      expect(r.team.length, r.id).toBeGreaterThanOrEqual(2);
      expect(r.team.length, r.id).toBeLessThanOrEqual(8);
      for (const m of r.team) {
        expect(DEX.get(m.dex), `${r.id} ${m.species}`).toBe(m.species);
        if (m.art !== undefined) expect(m.art > 10000 && m.form, `${r.id} ${m.species}`).toBeTruthy();
      }
      expect(r.team.map(monLabel), r.id).toContain(r.ace);
      if (r.kind === "game") {
        expect(GAME_KEYS.has(r.game!), r.id).toBe(true);
        expect(r.appearance, r.id).toMatch(/^Pokémon /);
      } else {
        expect(r.series, r.id).toBeTruthy();
        expect(r.data, r.id).toMatch(/^https:\/\/pokemon\.fandom\.com\/wiki\//);
      }
      if (r.variant) expect(r.variant, r.id).toMatch(/^Player chose /);
    }
  });

  it("takes game teams from checked data: the decompilations (Gens I–IV) or Bulbapedia confirmed by Serebii (Gens V–IX)", () => {
    for (const r of rounds.filter((x) => x.kind === "game")) {
      if (r.gen <= 4 && r.game !== "brilliant-diamond-shining-pearl") expect(r.data, r.id).toMatch(/pret\/poke\w+@[0-9a-f]{7} party data/);
      else expect(r.data, r.id).toMatch(/Serebii|serebii\.net/);
    }
  });

  it("matches the committed trainer data, team for team", () => {
    const files = new Map<string, { teams: { id: string; team: { s: number }[] }[] }>();
    for (const r of rounds.filter((x) => x.kind === "game")) {
      if (!files.has(r.game!)) files.set(r.game!, JSON.parse(fs.readFileSync(`src/data/trainers/${r.game}.json`, "utf8")));
      const teamId = r.data.split(":")[0];
      const team = files.get(r.game!)!.teams.find((t) => t.id === teamId);
      expect(team, r.id).toBeDefined();
      expect(team!.team.map((m) => m.s), r.id).toEqual(r.team.map((m) => m.dex));
    }
  });

  it("leaves out Legends: Arceus and Legends: Z-A", () => {
    for (const r of rounds) expect(`${r.game ?? ""} ${r.appearance}`, r.id).not.toMatch(/legends|arceus|z-a/i);
  });

  it("never has two different trainers with the same set of Pokémon", () => {
    const owner = new Map<string, string>();
    for (const r of rounds) {
      const k = teamKey(r.team);
      const other = owner.get(k);
      if (other) expect(other, `${r.id} has the same team as ${other}`).toBe(r.trainer);
      owner.set(k, r.trainer);
    }
  });

  it("names every trainer once, with aliases only for the same person", () => {
    const names = (NAMES as { name: string; aliases?: string[] }[]).map((n) => n.name);
    expect(names).toEqual([...new Set(rounds.map((r) => r.trainer))].sort((a, b) => a.localeCompare(b)));
    expect(ANSWER_NAMES).toEqual(names);
    const all = new Map<string, string>();
    for (const n of NAMES as { name: string; aliases?: string[] }[]) {
      for (const key of [n.name, ...(n.aliases ?? [])]) {
        const k = key.toLowerCase();
        expect(all.get(k) ?? n.name, `${key} names two trainers`).toBe(n.name);
        all.set(k, n.name);
      }
    }
    // Blue was Green in Japan; Gary is the anime's own character, not an alias of Blue.
    expect(resolveGuess("Green")).toBe("Blue");
    expect(resolveGuess("Gary")).toBe("Gary");
    expect(resolveGuess("Red")).toBe("Red");
    expect(resolveGuess("Ash")).toBe("Ash");
    expect(resolveGuess("nobody at all")).toBeNull();
  });

  it("keeps each version difference as its own appearance", () => {
    const cynthia = rounds.filter((r) => r.trainer === "Cynthia" && r.kind === "game").map((r) => r.game);
    expect(cynthia).toEqual(expect.arrayContaining(["diamond-pearl", "platinum", "brilliant-diamond-shining-pearl"]));
    expect(rounds.some((r) => r.trainer === "Steven" && r.game === "ruby-sapphire")).toBe(true);
    expect(rounds.some((r) => r.trainer === "Wallace" && r.game === "emerald" && /Champion/.test(r.appearance))).toBe(true);
  });
});

describe("whose team: autocomplete", () => {
  it("suggests names that start with the text first, aliases included", () => {
    expect(suggest("cyn")[0].name).toBe("Cynthia");
    expect(suggest("wake").map((s) => s.name)).toContain("Crasher Wake");
    expect(suggest("gre")[0]).toMatchObject({ name: "Blue", via: "Green" });
    expect(suggest("")).toEqual([]);
  });
});

describe("whose team: reveal order and scoring", () => {
  it("reveals the ace last and never leads with it", () => {
    for (const r of rounds) {
      const order = revealOrder(r);
      expect(teamKey(order), r.id).toBe(teamKey(r.team));
      expect(monLabel(order[order.length - 1]), r.id).toBe(r.ace);
      if (r.team.filter((m) => monLabel(m) === r.ace).length === 1) expect(monLabel(order[0]), r.id).not.toBe(r.ace);
    }
    const ash = rounds.find((r) => r.id === "anime:ash:kalos")!;
    expect(revealOrder(ash).map((m) => m.species).at(-1)).toBe("Pikachu");
  });

  it("scores fewer reveals higher", () => {
    expect(revealFactor(1, 6)).toBe(1);
    expect(revealFactor(6, 6)).toBeCloseTo(0.4);
    for (let n = 1; n < 6; n++) expect(revealFactor(n, 6)).toBeGreaterThan(revealFactor(n + 1, 6));
    expect(revealFactor(1, 1)).toBe(1);
  });

  it("builds valid questions: typed answers, every trainer as an option", () => {
    for (const hard of [false, true]) {
      for (const r of rounds) {
        const q = teamQuestion(r, hard);
        expect(isValidQuestion(q), r.id).toBe(true);
        expect(q.options).toBe(ANSWER_NAMES);
        expect(q.input).toBe("type");
        expect(q.reveal).toBe(hard ? 1 : undefined);
      }
    }
  });

  it("filters by generation and by games or anime", () => {
    expect(roundsFor({ scope: "anime" }).every((i) => TEAM_ROUNDS[i].kind === "anime")).toBe(true);
    expect(roundsFor({ scope: "games", gens: [4] }).every((i) => TEAM_ROUNDS[i].kind === "game" && TEAM_ROUNDS[i].gen === 4)).toBe(true);
    expect(roundsFor({}).length).toBe(TEAM_ROUNDS.length);
    const rng = new Rng("filter");
    const used = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const q = buildQuestion("whose-team", rng, { difficulty: "medium", gens: [6], scope: "anime", used });
      const r = TEAM_ROUNDS.find((x) => `whose-team:${x.id}` === q.itemKey)!;
      expect(r).toMatchObject({ kind: "anime", gen: 6 });
    }
  });
});

const spec = (difficulty: "medium" | "hard", seed: string): SessionSpec => ({ module: "whose-team", format: "classic", difficulty, seed });

describe("whose team: nothing leaks before the guess", () => {
  it("Normal: the browser gets the team and the name list, never the answer, appearance or source", () => {
    for (let n = 0; n < 25; n++) {
      const s = spec("medium", `leak-normal-${n}`);
      const start = startSession(s);
      const q = questionAt(s, 0);
      const pub = start.question;
      expect(pub.options).toEqual(ANSWER_NAMES);
      const json = JSON.stringify({ ...pub, options: undefined });
      expect(json).not.toContain(q.answer);
      expect(json).not.toContain(q.explanation!);
      expect(json).not.toContain(q.source!);
      expect(json).not.toMatch(/appearance|variant|bulbapedia|fandom/i);
      expect(pub.cards).toHaveLength(q.cards!.length);
    }
  });

  it("Hard: only the first Pokémon is sent; the rest come one per reveal", () => {
    for (let n = 0; n < 25; n++) {
      const s = spec("hard", `leak-hard-${n}`);
      const start = startSession(s);
      const q = questionAt(s, 0);
      const total = q.cards!.length;
      expect(start.question.cards).toHaveLength(1);
      expect(start.question.reveal).toEqual({ shown: 1, total });
      const json = JSON.stringify(start);
      // A team can have two of a species (Lance's Dragonair): only check the ones not on show.
      const unseen = (k: number) => q.cards!.slice(k).filter((c) => !q.cards!.slice(0, k).some((x) => x.pokemonId === c.pokemonId));
      for (const hidden of unseen(1)) {
        expect(json).not.toContain(`/api/art/${hidden.pokemonId}?`);
        expect(json).not.toContain(`"${hidden.label}"`);
      }
      // Each reveal hands over exactly the next card.
      let token = start.token;
      for (let k = 1; k < total; k++) {
        const out = revealCard(readSession(token)!);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.response.card.label).toBe(q.cards![k].label);
        expect(out.response.reveal).toEqual({ shown: k + 1, total });
        const later = JSON.stringify(out.response);
        for (const hidden of unseen(k + 1)) expect(later).not.toContain(`/api/art/${hidden.pokemonId}?`);
        token = out.response.token;
      }
      const done = revealCard(readSession(token)!);
      expect(done.ok).toBe(false);
    }
  });

  it("public questions of other modes are unchanged", () => {
    const s: SessionSpec = { module: "higher-lower", format: "classic", difficulty: "medium", seed: "hl" };
    const pub = toPublic(questionAt(s, 0), 0, FORMAT_RULES.classic);
    expect(pub.input).toBeUndefined();
    expect(pub.reveal).toBeUndefined();
    expect(pub.cards?.[0].imageUrl).toMatch(/official-artwork/);
  });
});

describe("whose team: grading", () => {
  it("scores a right answer on fewer reveals higher, and shows the whole team after", () => {
    const s = spec("hard", "grade-hard");
    const start = startSession(s);
    const q = questionAt(s, 0);
    const first = gradeAnswer(readSession(start.token)!, q.answer);
    expect(first.ok && first.response.correct).toBe(true);
    if (!first.ok) return;
    expect(first.response.revealCards).toHaveLength(q.cards!.length);
    expect(first.response.answer).toBe(q.answer);
    expect(first.response.explanation).toBe(q.explanation);

    let token = start.token;
    for (let k = 1; k < q.cards!.length; k++) {
      const out = revealCard(readSession(token)!);
      if (!out.ok) throw new Error(out.error);
      token = out.response.token;
    }
    const all = gradeAnswer(readSession(token)!, q.answer);
    if (!all.ok) throw new Error(all.error);
    expect(all.response.gained).toBeLessThan(first.response.gained);
    expect(all.response.gained / first.response.gained).toBeGreaterThan(0.3);
    expect(all.response.gained / first.response.gained).toBeLessThan(0.5);
    const wrong = gradeAnswer(readSession(token)!, ANSWER_NAMES.find((n) => n !== q.answer)!);
    expect(wrong.ok && wrong.response.correct).toBe(false);
    expect(wrong.ok && wrong.response.gained).toBe(0);
  });

  it("an older token can't answer once a newer one revealed more (its guard is the next reveal's claim)", () => {
    const s = spec("hard", "grade-guard");
    const start = startSession(s);
    const state = readSession(start.token)!;
    const reveal = revealCard(state);
    if (!reveal.ok) throw new Error(reveal.error);
    const stale = gradeAnswer(state, "Blue");
    if (!stale.ok) throw new Error(stale.error);
    expect(stale.revealGuard).toBe(reveal.claimKey);
    expect(reveal.claimKey).toBe(revealClaimKey(state, 2));
    // Normal questions need no guard.
    const normal = gradeAnswer(readSession(startSession(spec("medium", "grade-normal")).token)!, "Blue");
    expect(normal.ok && normal.revealGuard).toBeFalsy();
  });

  it("refuses reveals on questions that have none", () => {
    const out = revealCard(readSession(startSession(spec("medium", "no-reveal")).token)!);
    expect(out.ok).toBe(false);
  });
});

describe("whose team: the Daily Challenge", () => {
  it("stays out of the daily (not approved yet): every daily question is from the Mixed rotation", () => {
    for (const date of ["2026-10-17", "2026-11-08", "2026-12-25"]) {
      const s: SessionSpec = { module: "mixed", format: "classic", difficulty: "medium", seed: `daily:${date}`, daily: date };
      for (let i = 0; i < 10; i++) expect(questionAt(s, i).module).not.toBe("whose-team");
    }
  });
});

describe("whose team: duels", () => {
  const T0 = 1_800_000_000_000;
  const must = (out: PvpOutcome<QuizDuel>): QuizDuel => {
    if (!out.ok) throw new Error(out.error);
    return out.duel;
  };
  function started(difficulty: "medium" | "hard") {
    const { duel, playerId: red } = createQuizDuel("whose-team", difficulty, "Red", "teamduel", T0, `team-${difficulty}`);
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    const t = T0 + 2000;
    const d = must(readyDuel(must(readyDuel(joined.duel, red, true, t)), joined.playerId, true, t));
    return { duel: d, red, blue: joined.playerId, start: t + PVP_LEAD_MS };
  }

  it("Hard: each trainer sees only their own reveals, and fewer reveals score more", () => {
    const game = started("hard");
    const { red, blue, start } = game;
    let duel = game.duel;
    const q = duelQuestion(duel, 0);
    const total = q.cards!.length;
    duel = must(revealQuiz(duel, blue, 0, start + 500));
    duel = must(revealQuiz(duel, blue, 0, start + 600));
    const redView = quizView(duel, red, start + 700, 0).question!.question!;
    const blueView = quizView(duel, blue, start + 700, 0).question!.question!;
    expect(redView.cards).toHaveLength(1);
    expect(blueView.cards).toHaveLength(3);
    expect(blueView.reveal).toEqual({ shown: 3, total });
    expect(JSON.stringify(redView)).not.toContain(q.cards![1].label);
    // The same answer at the same moment: Red, who saw one Pokémon, scores more.
    duel = must(answerQuiz(duel, red, 0, q.answer, start + 2000));
    duel = must(answerQuiz(duel, blue, 0, q.answer, start + 2000));
    expect(revealQuiz(duel, red, 0, start + 2100).ok).toBe(false);
    const view = quizView(duel, red, start + 2100, 0);
    const result = view.revealed[0];
    expect(result.picks[0]).toMatchObject({ correct: true, shown: 1, points: quizDuelPoints(2000) });
    expect(result.picks[1]).toMatchObject({ correct: true, shown: 3 });
    expect(result.picks[1]!.points).toBeLessThan(result.picks[0]!.points);
    // After the question, everyone sees the whole team.
    expect(result.question.cards).toHaveLength(total);
  });

  it("Normal: the whole team for both, no reveals", () => {
    const { duel, red, start } = started("medium");
    const view = quizView(duel, red, start, 0).question!.question!;
    expect(view.input).toBe("type");
    expect(view.reveal).toBeUndefined();
    expect(view.cards!.length).toBe(duelQuestion(duel, 0).cards!.length);
    expect(revealQuiz(duel, red, 0, start + 100).ok).toBe(false);
  });
});
