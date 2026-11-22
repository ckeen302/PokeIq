import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "@/components/ui/Link";
import { ArrowRight, Bot, Calculator, Castle, Factory, FlaskConical, UserSearch, Users, type LucideIcon } from "lucide-react";
import { GameInfo } from "@/components/seo/GameInfo";
import { HudHeading } from "@/components/game/HudHeading";
import { BATTLE_FORMATS, BATTLE_FORMAT_IDS } from "@/lib/battle/formats";
import { BattleHome } from "@/components/battle/BattleHome";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pagesNs from "@/messages/battle-pages";
import homeNs from "@/messages/battle-home";
import formatsNs from "@/messages/battle-formats";
import teamPickNs from "@/messages/battle-team-pick";
import rulesNs from "@/messages/battle-rules";
import pickersNs from "@/messages/battle-pickers";
import battleGlicko from "@/messages/battle-glicko";
import battleTeams from "@/messages/battle-teams";
import battleTeamInsights from "@/messages/battle-team-insights";
import battleTerms from "@/messages/battle-terms";
import battleInputs from "@/messages/battle-inputs";

export function generateMetadata(): Metadata {
  const t = serverT(pagesNs);
  return pageMetadata({
    title: t("hub.meta.title"),
    description: t("hub.meta.description"),
    path: "/battle",
  });
}

type LiveKey = keyof typeof pagesNs.en.hub.live;
type FrontierKey = keyof typeof pagesNs.en.hub.frontier;

const LIVE: { href: string; icon: LucideIcon; key: LiveKey; wide?: boolean }[] = [
  { href: "/battle/play", icon: Bot, key: "cpu" },
  { href: "/battle/play?vs=anyone", icon: UserSearch, key: "online" },
  { href: "/battle/teams", icon: Users, key: "teams" },
  { href: "/battle/calc", icon: Calculator, key: "calc" },
  { href: "/battle/lab", icon: FlaskConical, key: "lab", wide: true },
];

/** The Battle Frontier: runs against the computer. `href` null: not open yet. */
const FRONTIER: { href: string | null; icon: LucideIcon; key: FrontierKey }[] = [
  { href: "/battle/factory", icon: Factory, key: "factory" },
  { href: "/battle/tower", icon: Castle, key: "tower" },
];

const POINTS = ["p1", "p2", "p3"] as const;

export default function BattlePage() {
  const t = serverT(pagesNs);
  const live = LIVE.map((c) => ({ ...c, title: t(`hub.live.${c.key}.title`), blurb: t(`hub.live.${c.key}.blurb`), points: POINTS.map((p) => t(`hub.live.${c.key}.${p}`)) }));
  const frontier = FRONTIER.map((c) => ({ ...c, title: t(`hub.frontier.${c.key}.title`), blurb: t(`hub.frontier.${c.key}.blurb`), points: POINTS.map((p) => t(`hub.frontier.${c.key}.${p}`)) }));
  return (
    <div className="mx-auto max-w-6xl space-y-12">
      {/* The team picker, custom rules and pickers load with a format that needs them: their words come along. */}
      <ClientMessages namespaces={[homeNs, formatsNs, teamPickNs, rulesNs, pickersNs, battleGlicko, battleTeams, battleTeamInsights, battleTerms, battleInputs]}>
        <BattleHome />
      </ClientMessages>

      <section className="space-y-5">
        <HudHeading index={1} title={t("hub.tools")} aside={<span className="max-md:hidden">{t("hub.liveTag")}</span>} />
        <div className="grid gap-4 md:grid-cols-2">
          {live.map(({ href, icon: Icon, title, blurb, points, wide }) => (
            <Link key={href} href={href} className={`menu-item hud group relative block rounded-lg border bg-card p-6 hover:border-screen/50 max-md:p-4${wide ? " md:col-span-2" : ""}`}>
              <div className="flex items-start gap-4 max-md:gap-3">
                <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen max-md:h-11 max-md:w-11">
                  <Icon className="relative z-[3] h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2 max-md:flex-wrap max-md:gap-y-0.5">
                    <span className="font-display text-xl font-bold uppercase tracking-wide max-md:text-lg max-md:leading-tight">{title}</span>
                    <span className="hud-label flex items-center gap-1.5 text-success max-md:hidden">
                      <span className="led h-1.5 w-1.5 text-success" /> {t("hub.liveTag")}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{blurb}</p>
                  <ul className="space-y-1 pt-1 text-sm max-md:hidden">
                    {points.map((p) => (
                      <li key={p} className="flex items-center gap-2 max-md:items-baseline">
                        <span className="font-pixel text-[9px] text-primary">▶</span> {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground max-md:hidden" aria-hidden />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <HudHeading index={2} title={t("hub.frontierTitle")} aside={<span className="max-md:hidden">{t("hub.frontierAside")}</span>} />
        <div className="grid gap-4 md:grid-cols-2" data-testid="battle-frontier">
          {frontier.map(({ href, icon: Icon, title, blurb, points }) =>
            href ? (
              <Link key={title} href={href} className="menu-item hud group relative block rounded-lg border bg-card p-6 hover:border-screen/50 max-md:p-4">
                <div className="flex items-start gap-4 max-md:gap-3">
                  <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen max-md:h-11 max-md:w-11">
                    <Icon className="relative z-[3] h-6 w-6" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <span className="font-display text-xl font-bold uppercase tracking-wide max-md:block max-md:text-lg max-md:leading-tight">{title}</span>
                    <p className="text-sm text-muted-foreground">{blurb}</p>
                    <ul className="space-y-1 pt-1 text-sm max-md:hidden">
                      {points.map((p) => (
                        <li key={p} className="flex items-center gap-2 max-md:items-baseline">
                          <span className="font-pixel text-[9px] text-primary">▶</span> {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground max-md:hidden" aria-hidden />
                </div>
              </Link>
            ) : (
              <div key={title} className="relative space-y-2 rounded-lg border border-dashed border-foreground/15 bg-card/50 p-5">
                <span className="hud-label absolute right-3 top-3 rounded-sm border border-warning/40 px-1.5 py-1 text-warning">{t("hub.soon")}</span>
                <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
                <h3 className="font-display text-base font-bold uppercase tracking-wide">{title}</h3>
                <p className="text-sm text-muted-foreground">{blurb}</p>
              </div>
            )
          )}
        </div>
      </section>

      <section className="space-y-5 max-md:hidden">
        <HudHeading index={3} title={t("hub.formats")} aside={t("hub.formatsAside")} />
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {BATTLE_FORMAT_IDS.map((id) => {
            const f = BATTLE_FORMATS[id];
            return (
              <div key={id} className="space-y-1 bg-card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display font-bold uppercase tracking-wide">{f.name}</span>
                  <span className="hud-label text-screen">{t(`hub.gameType.${f.gameType}`)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t(`hub.formatBlurb.${id}`)}</p>
              </div>
            );
          })}
        </div>
      </section>
      <GameInfo
        path="/battle"
        hidden
        name={t("hub.info.name")}
        description={t("hub.info.description")}
        intro={t("hub.info.intro")}
        steps={(["step1", "step2", "step3", "step4"] as const).map((k) => t(`hub.info.${k}`))}
        faqs={[{ q: t("hub.info.labQ"), a: t("hub.info.labA") }]}
      />
    </div>
  );
}
