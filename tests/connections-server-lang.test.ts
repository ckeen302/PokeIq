import { expect, it } from "vitest";
import { checkGuesses, practiceConnPuzzle } from "@/lib/server/connections";
import { effectiveDaily } from "@/lib/server/connections-social";
import { ENGLISH_ONLY } from "@/lib/connections/localize";

it("patch: a localized daily plays through in French", async () => {
  const date = "2026-10-23";
  const en = await effectiveDaily(date, null);
  const fr = await effectiveDaily(date, null, "fr");
  expect(en.groups.some((g) => ENGLISH_ONLY.has(g.category))).toBe(true);
  expect(fr.groups.some((g) => ENGLISH_ONLY.has(g.category))).toBe(false);
  const out = checkGuesses(fr, fr.groups.map((g) => g.members), "fr");
  expect(out.won).toBe(true);
  console.log(out.reveal!.map((g) => `${g.label} | ${g.rule} | ${g.lines.map((l) => l.why).join("; ")} | ${g.herrings.map((h) => h.reason).join("; ")}`).join("\n"));
  const ja = checkGuesses(fr, fr.groups.map((g) => g.members), "ja");
  console.log(ja.reveal!.map((g) => `${g.label} | ${g.rule} | ${g.lines.map((l) => l.why).join("; ")}`).join("\n"));
  const p = practiceConnPuzzle("normal-abcdefgh", "de");
  expect(p.groups.some((g) => ENGLISH_ONLY.has(g.category))).toBe(false);
});
