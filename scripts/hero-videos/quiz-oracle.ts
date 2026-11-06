/**
 * For the quiz take: reads a session token per line on stdin and prints the
 * current question's answer, worked out by the server's own code from the
 * token (run with the server's POKEIQ_SECRET):
 *
 *   npx tsx --conditions=react-server scripts/hero-videos/quiz-oracle.ts
 */
import readline from "node:readline";
import { questionAt, readSession } from "@/lib/server/session";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (token) => {
  const state = readSession(token.trim());
  console.log(JSON.stringify(state ? { answer: questionAt(state.spec, state.log.length, state.log).answer, index: state.log.length } : { error: "bad token" }));
});
