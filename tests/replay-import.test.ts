import { describe, expect, it } from "vitest";
import { koSteps, parseShowdownReplay, replayFileHtml } from "@/lib/battle/replay-file";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { lastTurn } from "@/lib/battle/replay";

// A short hand-written battle in Showdown's protocol (singles, two turns, one KO).
const LOG = [
  "|j|☆Red",
  "|j|☆Blue",
  "|player|p1|Red|1|",
  "|player|p2|Blue|2|",
  "|teamsize|p1|1",
  "|teamsize|p2|1",
  "|gametype|singles",
  "|gen|9",
  "|tier|[Gen 9] OU",
  "|start",
  "|split|p1",
  "|switch|p1a: Garchomp|Garchomp, M|357/357",
  "|switch|p1a: Garchomp|Garchomp, M|100/100",
  "|split|p2",
  "|switch|p2a: Gholdengo|Gholdengo|315/315",
  "|switch|p2a: Gholdengo|Gholdengo|100/100",
  "|turn|1",
  "|c|☆Red|gl hf",
  "|move|p1a: Garchomp|Earthquake|p2a: Gholdengo",
  "|-supereffective|p2a: Gholdengo",
  "|split|p2",
  "|-damage|p2a: Gholdengo|10/315",
  "|-damage|p2a: Gholdengo|4/100",
  "|move|p2a: Gholdengo|Make It Rain|p1a: Garchomp",
  "|-damage|p1a: Garchomp|40/100",
  "|turn|2",
  "|move|p1a: Garchomp|Earthquake|p2a: Gholdengo",
  "|-damage|p2a: Gholdengo|0 fnt",
  "|faint|p2a: Gholdengo",
  "|",
  "|win|Red",
];

describe("parseShowdownReplay", () => {
  it("reads a raw log into a replay with only public lines", () => {
    const res = parseShowdownReplay(LOG.join("\n"), PLAY_FORMAT_INFO);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = res.replay;
    expect(r.players).toEqual(["Red", "Blue"]);
    expect(r.format).toBe("gen9ou");
    expect(r.formatName).toBe("[Gen 9] OU");
    expect(r.winner).toBe(0);
    expect(r.reason).toBe("normal");
    expect(r.turns).toBe(2);
    expect(lastTurn(r.log)).toBe(2);
    // Private halves (exact HP), chat and joins never show.
    expect(r.log.join("\n")).not.toMatch(/357\/357|10\/315|\|c\||\|j\||\|split\|/);
    expect(r.log).toContain("|-damage|p2a: Gholdengo|4/100");
  });

  it("reads Showdown's replay file (.html), slashes escaped", () => {
    const html = replayFileHtml({ id: "abcd2345", format: "[Gen 9] OU", players: ["Red", "Blue"], log: LOG, logHtml: "" });
    const res = parseShowdownReplay(html, PLAY_FORMAT_INFO);
    expect(res.ok && res.replay.players).toEqual(["Red", "Blue"]);
    expect(res.ok && res.replay.log).toContain("|move|p1a: Garchomp|Earthquake|p2a: Gholdengo");
  });

  it("reads a replay .json and falls back to a format with the same layout", () => {
    const log = LOG.map((l) => (l.startsWith("|tier|") ? "|tier|[Gen 9] VGC 2026 Reg I" : l.startsWith("|gametype|") ? "|gametype|doubles" : l)).join("\n");
    const res = parseShowdownReplay(JSON.stringify({ id: "x", log }), PLAY_FORMAT_INFO);
    expect(res.ok && res.replay.format).toBe("gen9doublesou");
    expect(res.ok && res.replay.formatName).toBe("[Gen 9] VGC 2026 Reg I");
  });

  it("reads a tie and an unfinished battle", () => {
    const tie = parseShowdownReplay(LOG.slice(0, -1).concat("|tie").join("\n"), PLAY_FORMAT_INFO);
    expect(tie.ok && tie.replay.winner).toBeNull();
    const open = parseShowdownReplay(LOG.slice(0, -1).join("\n"), PLAY_FORMAT_INFO);
    expect(open.ok && open.replay.reason).toBe("nocontest");
  });

  it("refuses what isn't a battle", () => {
    expect(parseShowdownReplay("", PLAY_FORMAT_INFO).ok).toBe(false);
    expect(parseShowdownReplay("hello world", PLAY_FORMAT_INFO).ok).toBe(false);
    expect(parseShowdownReplay(LOG.map((l) => (l.startsWith("|gametype|") ? "|gametype|triples" : l)).join("\n"), PLAY_FORMAT_INFO).ok).toBe(false);
  });
});

describe("koSteps", () => {
  it("finds the step that shows each faint", () => {
    const res = parseShowdownReplay(LOG.join("\n"), PLAY_FORMAT_INFO);
    expect(res.ok && koSteps(res.replay.log)).toEqual([3]);
  });
});
