/**
 * Single-elimination brackets.
 *
 * Ported from Pokémon Showdown's server/tournaments/generator-elimination.ts
 * (https://github.com/smogon/pokemon-showdown), MIT License,
 * Copyright (c) 2011-2026 Guangcong Luo and other contributors.
 *
 * Changes: single elimination only (no loser's brackets); the tree is a flat
 * array of nodes that refer to each other by index, and players are indices
 * into the tournament's player list, so the whole bracket is plain JSON that
 * the server stores and compares-and-swaps; the shuffle is passed in.
 */

export interface ElimNode {
  /** A match node's two children (null: a player node, a leaf). */
  children: [number, number] | null;
  /** A player node: the player. A match node: the winner, once finished. */
  user: number | null;
  /** Match nodes: "available" (both players known), "finished", or "" (waiting on an earlier match). */
  state: "available" | "finished" | "";
  result: "win" | "loss" | "";
  score: number[] | null;
  parent: number | null;
}

export interface ElimBracket {
  nodes: ElimNode[];
  root: number;
}

const node = (opts: Partial<ElimNode> = {}): ElimNode => ({ children: null, user: null, state: "", result: "", score: null, parent: null, ...opts });

/**
 * Builds the bracket for `players` players (in `order`, already shuffled).
 * Each new player splits the shallowest leaf, so an uneven count gives the
 * players left higher up their byes into the second round.
 */
export function freezeElimination(order: number[]): ElimBracket {
  if (!order.length) throw new Error("No players in tournament");
  const nodes: ElimNode[] = [node({ user: order[0] })];
  let current: number[] = [0];
  let next: number[] = [];
  for (const user of order.slice(1)) {
    const target = current.shift()!;
    const left = nodes.push(node({ user: nodes[target].user, parent: target })) - 1;
    const right = nodes.push(node({ user, parent: target })) - 1;
    next.push(left, right);
    nodes[target].children = [left, right];
    nodes[target].user = null;
    if (current.length === 0) {
      current = next;
      next = [];
    }
  }
  for (const n of nodes) {
    if (n.children && nodes[n.children[0]].user !== null && nodes[n.children[1]].user !== null) n.state = "available";
  }
  return { nodes, root: 0 };
}

/** Matches ready to be played: [node, player 1, player 2]. */
export function availableElimMatches(b: ElimBracket): [number, number, number][] {
  const out: [number, number, number][] = [];
  b.nodes.forEach((n, i) => {
    if (n.state !== "available" || !n.children) return;
    out.push([i, b.nodes[n.children[0]].user!, b.nodes[n.children[1]].user!]);
  });
  return out;
}

/**
 * Records a match's result ("win": player 1 won) and moves the winner up.
 * A disqualified player's next match is decided against them at once.
 * Returns an error code, as Showdown's does, or "" when it applied.
 */
export function setElimResult(b: ElimBracket, at: number, result: "win" | "loss", score: number[], isDq: (p: number) => boolean): string {
  const target = b.nodes[at];
  if (!target || target.state !== "available" || !target.children) return "InvalidMatch";
  target.state = "finished";
  target.result = result;
  target.score = score.slice();
  target.user = b.nodes[target.children[result === "win" ? 0 : 1]].user;
  if (target.parent !== null) {
    const parent = b.nodes[target.parent];
    const userA = b.nodes[parent.children![0]].user;
    const userB = b.nodes[parent.children![1]].user;
    if (userA !== null && userB !== null) {
      parent.state = "available";
      let error = "";
      if (isDq(userA)) error = setElimResult(b, target.parent, "loss", [0, 1], isDq);
      else if (isDq(userB)) error = setElimResult(b, target.parent, "win", [1, 0], isDq);
      if (error) throw new Error(`Unexpected ${error} from setElimResult`);
    }
  }
  return "";
}

/** A disqualified player loses the match they have waiting (if any); later ones are decided as they come up. */
export function disqualifyElim(b: ElimBracket, user: number, isDq: (p: number) => boolean): void {
  const found = availableElimMatches(b).find(([, p1, p2]) => p1 === user || p2 === user);
  if (!found) return;
  const [at, p1] = found;
  const error = setElimResult(b, at, p1 === user ? "loss" : "win", p1 === user ? [0, 1] : [1, 0], isDq);
  if (error) throw new Error(`Unexpected ${error} from setElimResult`);
}

export const elimEnded = (b: ElimBracket) => b.nodes[b.root].state === "finished";

/** The winner, then the runner-up. */
export function elimResults(b: ElimBracket): number[][] {
  const root = b.nodes[b.root];
  if (root.state !== "finished" || !root.children) return [];
  const loser = b.nodes[root.children[root.result === "loss" ? 0 : 1]].user;
  return [[root.user!], ...(loser !== null && loser !== root.user ? [[loser]] : [])];
}

/** How far up the tree a match is: 1 for the first round. */
export function elimRound(b: ElimBracket, at: number): number {
  const depth = (i: number): number => {
    const n = b.nodes[i];
    return n.children ? 1 + Math.max(depth(n.children[0]), depth(n.children[1])) : 0;
  };
  return depth(at);
}

/** Players still in it (not beaten in a finished match). */
export function elimEliminated(b: ElimBracket): Set<number> {
  const out = new Set<number>();
  for (const n of b.nodes) {
    if (n.state !== "finished" || !n.children) continue;
    const loser = b.nodes[n.children[n.result === "win" ? 1 : 0]].user;
    if (loser !== null) out.add(loser);
  }
  return out;
}
