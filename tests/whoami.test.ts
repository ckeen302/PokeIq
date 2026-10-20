import { describe, expect, it } from "vitest";
import { answer, askSeat, aliveOf, dailySecret, guessSeat, newSeatPlay, openSolo, poolOf, sealSolo, soloAct, soloView, startSolo } from "@/lib/server/whoami";
import { createWhoamiDuel, pickWhoamiSecret, roundEnds, whoamiMove, whoamiView, type WhoamiDuel, type WhoamiMove } from "@/lib/server/whoami-duel";
import { joinDuel, linkRematch, readyDuel, rematchOf, skipReveal, takeRematchSeat, touchDuel } from "@/lib/server/duels";
import type { PvpOutcome } from "@/lib/server/duel-core";
import { getPokemon, getPokemonBySlug } from "@/lib/pokemon/pokedex";
import {
  WHOAMI_BID_MS,
  WHOAMI_DEFAULT_POOL,
  WHOAMI_DROP_EVERY_MS,
  WHOAMI_LAST_CALL_MS,
  WHOAMI_LOCK_MS,
  WHOAMI_PP,
  WHOAMI_REVEAL_MS,
  WHOAMI_ROUND_MS,
  WHOAMI_TAUNT_MS,
  parseQuestion,
  questionCost,
  resolveBids,
  whoamiScore,
} from "@/lib/whoami";
import { PVP_LEAD_MS } from "@/lib/pvp-types";

const T0 = 1_800_000_000_000;
const S = 1000;
const mon = (slug: string) => getPokemonBySlug(slug)!;
const ask = (q: string, slug: string) => answer(parseQuestion(q)!, mon(slug));

describe("who am i: questions answer from the data", () => {
  it("answers broad questions", () => {
    expect(ask("type:fire", "charizard")).toBe(true);
    expect(ask("type:flying", "charizard")).toBe(true);
    expect(ask("type:water", "charizard")).toBe(false);
    expect(ask("dual", "charizard")).toBe(true);
    expect(ask("dual", "pikachu")).toBe(false);
    expect(ask("from:4", "garchomp")).toBe(true);
    expect(ask("from:4", "pikachu")).toBe(false);
    expect(ask("final", "charizard")).toBe(true);
    expect(ask("final", "charmander")).toBe(false);
    expect(ask("basic", "charmander")).toBe(true);
    expect(ask("legend", "mewtwo")).toBe(true);
    expect(ask("legend", "mew")).toBe(true);
    expect(ask("legend", "pikachu")).toBe(false);
    expect(ask("color:yellow", "pikachu")).toBe(true);
    expect(ask("color:mono", "pikachu")).toBe(false);
  });

  it("answers specific questions", () => {
    expect(ask("gen:4", "garchomp")).toBe(true);
    expect(ask("gen:4", "pikachu")).toBe(false);
    expect(ask("height:15", "charizard")).toBe(true); // 1.7 m
    expect(ask("height:15", "pikachu")).toBe(false);
    expect(ask("weight:50", "snorlax")).toBe(true);
    expect(ask("weight:10", "pikachu")).toBe(false); // 6 kg
    expect(ask("stat:spe:90", "pikachu")).toBe(false); // exactly 90 is not over
    expect(ask("stat:spe:70", "pikachu")).toBe(true);
    expect(ask("bst:600", "mewtwo")).toBe(true);
    expect(ask("ability:levitate", "gengar")).toBe(false);
    expect(ask("ability:blaze", "charizard")).toBe(true);
    expect(ask("move:surf", "pikachu")).toBe(true);
    expect(ask("move:fly", "charizard")).toBe(true);
    expect(ask("move:fly", "snorlax")).toBe(false);
  });

  it("prices questions and refuses anything off the menu", () => {
    expect(questionCost(parseQuestion("type:fire")!)).toBe(10);
    expect(questionCost(parseQuestion("color:red")!)).toBe(10);
    expect(questionCost(parseQuestion("gen:4")!)).toBe(20);
    expect(questionCost(parseQuestion("stat:spe:90")!)).toBe(20);
    expect(questionCost(parseQuestion("ability:levitate")!)).toBe(25);
    expect(questionCost(parseQuestion("move:surf")!)).toBe(25);
    for (const bad of ["type:cheese", "gen:10", "from:1", "stat:spe:91", "height:7", "move:splash", "ability:Bad!", "name:pikachu", "gen:04"]) {
      expect(parseQuestion(bad)).toBeNull();
    }
  });

  it("builds pools from the curated set, by generation, with or without legendaries", () => {
    const all = poolOf(WHOAMI_DEFAULT_POOL);
    expect(all.length).toBeGreaterThan(300);
    expect(all.some((p) => p.slug === "pikachu")).toBe(true);
    const casual = poolOf({ from: 1, to: 9, casual: true });
    expect(casual.some((p) => p.legendary || p.mythical)).toBe(false);
    for (let g = 1; g <= 9; g++) expect(poolOf({ from: g, to: g, casual: true }).length).toBeGreaterThanOrEqual(12);
    expect(poolOf({ from: 1, to: 1, casual: false }).every((p) => p.gen === 1)).toBe(true);
  });
});

describe("who am i: one trainer's play", () => {
  const pool = poolOf(WHOAMI_DEFAULT_POOL);
  const secret = mon("charizard");

  it("charges PP, strikes what the answer rules out, and stops at 0 PP", () => {
    const seat = newSeatPlay();
    expect(askSeat(seat, secret, "type:fire", T0)).toEqual({ ok: true, yes: true });
    expect(seat.pp).toBe(WHOAMI_PP - 10);
    const alive = aliveOf(pool, seat).map((id) => getPokemon(id)!);
    expect(alive.length).toBeLessThan(pool.length);
    expect(alive.every((p) => p.types.includes("fire"))).toBe(true);
    expect(askSeat(seat, secret, "type:fire", T0).ok).toBe(false); // already known: no charge
    expect(seat.pp).toBe(90);
    for (const q of ["move:surf", "move:fly", "move:dig"]) expect(askSeat(seat, secret, q, T0).ok).toBe(true);
    expect(seat.pp).toBe(15);
    expect(askSeat(seat, secret, "gen:1", T0)).toMatchObject({ ok: false, error: "Not enough PP for that question." });
    expect(askSeat(seat, secret, "dual", T0).ok).toBe(true);
    expect(seat.pp).toBe(5);
    expect(askSeat(seat, secret, "final", T0).ok).toBe(false);
    // Out of PP: guessing still works.
    expect(guessSeat(seat, secret, secret.id, pool, T0)).toEqual({ ok: true, right: true });
    expect(whoamiScore(seat.pp)).toBe(1_025);
  });

  it("locks out guessing and asking for 12 s after a wrong guess, at no PP", () => {
    const seat = newSeatPlay();
    expect(guessSeat(seat, secret, mon("pikachu").id, pool, T0)).toEqual({ ok: true, right: false });
    expect(seat.pp).toBe(WHOAMI_PP);
    expect(aliveOf(pool, seat)).not.toContain(mon("pikachu").id);
    expect(askSeat(seat, secret, "type:fire", T0 + WHOAMI_LOCK_MS - 1).ok).toBe(false);
    expect(guessSeat(seat, secret, secret.id, pool, T0 + WHOAMI_LOCK_MS - 1).ok).toBe(false);
    expect(askSeat(seat, secret, "type:fire", T0 + WHOAMI_LOCK_MS).ok).toBe(true);
    expect(guessSeat(seat, secret, secret.id, pool, T0 + WHOAMI_LOCK_MS).ok).toBe(true);
  });

  it("keeps practice state sealed, plays it, and shows the answer only when it's over", () => {
    const st = startSolo("practice", WHOAMI_DEFAULT_POOL, T0);
    const token = sealSolo(st);
    expect(token).not.toContain(String(st.x));
    const view = soloView(openSolo(token)!, T0);
    expect(view.answer).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/"secret"|"x"/);
    const asked = soloAct(st, { ask: "dual" }, T0 + S);
    expect(asked.ok && asked.state.seat.pp).toBe(90);
    expect(soloView(st, T0 + WHOAMI_ROUND_MS).answer?.id).toBe(st.x);
    expect(soloAct(st, { ask: "final" }, T0 + WHOAMI_ROUND_MS).ok).toBe(false);
    const won = soloAct(st, { guess: st.x }, T0 + 2 * S);
    expect(won.ok && soloView(won.state, T0 + 2 * S).score).toBe(whoamiScore(100));
  });

  it("gives everyone the same daily", () => {
    expect(startSolo("daily", WHOAMI_DEFAULT_POOL, T0, "2026-10-20").x).toBe(dailySecret("2026-10-20").id);
    expect(startSolo("daily", { from: 1, to: 1, casual: true }, T0 + 5 * S, "2026-10-20").x).toBe(dailySecret("2026-10-20").id);
  });
});

describe("who am i: clue bids", () => {
  it("gives the clue to the higher bid and half back to the loser; a tie goes to nobody", () => {
    expect(resolveBids([20, 9])).toEqual({ winner: 0, refunds: [0, 4] });
    expect(resolveBids([null, 5])).toEqual({ winner: 1, refunds: [0, 0] });
    expect(resolveBids([12, 12])).toEqual({ winner: null, refunds: [6, 6] });
    expect(resolveBids([null, null])).toEqual({ winner: null, refunds: [0, 0] });
  });
});

// ---------------------------------------------------------------------------
// Duels
// ---------------------------------------------------------------------------

const must = (out: PvpOutcome<WhoamiDuel>): WhoamiDuel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};

function started(seed = "wa-seed") {
  const { duel, playerId: red } = createWhoamiDuel("Red", "abcdefgh", T0, { seed, ability: "trace" });
  const joined = joinDuel(duel, "Blue", T0 + S);
  if (!joined.ok) throw new Error(joined.error);
  const blue = joined.playerId;
  let d = must(whoamiMove(joined.duel, blue, { type: "pick", ability: "taunt" }, T0 + S));
  d = must(readyDuel(must(readyDuel(d, red, true, T0 + 2 * S)), blue, true, T0 + 2 * S));
  return { duel: d, red, blue, start: T0 + 2 * S + PVP_LEAD_MS };
}

/** Both trainers check in at `t` (so neither is counted as gone). */
const at = (d: WhoamiDuel, ids: string[], t: number) => ids.reduce((x, id) => touchDuel(x, id, t), d);
const move = (d: WhoamiDuel, id: string, m: WhoamiMove, t: number) => must(whoamiMove(d, id, m, t));
const secretOf = (d: WhoamiDuel) => d.rounds[d.rounds.length - 1].secret;
const wrongFor = (d: WhoamiDuel) => d.rounds.length && poolOf(d.settings).find((p) => p.id !== secretOf(d))!.id;

describe("who am i duels", () => {
  it("gives both trainers the same secret, and never shows it (or the rival's questions) before the reveal", () => {
    const { duel, red, blue, start } = started();
    let d = at(duel, [red, blue], start);
    d = move(d, red, { type: "ask", round: 0, q: "dual" }, start + S);
    const secret = secretOf(d);
    expect(d.rounds[0].seats).toHaveLength(2);
    for (const viewer of [red, blue, null]) {
      const view = whoamiView(d, viewer, start + S, 1);
      const json = JSON.stringify(view);
      expect(json).not.toContain(getPokemon(secret)!.name);
      expect(json).not.toMatch(/"secret"|"fact"/);
      expect(view.revealed).toHaveLength(0);
    }
    const blueView = whoamiView(d, blue, start + S, 1);
    expect(JSON.stringify(blueView)).not.toContain('"dual"');
    expect(blueView.round!.boards[0].asked).toBe(1);
    expect(whoamiView(d, red, start + S, 1).round!.mine!.known[0].q).toBe("dual");
    expect(whoamiView(d, null, start + S, 1).round!.mine).toBeUndefined();
  });

  it("drops sealed clues, settles bids, and shows the clue only to the winner", () => {
    const { duel, red, blue, start } = started();
    const opens = start + WHOAMI_DROP_EVERY_MS;
    let d = at(duel, [red, blue], opens - 20 * S);
    d = at(d, [red, blue], opens);
    const drop = d.rounds[0].drops[0];
    expect(drop).toBeDefined();
    const sealed = JSON.stringify(whoamiView(d, blue, opens, 1));
    expect(sealed).not.toContain(drop.fact);
    d = move(d, red, { type: "bid", round: 0, amount: 20 }, opens + S);
    expect(whoamiMove(d, red, { type: "bid", round: 0, amount: 5 }, opens + S).ok).toBe(false);
    d = move(d, blue, { type: "bid", round: 0, amount: 9 }, opens + 2 * S);
    const mid = whoamiView(d, blue, opens + 2 * S, 1).round!.drop!;
    expect(mid).toMatchObject({ bid: 9, rivalBid: true });
    expect(mid.result).toBeUndefined();
    expect(whoamiMove(d, blue, { type: "bid", round: 0, amount: 1 }, opens + WHOAMI_BID_MS).ok).toBe(false);
    d = at(d, [red, blue], opens + WHOAMI_BID_MS);
    const round = d.rounds[0];
    expect(round.drops[0].result).toEqual({ winner: 0, bids: [20, 9] });
    expect(round.seats[0].pp).toBe(80);
    expect(round.seats[1].pp).toBe(WHOAMI_PP - 9 + 4);
    expect(round.seats[0].known.find((k) => k.via === "clue")?.q).toBe(drop.fact);
    expect(JSON.stringify(whoamiView(d, blue, opens + WHOAMI_BID_MS, 1).round!.mine)).not.toContain(drop.fact);
    expect(answer(parseQuestion(drop.fact)!, getPokemon(secretOf(d))!)).toBe(true);
  });

  it("runs the abilities: Taunt silences questions, Trace shows the last question, Frisk counts the grid; once a round", () => {
    const { duel, red, blue, start } = started();
    let d = at(duel, [red, blue], start);
    // Red has Trace, Blue Taunt.
    expect(whoamiMove(d, red, { type: "ability", round: 0 }, start + S).ok).toBe(false); // nothing to trace yet
    d = move(d, blue, { type: "ask", round: 0, q: "type:water" }, start + S);
    d = move(d, blue, { type: "ask", round: 0, q: "final" }, start + 2 * S);
    d = move(d, red, { type: "ability", round: 0 }, start + 3 * S);
    const traced = whoamiView(d, red, start + 3 * S, 1).round!;
    expect(traced.traced?.q).toBe("final");
    expect(traced.mine!.known).toContainEqual(expect.objectContaining({ q: "final", via: "trace" }));
    expect(traced.mine!.pp).toBe(WHOAMI_PP);
    expect(whoamiMove(d, red, { type: "ability", round: 0 }, start + 4 * S).ok).toBe(false);

    d = move(d, blue, { type: "ability", round: 0 }, start + 4 * S);
    expect(whoamiMove(d, red, { type: "ask", round: 0, q: "dual" }, start + 5 * S).ok).toBe(false);
    expect(whoamiView(d, red, start + 5 * S, 1).round!.boards[0].tauntUntil).toBe(start + 4 * S + WHOAMI_TAUNT_MS);
    expect(whoamiMove(d, red, { type: "ask", round: 0, q: "dual" }, start + 4 * S + WHOAMI_TAUNT_MS).ok).toBe(true);

    // Frisk, in a duel where Red brings it.
    const f = createWhoamiDuel("Red", "abcdefgj", T0, { seed: "frisk", ability: "frisk" });
    const j = joinDuel(f.duel, "Blue", T0);
    if (!j.ok) throw new Error(j.error);
    let g = must(readyDuel(must(readyDuel(j.duel, f.playerId, true, T0)), j.playerId, true, T0));
    const s0 = T0 + PVP_LEAD_MS;
    g = at(g, [f.playerId, j.playerId], s0);
    g = move(g, j.playerId, { type: "ask", round: 0, q: "dual" }, s0 + S);
    g = move(g, f.playerId, { type: "ability", round: 0 }, s0 + 2 * S);
    const frisked = whoamiView(g, f.playerId, s0 + 2 * S, 1).round!.frisked;
    expect(frisked).toBe(whoamiView(g, j.playerId, s0 + 2 * S, 1).round!.mine!.alive.length);
    expect(frisked).toBeLessThan(poolOf(g.settings).length);
  });

  it("locks out a wrong guess, scores the solves, gives the first solver the round, and gives the second a last call", () => {
    const { duel, red, blue, start } = started();
    let d = at(duel, [red, blue], start);
    d = move(d, blue, { type: "guess", round: 0, pokemon: wrongFor(d) as number }, start + S);
    expect(whoamiMove(d, blue, { type: "guess", round: 0, pokemon: secretOf(d) }, start + 2 * S).ok).toBe(false);
    d = move(d, red, { type: "ask", round: 0, q: "dual" }, start + 2 * S);
    d = move(d, red, { type: "guess", round: 0, pokemon: secretOf(d) }, start + 3 * S);
    expect(roundEnds(d.rounds[0])).toBe(start + 3 * S + WHOAMI_LAST_CALL_MS);
    d = move(d, blue, { type: "guess", round: 0, pokemon: secretOf(d) }, start + S + WHOAMI_LOCK_MS);
    const result = d.rounds[0].result!;
    expect(result.winner).toBe(0);
    expect(result.scores).toEqual([whoamiScore(90), whoamiScore(100)]);
    const view = whoamiView(d, blue, start + 20 * S, 2);
    expect(view.revealed[0].answer.id).toBe(d.rounds[0].secret);
    expect(view.wins).toEqual([1, 0]);
  });

  it("plays best of three and finishes once a trainer wins two rounds; time-outs go to the most PP", () => {
    const { duel, red, blue, start } = started();
    let d = at(duel, [red, blue], start);
    // Round 1: nobody solves; Blue asked less, so has more PP.
    d = move(d, red, { type: "ask", round: 0, q: "dual" }, start + S);
    for (let t = start + 20 * S; t <= start + WHOAMI_ROUND_MS + 2 * S; t += 20 * S) d = at(d, [red, blue], t);
    d = at(d, [red, blue], start + WHOAMI_ROUND_MS + 2 * S);
    expect(d.rounds[0].result).toMatchObject({ winner: 1, timedOut: true });
    // Both press Next.
    d = must(skipReveal(d, red, 0, start + WHOAMI_ROUND_MS + 3 * S) as PvpOutcome<WhoamiDuel>);
    d = must(skipReveal(d, blue, 0, start + WHOAMI_ROUND_MS + 3 * S) as PvpOutcome<WhoamiDuel>);
    expect(d.rounds).toHaveLength(2);
    const s2 = d.rounds[1].startsAt;
    expect(s2).toBe(start + WHOAMI_ROUND_MS + 3 * S + PVP_LEAD_MS);
    expect(d.rounds[1].secret).not.toBe(d.rounds[0].secret);
    d = at(d, [red, blue], s2);
    d = move(d, blue, { type: "guess", round: 1, pokemon: d.rounds[1].secret }, s2 + S);
    d = move(d, red, { type: "guess", round: 1, pokemon: d.rounds[1].secret }, s2 + 2 * S);
    expect(d.status).toBe("finished");
    expect(d.end).toMatchObject({ reason: "played", winner: 1 });
    expect(whoamiView(d, red, s2 + 2 * S, 3).series).toMatchObject({ wins: [0, 1] });
  });

  it("refuses moves out of turn and lobby settings that leave too few Pokémon", () => {
    const { duel: lobby, playerId: red } = createWhoamiDuel("Red", "abcdefgh", T0);
    expect(whoamiMove(lobby, red, { type: "ask", round: 0, q: "dual" }, T0).ok).toBe(false);
    const set = must(whoamiMove(lobby, red, { type: "settings", settings: { from: 1, to: 1, casual: true } }, T0));
    expect(whoamiView(set, red, T0, 1).pool.length).toBe(poolOf({ from: 1, to: 1, casual: true }).length);
    const j = joinDuel(set, "Blue", T0);
    if (!j.ok) throw new Error(j.error);
    expect(whoamiMove(j.duel, j.playerId, { type: "settings", settings: WHOAMI_DEFAULT_POOL }, T0).ok).toBe(false);
    expect(pickWhoamiSecret("s", 0, set.settings, [], T0)).toBe(pickWhoamiSecret("s", 0, set.settings, [], T0));
  });

  it("opens a rematch with the same settings and abilities, and carries the series", () => {
    const { duel, red, blue, start } = started("rm");
    let d = at(duel, [red, blue], start);
    for (let r = 0; r < 2; r++) {
      const s = d.rounds[r].startsAt;
      d = at(d, [red, blue], s);
      d = move(d, red, { type: "guess", round: r, pokemon: d.rounds[r].secret }, s + S);
      d = move(d, blue, { type: "guess", round: r, pokemon: d.rounds[r].secret }, s + 2 * S);
      if (d.status === "playing") d = at(d, [red, blue], d.rounds[r].result!.nextAt);
    }
    expect(d.end?.winner).toBe(0);
    const t = d.end!.at + S;
    const linked = linkRematch(d, "mnpqrstu");
    expect(linked.ok && linked.duel.rematch).toBe("mnpqrstu");
    const next = rematchOf(d, "mnpqrstu", t);
    expect(next.kind).toBe("whoami");
    expect(next.settings).toEqual(d.settings);
    expect(next.abilities).toEqual(d.abilities);
    expect(next.rounds).toEqual([]);
    let r2 = must(takeRematchSeat(next, red, "Red", t) as PvpOutcome<WhoamiDuel>);
    r2 = must(takeRematchSeat(r2, blue, "Blue", t) as PvpOutcome<WhoamiDuel>);
    expect(r2.status).toBe("playing");
    expect(whoamiView(r2, red, t, 1).series).toMatchObject({ game: 2, wins: [1, 0] });
    expect(whoamiView(r2, red, t, 1).abilities).toEqual(["trace", "taunt"]);
    expect(WHOAMI_REVEAL_MS).toBeGreaterThan(0);
  });
});
