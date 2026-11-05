import Link from "next/link";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { LAB_PATH } from "@/lib/lab";
import { answerText, fmt, resultTitle, sideName, spreadText } from "@/lib/mass-battle/copy";
import { MASS_BATTLE_PATH } from "@/lib/mass-battle/share";
import { nameOf, pickerList, presetCards, type PresetCardData } from "@/lib/mass-battle/page-data";
import { DEFAULT_PLAYBACK, type BattleSpec, type PlaybackSpec, type Question } from "@/lib/mass-battle/types";
import { HudHeading } from "@/components/game/HudHeading";
import { BackButton } from "@/components/ui/BackButton";
import { HowItWorksBody } from "./HowItWorks";
import { MassBattleExperience, type Initial } from "./MassBattleExperience";

/**
 * /lab/mass-battle and each ready-made battle's page: the 3D battle (in the
 * browser), the setup panel, and on the server the presets' results and
 * how the battle works, for search engines and browsers without WebGL.
 */

function presetSummary(p: PresetCardData): string {
  const pure = p.answer?.pure ? ` Pure battle maths, with everyone in reach of everyone: ${p.answer.pure.n > 0 ? `${fmt(p.answer.pure.n)} (${spreadText(p.answer.pure.spread, p.answer.pure.runs)})` : "more than 2,000"}.` : "";
  const answer = p.question && p.answer ? `On the battlefield, ${answerText(p.answer.n, sideName(p.question.army, nameOf)).replace(/^./, (c) => c.toLowerCase())} to beat ${sideName(p.question.boss, nameOf)} (${spreadText(p.answer.spread, p.answer.runs)}).${pure}` : "";
  if (p.kind === "howmany") return answer;
  if (!p.outcome) return answer;
  const names: [string, string] = p.labels ?? [sideName(p.spec.sides[0], nameOf), sideName(p.spec.sides[1], nameOf)];
  const o = p.outcome;
  return `${resultTitle(o.winner, names, o.left)} ${o.winner === 2 ? "" : `${fmt(o.left[o.winner])} left standing after ${o.seconds.toFixed(1)} seconds.`} ${answer}`.trim();
}

export function MassBattlePage({ preset, battle, question, playback }: { preset?: PresetCardData | null; battle?: BattleSpec | null; question?: Question | null; playback?: PlaybackSpec }) {
  const presets = presetCards();
  const list = pickerList();
  const initial: Initial = question ? { kind: "question", q: question } : battle ? { kind: "battle", spec: battle } : preset ? { kind: "preset", id: preset.id } : null;
  const title = preset ? preset.title : "Pokémon Mass Battle";
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${title} · PokéIQ`,
    url: `${SITE_URL}${preset ? `${MASS_BATTLE_PATH}/${preset.id}` : MASS_BATTLE_PATH}`,
    applicationCategory: "GameApplication",
    operatingSystem: "Any (web browser)",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="mass-battle-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <BackButton href={LAB_PATH} label="3D Lab" />
          <p className="hud-label flex items-center gap-2 text-screen">
            <span className="led h-1.5 w-1.5 text-success" aria-hidden /> <Link href={LAB_PATH} className="hover:text-foreground">3D Lab</Link> {"//"} Mass Battle
          </p>
        </div>
        <h1 className="font-display text-3xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl">{preset ? preset.title : <>Pokémon <span className="text-primary">Mass Battle</span></>}</h1>
      </div>
      <MassBattleExperience list={list} presets={presets} initial={initial} playback={playback ?? { ...DEFAULT_PLAYBACK, ...preset?.playback }} />
      <p className="max-w-3xl text-muted-foreground sm:text-lg">
        {preset ? preset.blurb : "Thousands of Pokémon clash on a 3D battlefield, and every hit uses the real games' damage maths. Ask how many of one Pokémon it takes to beat another, or send two armies at each other."}
      </p>

      <section className="space-y-4" aria-labelledby="mb-results">
        <HudHeading index={2} id="mb-results" title="Results" aside="Precomputed with the same battles" />
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="mb-results">
          {presets.map((p) => (
            <li key={p.id} className="rounded-xl border bg-card/60 p-4">
              <Link href={`${MASS_BATTLE_PATH}/${p.id}`} className="font-display text-base font-bold uppercase tracking-tight hover:text-primary">{p.title}</Link>
              <p className="mt-1 text-sm text-muted-foreground">{presetSummary(p)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-xl border bg-card/60 p-4 sm:p-6" aria-labelledby="mb-how">
        <h2 id="mb-how" className="font-display text-xl font-bold uppercase tracking-tight">How it works</h2>
        <HowItWorksBody />
      </section>
    </div>
  );
}
