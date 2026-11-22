import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { SimSession, randomTeam, type SideID } from "@/lib/server/battle-engine/engine";
import { randomChoice } from "@/lib/server/battle-engine/choices";
import { BattleModel } from "@/components/battle/play/model";
import { logLocal } from "@/lib/battle/log/local";
import { battleNames, type BattleNameTable } from "@/lib/battle/log/names";
import type { Tree } from "@/i18n/catalog";
import ja from "@/messages/ja/battle-log.json";
import es from "@/messages/es/battle-log.json";
import fr from "@/messages/fr/battle-log.json";
import de from "@/messages/de/battle-log.json";
import itl from "@/messages/it/battle-log.json";

const M = { ja, es, fr, de, it: itl } as Record<string, unknown>;

it("dump", () => {
  const locale = process.env.LOC ?? "ja";
  const fmt = process.env.FMT ?? "gen9randombattle";
  const table = JSON.parse(readFileSync(`src/data/i18n/${locale}/battle-names.json`, "utf8")) as BattleNameTable;
  const local = logLocal(locale as "ja", M[locale] as Tree, battleNames(table));
  const s = (n: number) => `3,${n},${3 + n},9`;
  const session = SimSession.create({ formatid: fmt, seed: s(1), p1: { name: "Red", team: randomTeam(fmt, s(2)) }, p2: { name: "Blue", team: randomTeam(fmt, s(3)) } });
  const lines: string[] = [];
  const take = () => lines.push(...session.result().lines.p1);
  take();
  let x = 1;
  const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200 && !session.ended; i++) {
    for (const side of ["p1", "p2"] as SideID[]) {
      const req = session.pending(side);
      if (req) session.choose(side, randomChoice(req as never, fmt.includes("doubles"), rand));
    }
    take();
  }
  const model = new BattleModel("p1", local);
  const en = new BattleModel("p1");
  const out: string[] = [];
  for (const l of lines) {
    const a = model.feed(l);
    const b = en.feed(l);
    if (a?.text.trim() || b?.text.trim()) out.push(`${(b?.text ?? "").trim().replace(/\n/g, " / ")}\n    ${(a?.text ?? "").trim().replace(/\n/g, " / ")}`);
  }
  writeFileSync(`/tmp/claude-0/-home-user-PokeIq/e5ffd108-2d6d-5348-9610-20fb6c07ecfc/scratchpad/bl/out-${locale}.txt`, out.join("\n"));
});
