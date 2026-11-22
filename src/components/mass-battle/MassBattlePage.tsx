import Link from "@/components/ui/PlainLink";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { LAB_PATH } from "@/lib/lab";
import { answerText, fmt, resultTitle, sideName, spreadText, type CopyT } from "@/lib/mass-battle/copy";
import { MASS_BATTLE_PATH } from "@/lib/mass-battle/share";
import { nameOf, pickerList, presetCards, type PresetCardData } from "@/lib/mass-battle/page-data";
import { localPickerList, localPreset, mbNameOf, mbNames } from "@/lib/mass-battle/i18n";
import { typeName } from "@/lib/games/names";
import { localNum } from "@/lib/games/events";
import { DEFAULT_PLAYBACK, type BattleSpec, type PlaybackSpec, type Question } from "@/lib/mass-battle/types";
import { HudHeading } from "@/components/game/HudHeading";
import { BackButton } from "@/components/ui/BackButton";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import type { Translator } from "@/i18n/catalog";
import mbCopy from "@/messages/mass-battle-copy";
import mbHow from "@/messages/mass-battle-how";
import mbPages from "@/messages/mass-battle-pages";
import mbSetup from "@/messages/mass-battle-setup";
import mbUi from "@/messages/mass-battle-ui";
import { HowItWorksBody } from "./HowItWorks";
import { MassBattleExperience, type Initial } from "./MassBattleExperience";
import { MbNamesProvider } from "./names";

/**
 * /lab/mass-battle and each ready-made battle's page: the 3D battle (in the
 * browser), the setup panel, and on the server the presets' results and
 * how the battle works, for search engines and browsers without WebGL.
 */

function presetSummary(p: PresetCardData, t: Translator<typeof mbPages.en>, c: CopyT, name: (id: number) => string, ty: (type: string) => string): string {
  const lc = t.locale;
  const side = (s: Parameters<typeof sideName>[0]) => sideName(s, name, undefined, c, lc === "en" ? undefined : ty);
  const pure = p.answer?.pure ? t("summary.pure", { answer: p.answer.pure.n > 0 ? t("summary.pureN", { n: fmt(p.answer.pure.n, lc), spread: spreadText(p.answer.pure.spread, p.answer.pure.runs, c) }) : t("summary.pureMore") }) : "";
  const answer = p.question && p.answer ? t("summary.answer", { answer: lc === "de" ? answerText(p.answer.n, side(p.question.army), c) : answerText(p.answer.n, side(p.question.army), c).replace(/^./, (x) => x.toLowerCase()), boss: side(p.question.boss), spread: spreadText(p.answer.spread, p.answer.runs, c), pure }) : "";
  if (p.kind === "howmany") return answer;
  if (!p.outcome) return answer;
  const names: [string, string] = p.labels ?? [side(p.spec.sides[0]), side(p.spec.sides[1])];
  const o = p.outcome;
  return `${resultTitle(o.winner, names, o.left, c)} ${o.winner === 2 ? "" : t("summary.left", { n: fmt(o.left[o.winner], lc), s: localNum(o.seconds.toFixed(1), lc) })} ${answer}`.trim();
}

export function MassBattlePage({ preset, battle, question, playback }: { preset?: PresetCardData | null; battle?: BattleSpec | null; question?: Question | null; playback?: PlaybackSpec }) {
  const t = serverT(mbPages);
  const c = serverT(mbCopy);
  const lc = t.locale;
  const local = (p: PresetCardData) => localPreset(p, t);
  const presets = presetCards().map(local);
  const list = localPickerList(pickerList(), lc);
  const name = mbNameOf(lc, nameOf);
  const ty = (x: string) => typeName(x.toLowerCase(), lc);
  const shown = preset ? local(preset) : null;
  const initial: Initial = question ? { kind: "question", q: question } : battle ? { kind: "battle", spec: battle } : preset ? { kind: "preset", id: preset.id } : null;
  const title = shown ? shown.title : t("name");
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: t("ldName", { title }),
    url: `${SITE_URL}${preset ? `${MASS_BATTLE_PATH}/${preset.id}` : MASS_BATTLE_PATH}`,
    applicationCategory: "GameApplication",
    operatingSystem: "Any (web browser)",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const names = mbNames(lc);
  const experience = (
    <ClientMessages namespaces={[mbUi, mbSetup, mbCopy, mbHow]}>
      <MassBattleExperience list={list} presets={presets} initial={initial} playback={playback ?? { ...DEFAULT_PLAYBACK, ...preset?.playback }} />
    </ClientMessages>
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="mass-battle-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <BackButton href={LAB_PATH} label={t("lab")} />
          <p className="hud-label flex items-center gap-2 text-screen max-sm:hidden">
            <span className="led h-1.5 w-1.5 text-success" aria-hidden /> <Link href={LAB_PATH} className="hover:text-foreground">{t("lab")}</Link> {"//"} {t("kicker")}
          </p>
        </div>
        <h1 className="font-display text-3xl font-bold uppercase leading-[0.95] tracking-tight max-sm:sr-only sm:text-5xl">{shown ? shown.title : t.rich("h1", { b: (x) => <span className="text-primary">{x}</span> })}</h1>
      </div>
      {names ? <MbNamesProvider value={names}>{experience}</MbNamesProvider> : experience}
      <p className="max-w-3xl text-muted-foreground sm:text-lg">
        {shown ? shown.blurb : t("blurb")}
      </p>

      <section className="space-y-4" aria-labelledby="mb-results">
        <HudHeading index={2} id="mb-results" title={t("results")} aside={t("resultsAside")} />
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="mb-results">
          {presets.map((p) => (
            <li key={p.id} className="rounded-xl border bg-card/60 p-4">
              <Link href={`${MASS_BATTLE_PATH}/${p.id}`} className="font-display text-base font-bold uppercase tracking-tight hover:text-primary">{p.title}</Link>
              <p className="mt-1 text-sm text-muted-foreground">{presetSummary(p, t, c, name, ty)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-xl border bg-card/60 p-4 sm:p-6" aria-labelledby="mb-how">
        <h2 id="mb-how" className="font-display text-xl font-bold uppercase tracking-tight">{t("how")}</h2>
        <HowItWorksBody t={serverT(mbHow)} />
      </section>
    </div>
  );
}
