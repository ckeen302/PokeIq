/**
 * The battle format catalogue (src/data/battle/formats.json), read from
 * Pokémon Showdown's own format list (config/formats.ts via Dex.formats).
 * The lean list goes to formats.json (the picker ships it); each format's
 * ruleset and bans go to format-rules.json (served by /api/battle/rules).
 * Every format is checked the way a battle would use it: two teams are made
 * (the format's own generator for random formats, otherwise random-battle
 * sets its TeamValidator passes) and a battle is started with them. A format
 * that fails anywhere is kept but marked unsupported, with the reason.
 *
 *   npx tsx --conditions=react-server scripts/build-formats.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Battle, Dex, Teams } from "pokemon-showdown";
import { catalogueTeam } from "../src/lib/server/battle-engine/custom";
import type { CatalogueFormat, FormatRules } from "../src/lib/battle/format-catalogue";

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&eacute;/g, "é")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Starts a battle in `id` with two fresh teams; returns why it couldn't, or null. */
export function smokeFormat(id: string): string | null {
  const format = Dex.formats.get(id, true);
  if (format.gameType !== "singles" && format.gameType !== "doubles") return `${format.gameType} battles aren't supported by the battle screen`;
  if ((format.playerCount ?? 2) !== 2) return "Four-player battles aren't supported";
  try {
    Dex.formats.validate(id);
  } catch (err) {
    return `Showdown's format parser: ${err instanceof Error ? err.message : String(err)}`;
  }
  let teams: string[];
  try {
    teams = [Teams.pack(catalogueTeam(id)), Teams.pack(catalogueTeam(id))];
  } catch (err) {
    return `No team: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    const battle = new Battle({ formatid: id as never });
    battle.setPlayer("p1", { name: "Alpha", team: teams[0] });
    battle.setPlayer("p2", { name: "Beta", team: teams[1] });
    const errors = battle.log.filter((l) => l.startsWith("|error|"));
    if (errors.length) return errors[0];
    if (!battle.started || (battle.turn < 1 && battle.requestState !== "teampreview")) return "The battle didn't start";
    battle.destroy();
  } catch (err) {
    return `Battle: ${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}

export function formatRules(id: string): FormatRules {
  const f = Dex.formats.get(id, true);
  return {
    rules: [...(f.ruleset ?? [])],
    bans: [...(f.banlist ?? [])],
    unbans: [...(f.unbanlist ?? [])],
    restricted: [...(f.restricted ?? [])],
  };
}

export function catalogueEntry(id: string): CatalogueFormat {
  const f = Dex.formats.get(id, true);
  const table = Dex.formats.getRuleTable(f);
  const random = !!f.team;
  const desc = f.desc ? decode(f.desc) : "";
  // Teams are random: a format has to start three battles in a row to count as supported.
  const reason = smokeFormat(id) ?? smokeFormat(id) ?? smokeFormat(id);
  const teamSize = random ? 6 : Math.min(6, table.maxTeamSize);
  return {
    id: f.id,
    name: f.name,
    section: f.section ?? "Other",
    gen: Dex.forFormat(f).gen,
    gameType: f.gameType as CatalogueFormat["gameType"],
    random,
    teamSize,
    pick: table.pickedTeamSize ?? null,
    level: table.adjustLevel ?? (random ? null : Math.min(table.maxLevel, 100)),
    ...(desc ? { desc } : {}),
    hidden: f.challengeShow === false,
    supported: !reason,
    ...(reason ? { reason } : {}),
  };
}

if (process.argv[1]?.endsWith("build-formats.ts")) {
  const out: CatalogueFormat[] = [];
  for (const f of Dex.formats.all()) {
    if (f.effectType !== "Format") continue;
    const t = Date.now();
    const entry = catalogueEntry(f.id);
    out.push(entry);
    console.log(`${entry.supported ? "ok  " : "SKIP"} ${f.id} ${Date.now() - t}ms${entry.reason ? ` — ${entry.reason}` : ""}`);
  }
  const file = path.join(import.meta.dirname, "../src/data/battle/formats.json");
  writeFileSync(file, JSON.stringify(out) + "\n");
  const rules = Object.fromEntries(out.map((f) => [f.id, formatRules(f.id)]));
  writeFileSync(path.join(import.meta.dirname, "../src/data/battle/format-rules.json"), JSON.stringify(rules) + "\n");
  console.log(`${out.length} formats, ${out.filter((f) => f.supported).length} supported -> ${file}`);
}
