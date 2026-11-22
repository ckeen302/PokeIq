import Link from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { casePath, type TheoryCase } from "@/lib/theories/types";
import { sourceLine } from "@/lib/theories/logic";
import { Art, GlitchBlock, Pin, Stamp, verdictClass } from "./Parts";
import s from "./theories.module.css";
import { useT } from "@/i18n/client";
import dexTheoriesList from "@/messages/dex-theories-list";

/** What a case folder in the grid needs (all a client list is sent). */
export type FolderCase = Pick<TheoryCase, "n" | "slug" | "title" | "verdict" | "summary" | "sources" | "art" | "glitch">;

export const toFolder = ({ n, slug, title, verdict, summary, sources, art, glitch }: TheoryCase): FolderCase => ({ n, slug, title, verdict, summary, sources, art, glitch });

/** One case in the grid: a folder with its case-number tab, a pinned photo and a verdict stamp. */
export function CaseFolder({ c }: { c: FolderCase }) {
  const t = useT(dexTheoriesList);
  const labels = { games: t("source.games"), anime: t("source.anime"), pokedex: t("source.pokedex"), internet: t("source.internet"), manga: t("source.manga") };
  return (
    <Link href={casePath(c.slug)} className={s.case} data-testid="case-folder" data-verdict={c.verdict}>
      <div className={s.folder}>
        <span className={cn(s.mono, s.ftab)}>{t("caseNumber", { n: String(c.n).padStart(3, "0") })}</span>
        <div className={cn(s.shot, verdictClass(c.verdict), c.art.length > 1 && s.two)}>
          <Pin />
          {c.glitch || !c.art.length ? <GlitchBlock /> : c.art.map((a) => <Art key={a.id} id={a.id} alt={a.name} />)}
          <Stamp verdict={c.verdict} label={t(`verdict.${c.verdict}`)} />
        </div>
        <div className={s.cb}>
          <h3 className={s.ct}>{c.title}</h3>
          <p className={cn(s.cs, "m-0")}>{c.summary}</p>
          <div className={s.cfoot}>
            <span className={cn(s.mono, s.src)}>{sourceLine(c, labels)}</span>
            <span className={s.open}>{t("open")}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
