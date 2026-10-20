import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { TeamValidator } from "pokemon-showdown";
import { PLAY_FORMAT_INFO, PLAY_FORMATS } from "@/lib/battle/play";
import { exportShowdown, packTeam, type TeamSet } from "@/lib/battle/sets";
import { prepareTeam, quickTeam } from "@/lib/server/battle-engine/teams";
import { POST as quickRoute } from "@/app/api/battle/quick/route";

const TEAM_FORMATS = PLAY_FORMATS.filter((f) => !PLAY_FORMAT_INFO[f].random);

function post(body: unknown) {
  return quickRoute(
    new NextRequest("http://localhost/api/battle/quick", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.42" },
      body: JSON.stringify(body),
    })
  );
}

describe("quick teams", () => {
  it("covers every team format", () => {
    expect(TEAM_FORMATS).toEqual(expect.arrayContaining(["gen9ou", "gen9ubers", "gen9uu", "gen9doublesou"]));
  });

  for (const format of TEAM_FORMATS) {
    it(`deals six legal ${PLAY_FORMAT_INFO[format].short} sets that a battle accepts`, () => {
      const validator = TeamValidator.get(format);
      for (const seed of ["1,2,3,4", "9,9,9,9", "40,3,17,8"]) {
        const sets = quickTeam(format, seed);
        expect(sets).toHaveLength(6);
        expect(sets.every((s) => s.name === "" && s.moves.length > 0)).toBe(true);
        expect(validator.validateTeam(structuredClone(sets))).toBeNull();
        // The packed (saved-team) and export (pasted) forms both get in.
        expect(prepareTeam(format, packTeam(sets))).toMatchObject({ ok: true, size: 6 });
        expect(prepareTeam(format, exportShowdown(sets))).toMatchObject({ ok: true, size: 6 });
      }
    });
  }

  it("serves a quick team for each team format, and refuses random formats", async () => {
    for (const format of TEAM_FORMATS) {
      const res = await post({ format });
      expect(res.status).toBe(200);
      const { sets } = (await res.json()) as { sets: TeamSet[] };
      expect(prepareTeam(format, packTeam(sets)).ok).toBe(true);
    }
    expect((await post({ format: "gen9randombattle" })).status).toBe(400);
    expect((await post({ format: "gen9madeup" })).status).toBe(400);
    expect(() => quickTeam("gen9randombattle")).toThrow();
  });
});
