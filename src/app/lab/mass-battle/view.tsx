import type { Metadata } from "next";

/**
 * The Mass Battle Lab's page, for its two routes: /lab/mass-battle itself (static, page.tsx) and a shared link with
 * ?b=, ?ask= or ?v=, which next.config rewrites to /lab/mass-battle/shared (rendered per link, with its own card).
 */
import { pageMetadata } from "@/lib/seo";
import { MASS_BATTLE_LIVE } from "@/lib/lab";
import { encodeBattle, encodeQuestion, MASS_BATTLE_PATH } from "@/lib/mass-battle/share";
import { linkBattle, linkPlayback, linkQuestion, nameOf, slugIndex } from "@/lib/mass-battle/page-data";
import { fmt, questionText, sideName } from "@/lib/mass-battle/copy";
import { buildRoster } from "@/lib/mass-battle/roster-data";
import { expandSpec, factsOf } from "@/lib/mass-battle/sets";
import { MassBattlePage } from "@/components/mass-battle/MassBattlePage";
import { mbNameOf } from "@/lib/mass-battle/i18n";
import { typeName } from "@/lib/games/names";
import { serverT } from "@/i18n/server";
import mbCopy from "@/messages/mass-battle-copy";
import mbPages from "@/messages/mass-battle-pages";

/** A battle, question or playback link's query (?b=, ?ask=, ?v=). */
export type MassBattleQuery = { b?: string | string[]; ask?: string | string[]; v?: string | string[] };

/** The page's metadata: the Lab's own, or a shared battle's or question's (with its card). */
export function massBattleMetadata(sp: MassBattleQuery): Metadata {
  const q = linkQuestion(sp.ask);
  const b = q ? null : linkBattle(sp.b);
  const slugs = slugIndex();
  const t = serverT(mbPages);
  const c = serverT(mbCopy);
  const lc = t.locale;
  const name = mbNameOf(lc, nameOf);
  const ty = lc === "en" ? undefined : (x: string) => typeName(x.toLowerCase(), lc);
  const side = (s: Parameters<typeof sideName>[0]) => sideName(s, name, undefined, c, ty);
  if (q) {
    const title = questionText(side(q.army), side(q.boss), c);
    const code = encodeQuestion(q, slugs);
    return pageMetadata({ title, description: t("meta.questionDescription", { title }), path: `${MASS_BATTLE_PATH}?ask=${code}`, image: { url: `${MASS_BATTLE_PATH}/og?ask=${code}`, alt: title }, noindex: true });
  }
  if (b) {
    const x = expandSpec(b, buildRoster().species.map(factsOf));
    const army = (s: 0 | 1) => t("meta.battleSide", { n: fmt(x.sides[s].units.reduce((a, u) => a + u.count, 0), lc), name: side(b.sides[s]) });
    const title = t("meta.battleTitle", { a: army(0), b: army(1) });
    const code = encodeBattle(b, slugs);
    return pageMetadata({ title, description: t("meta.battleDescription", { title }), path: `${MASS_BATTLE_PATH}?b=${code}`, image: { url: `${MASS_BATTLE_PATH}/og?b=${code}`, alt: title }, noindex: true });
  }
  return pageMetadata({ title: t("meta.title"), description: t("meta.description"), path: MASS_BATTLE_PATH, socialTitle: t("meta.social"), noindex: !MASS_BATTLE_LIVE });
}

export function MassBattleView({ sp }: { sp: MassBattleQuery }) {
  const question = linkQuestion(sp.ask);
  const battle = question ? null : linkBattle(sp.b);
  return <MassBattlePage question={question} battle={battle} playback={linkPlayback(sp.v)} />;
}
