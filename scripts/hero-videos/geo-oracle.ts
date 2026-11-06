/**
 * For the PokéGuessr take: reads a game token per line on stdin and prints
 * the current round's answer, worked out by the server's own code from the
 * token (run with the server's POKEIQ_SECRET): its place, game, and its point
 * on the world map in world pixels (where the map engine draws it).
 *
 *   npx tsx --conditions=react-server scripts/hero-videos/geo-oracle.ts
 */
import readline from "node:readline";
import { answerFor, readGeo, roundsOf } from "@/lib/server/geo";
import { geoRegions } from "@/lib/server/geo";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (token) => {
  const state = readGeo(token.trim());
  if (!state) return console.log(JSON.stringify({ error: "bad token" }));
  const round = roundsOf(state)[state.log.length];
  const a = answerFor(state.spec, round);
  const region = geoRegions().find((r) => r.id === state.spec.region) as unknown as { map: { box: [number, number, number, number] } } | undefined;
  const [x0, y0, x1, y1] = region?.map.box ?? [0, 0, 1, 1];
  const [px, py] = a.spot ?? a.pin;
  console.log(JSON.stringify({ index: state.log.length, name: a.name, game: a.game, family: a.family, region: a.region, pin: a.pin, spot: a.spot ?? null, world: [x0 + px * (x1 - x0), y0 + py * (y1 - y0)], box: [x0, y0, x1, y1] }));
});
