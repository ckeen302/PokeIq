import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Athlete } from "@/lib/games/athlete";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { EVENT_IDS, formatMark, localNum } from "@/lib/games/events";
import { buildNations, runEvent, runGames } from "@/lib/games/games";
import { DEFAULT_NATIONS, h2hQuestion } from "@/lib/games/deeplink";
import { h2hSummary } from "@/lib/games/h2h";
import { athleteName, gamesNames } from "@/lib/games/names";
import RECORDS from "@/data/games-records.json";
import type { RecordsFile } from "@/lib/games/records";
import { eventShow } from "@/components/games/show/build";
import { gamesShow } from "@/components/games/show/games";
import type { Overlay } from "@/components/games/show/types";
import { translator } from "@/i18n/catalog";
import type { OtherLocale } from "@/i18n/config";
import gamesShowNs from "@/messages/games-show";
import gamesEvents from "@/messages/games-events";

/**
 * The 3D Lab in other languages: the Games' broadcast and head-to-head lines come out in the language with every
 * placeholder filled, the athletes' names follow each language's own pattern for forms, numbers take the language's
 * separators, and English stays exactly as it was.
 */

const LOCALES: OtherLocale[] = ["ja", "es", "fr", "de", "it"];
/** A language's compiled messages (through the same ICU compiler as the build). */
const MSG: Record<string, Record<string, never>> = {};
for (const l of LOCALES) for (const ns of ["games-show", "games-events"]) MSG[`${l}/${ns}`] = (await import(`@/messages/${l}/${ns}.json`)).default;
const json = (l: string, ns: string) => MSG[`${l}/${ns}`];
const FIELD = ["pikachu", "snorlax", "machamp", "magikarp", "wailord", "regieleki", "gyarados", "shuckle"].map((k) => GAMES_BY_KEY.get(k)!);
const byKey = new Map<string, Athlete>(FIELD.map((a) => [a.key, a]));

/** Every string an overlay shows. */
function texts(o: Overlay): string[] {
  const out: string[] = [];
  if (o.bug) out.push(o.bug.title, o.bug.sub);
  if (o.title) out.push(o.title.text, o.title.sub);
  if (o.mark) out.push(o.mark.text, o.mark.sub ?? "");
  if (o.caption) out.push(o.caption);
  if (o.lower) out.push(o.lower.name, o.lower.line, o.lower.tag ?? "");
  if (o.board) out.push(o.board.title, ...o.board.rows.flatMap((r) => [r.place, r.name, r.mark, r.note ?? ""]));
  if (o.tagText) out.push(...Object.values(o.tagText));
  return out;
}

describe("the Games' broadcast in every language", () => {
  for (const l of LOCALES) {
    const tr = translator(gamesShowNs, l, json(l, "games-show"));
    it(`${l}: every event's graphics are filled in`, () => {
      for (const ev of EVENT_IDS) {
        const field = ev === "wrestling" || ev === "all-around" ? FIELD : FIELD.slice(0, 6);
        const out = runEvent(ev, field, 7, {});
        const seq = eventShow(out, byKey, { budget: 40 }, tr);
        expect(seq.headline, ev).not.toBe("");
        for (let t = 0; t < seq.end; t += 0.5) {
          for (const s of texts(seq.overlay(t))) expect(s, `${l} ${ev} @${t}`).not.toMatch(/[{}]/);
        }
        for (const b of seq.beats) if (b.title) expect(b.title).not.toMatch(/[{}]/);
      }
    });
    it(`${l}: the Games' medal tables and ceremonies are filled in`, () => {
      const nations = buildNations(DEFAULT_NATIONS.slice(0, 3), GAMES_BY_KEY, (RECORDS as unknown as RecordsFile).nations);
      const parts = gamesShow(runGames(nations, 3, {}), GAMES_BY_KEY, { budget: 20 }, tr).parts;
      for (const p of parts) for (let t = 0; t < p.end; t += 1) for (const s of texts(p.overlay(t))) expect(s).not.toMatch(/[{}]/);
    });
  }

  it("English reads as it always did", () => {
    const out = runEvent("long-jump", FIELD.slice(0, 6), 7, {});
    const a = eventShow(out, byKey, { budget: 40 });
    const b = eventShow(out, byKey, { budget: 40 }, translator(gamesShowNs, "en", undefined));
    expect(b.headline).toBe(a.headline);
    expect(a.headline).toMatch(/^.+ wins with \d+\.\d\d m$/);
    expect(a.overlay(0)).toEqual(b.overlay(0));
  });
});

describe("head to heads", () => {
  it("ask the question in each language", () => {
    expect(h2hQuestion("100m", "Pikachu", "Snorlax")).toBe("Can Pikachu outrun Snorlax?");
    expect(h2hQuestion("wrestling", "A", "B")).toBe("Can A push B out of the ring?");
    expect(h2hQuestion("100m", "Pikachu", "Ronflex", translator(gamesEvents, "fr", json("fr", "games-events")))).toBe("Pikachu peut-il courir plus vite que Ronflex ?");
    expect(h2hQuestion("high-jump", "ピカチュウ", "カビゴン", translator(gamesEvents, "ja", json("ja", "games-events")))).toBe("ピカチュウはカビゴンより高く跳べる？");
  });
  it("read the result in the language, with its own numbers", () => {
    const out = runEvent("100m", [GAMES_BY_KEY.get("pikachu")!, GAMES_BY_KEY.get("snorlax")!], 7, {});
    const en = h2hSummary(out, GAMES_BY_KEY.get("pikachu")!, GAMES_BY_KEY.get("snorlax")!);
    const de = h2hSummary(out, GAMES_BY_KEY.get("pikachu")!, GAMES_BY_KEY.get("snorlax")!, translator(gamesEvents, "de", json("de", "games-events")));
    expect(en.line).toMatch(/^Pikachu wins by \d+\.\d\d s$/);
    expect(de.line).toMatch(/^Pikachu gewinnt mit \d+,\d\d s Vorsprung$/);
  });
});

describe("names and numbers", () => {
  const a = (k: string) => GAMES_BY_KEY.get(k)!;
  it("give forms each language's own pattern", () => {
    expect(athleteName(a("pikachu"), "en")).toBe("Pikachu");
    expect(athleteName(a("charizard-mega-x"), "fr")).toBe("Méga-Dracaufeu X");
    expect(athleteName(a("charizard-mega-x"), "ja")).toBe("メガリザードンX");
    expect(athleteName(a("raichu-alola"), "de")).toBe("Alola-Raichu");
    expect(athleteName(a("raichu-alola"), "es")).toBe("Raichu de Alola");
    expect(athleteName(a("snorlax"), "ja")).toBe("カビゴン");
  });
  it("send the roster's names only for other languages, with English as an alias", () => {
    expect(gamesNames("en")).toBeNull();
    const ja = gamesNames("ja")!;
    expect(ja.names.pikachu).toBe("ピカチュウ");
    expect(ja.aliases.pikachu).toContain("Pikachu");
  });
  it("write numbers the language's way", () => {
    expect(localNum("1,234.56 kg", "de")).toBe("1.234,56 kg");
    expect(localNum("1,234.56", "fr")).toBe("1 234,56");
    expect(localNum("1,234.5", "es")).toBe("1234,5");
    expect(localNum("12,345", "es")).toBe("12.345");
    expect(localNum("9.58 s", "ja")).toBe("9.58 s");
    expect(formatMark("100m", 9.581)).toBe("9.59 s");
    expect(formatMark("100m", 9.581, "it")).toBe("9,59 s");
    expect(formatMark("all-around", 8123, "de")).toBe("8.123 Pkt.");
  });
});

describe("the site's rules in every language", () => {
  it("never say the word", () => {
    const banned = /olymp|olímpic|olimpic|オリンピック|五輪/i;
    for (const l of ["en", ...LOCALES]) {
      for (const f of readdirSync(join("src/messages", l)).filter((x) => /^(lab|games-|mass-battle)/.test(x))) {
        expect(readFileSync(join("src/messages", l, f), "utf8"), `${l}/${f}`).not.toMatch(banned);
      }
    }
  });
});
