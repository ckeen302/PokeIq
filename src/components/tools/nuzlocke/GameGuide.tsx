/* eslint-disable @next/next/no-img-element -- the site's own pre-sized Pokémon pictures, lazy */
import "server-only";
import { ArrowLeft, Medal, Swords } from "lucide-react";
import Link from "@/components/ui/Link";
import { jsonLd } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { getLocale, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import { INTL_LOCALE } from "@/i18n/format";
import type { Translator } from "@/i18n/catalog";
import { localizePath } from "@/i18n/paths";
import page from "@/messages/nuzlocke-page";
import nuz from "@/messages/nuzlocke";
import tools from "@/messages/tools";
import { toolJsonLd } from "@/lib/tier-list/seo";
import { groupByMethod, levelSpan, type EncounterRow } from "@/lib/nuzlocke/group";
import { artSrc, capFor, type GameSummary, type GameView, type ViewArea, type ViewBoss } from "@/lib/nuzlocke/view";
import { versionColor } from "@/lib/nuzlocke/versions";
import { cn } from "@/lib/utils";
import { GameStart } from "./GameStart";
import { methodIcon } from "./icons";

/**
 * A game's page, rendered on the server (it's the page search engines read): every area in story order with every
 * Pokémon met there (how, how often and at what level, in which version), the bosses between them with their level
 * caps, the other areas, and the data's sources. The big button starts a run in the game.
 */

const PATH = "/tools/nuzlocke-tracker";
type PageT = Translator<typeof page.en>;

export function gameTitle(view: Pick<GameView, "name">): string {
  return serverT(page)("game.title", { name: view.name });
}

function versionNames(view: GameView, ids: readonly string[]): string {
  return ids.map((id) => view.versions.find((v) => v.id === id)?.name ?? id).join(" & ");
}

/** A Pokémon's line: its version tag (an exclusive), then each line of the data ("1F 69%", "FireRed 20%"), then its levels. */
function rowText(t: PageT, view: GameView, row: EncounterRow): { only: string[] | null; text: string } {
  const sets = new Set(row.stats.map((s) => s.versions?.join(",") ?? "*"));
  const union = new Set(row.stats.flatMap((s) => s.versions ?? view.versions.map((v) => v.id)));
  const only = !sets.has("*") && union.size < view.versions.length ? [...union] : null;
  const lines = row.stats.map((s) => [sets.size > 1 && s.versions ? versionNames(view, s.versions) : null, s.condition, s.rate !== undefined ? t("game.rate", { n: s.rate }) : null].filter(Boolean).join(" "));
  const span = levelSpan(row.stats);
  const parts = [...new Set(lines.filter(Boolean))];
  if (span) parts.push(span[0] === span[1] ? t("game.level", { n: span[0] }) : t("game.levels", { min: span[0], max: span[1] }));
  return { only, text: parts.join(" · ") };
}

function AreaBlock({ t, view, area }: { t: PageT; view: GameView; area: ViewArea }) {
  const groups = groupByMethod(area.encounters);
  return (
    <li className="rounded-[22px] border border-foreground/[0.08] bg-card p-4 shadow-[0_16px_40px_-34px_hsl(var(--shade)/0.9)] sm:p-5" id={`area-${area.id}`} data-testid="nz-guide-area">
      <h3 className="font-display text-[19px] font-bold tracking-tight">{area.name}</h3>
      {groups.length === 0 ? (
        <p className="mt-1 text-[14px] text-muted-foreground">{t("game.noEncounters")}</p>
      ) : (
        <div className="mt-3 space-y-3.5">
          {groups.map((g) => {
            const Icon = methodIcon(g.method, g.kind);
            const kind = g.kind !== "wild" && g.method.toLowerCase() !== t(`game.kinds.${g.kind}`).toLowerCase() ? t(`game.kinds.${g.kind}`) : null;
            return (
              <div key={`${g.kind}|${g.method}`}>
                <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {g.method}
                  {kind && <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[10.5px] tracking-[0.08em]">{kind}</span>}
                </p>
                <ul className="grid gap-x-2 sm:grid-cols-2 lg:grid-cols-3">
                  {g.rows.map((row) => {
                    const mon = view.mons[row.mon];
                    if (!mon) return null;
                    const { only, text } = rowText(t, view, row);
                    return (
                      <li key={row.mon}>
                        <Link href={`/pokemon/${mon.slug}`} className="flex min-h-12 items-center gap-2.5 rounded-xl px-1.5 py-1 transition-colors hover:bg-foreground/[0.05]">
                          <img src={artSrc(mon.art)} alt="" width={40} height={40} loading="lazy" decoding="async" className="h-10 w-10 shrink-0 object-contain" />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-[14.5px] font-semibold leading-tight">{mon.name}</span>
                              {only && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-1.5 py-px text-[11px] font-semibold text-foreground/80">
                                  <span className="h-2 w-2 rounded-full" style={{ background: versionColor(only[0]) }} aria-hidden />
                                  {t("game.only", { version: versionNames(view, only) })}
                                </span>
                              )}
                            </span>
                            {text && <span className="block text-[12.5px] leading-snug text-muted-foreground [font-variant-numeric:tabular-nums]">{text}</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}

function BossLine({ t, view, boss }: { t: PageT; view: GameView; boss: ViewBoss }) {
  const caps = view.versions.map((v) => [v, capFor(boss, v.id)] as const);
  const same = new Set(caps.map(([, c]) => c)).size === 1;
  const cap = same ? (caps[0]?.[1] !== undefined ? t("game.levelCap", { n: caps[0][1]! }) : null) : caps.filter(([, c]) => c !== undefined).map(([v, c]) => `${v.name}: ${t("game.levelCap", { n: c! })}`).join(" · ");
  const Icon = boss.badge ? Medal : Swords;
  return (
    <li className="flex items-center gap-3 py-1" data-testid="nz-guide-boss">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-foreground/[0.14]" aria-hidden />
      <span className="flex max-w-[85%] flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.08)] px-4 py-2 text-center text-[14px] font-semibold">
        <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
        <span>{boss.name}</span>
        {boss.badge && <span className="text-muted-foreground">· {boss.badge}</span>}
        {cap && <span className="text-foreground/90">· {cap}</span>}
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-foreground/[0.14]" aria-hidden />
    </li>
  );
}

export function GameGuide({ view, game }: { view: GameView; game: GameSummary }) {
  const t = serverT(page);
  const locale = getLocale();
  const path = `${PATH}/${view.id}`;
  const title = t("game.title", { name: view.name });
  const versions = new Intl.ListFormat(INTL_LOCALE[locale], { type: "disjunction" }).format(view.versions.map((v) => v.name));
  const [app] = toolJsonLd({ name: title, path, description: t("game.metaDescription", { name: view.name }), features: ["Nuzlocke tracker", "Encounters by area in story order", "Level caps"], ...(locale !== "en" && { locale }) });
  const at = (p: string) => localizePath(p, locale);
  const ld = jsonLd([
    app,
    breadcrumbList([
      { name: serverT(tools)("hub.title"), path: at("/tools") },
      { name: t("title"), path: at(PATH) },
      { name: view.name, path: at(path) },
    ]),
  ]);
  return (
    <div className="mx-auto max-w-5xl" data-testid="nuzlocke-game">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <Link href={PATH} className="inline-flex h-10 items-center gap-1.5 rounded-full pr-3 text-[14px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t("game.back")}
      </Link>
      <header className="mt-2 space-y-3">
        <p className="flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {view.versions.map((v) => (
            <span key={v.id} className="h-2.5 w-2.5 rounded-full" style={{ background: versionColor(v.id) }} aria-hidden />
          ))}
          {t("games.regionGen", { region: view.region, gen: view.gen })}
        </p>
        <h1 className="font-display text-5xl font-bold tracking-tight max-sm:text-[32px] max-sm:leading-tight">{title}</h1>
        <p className="max-w-3xl text-[17px] text-muted-foreground max-sm:text-[15px]">{t("game.lead")}</p>
        <div className="pt-2">
          <ClientMessages namespaces={[nuz]}>
            <GameStart game={game} label={t("game.start", { versions })} />
          </ClientMessages>
        </div>
      </header>

      <section className="mt-12 max-sm:mt-9" aria-labelledby="nz-story">
        <h2 id="nz-story" className="mb-4 font-display text-2xl font-semibold tracking-tight">
          {t("game.story")}
        </h2>
        <ol className="space-y-3">
          {view.steps.map((s, i) => (s.type === "area" ? <AreaBlock key={s.area.id} t={t} view={view} area={s.area} /> : <BossLine key={`${s.boss.key}-${i}`} t={t} view={view} boss={s.boss} />))}
        </ol>
      </section>

      {view.extra.length > 0 && (
        <section className="mt-12" aria-labelledby="nz-other">
          <h2 id="nz-other" className="font-display text-2xl font-semibold tracking-tight">
            {t("game.other")}
          </h2>
          <p className="mb-4 mt-1 text-[15px] text-muted-foreground">{t("game.otherLead")}</p>
          <ol className="space-y-3">
            {view.extra.map((a) => (
              <AreaBlock key={a.id} t={t} view={view} area={a} />
            ))}
          </ol>
        </section>
      )}

      <details className={cn("group mt-12 rounded-[22px] border border-dashed border-foreground/[0.14] p-5")}>
        <summary className="cursor-pointer text-[15px] font-semibold marker:text-muted-foreground">{t("game.sources")}</summary>
        <p className="mt-2 text-[13.5px] text-muted-foreground">{t("game.sourcesLead")}</p>
        <ul className="mt-2 space-y-1 text-[13px] [overflow-wrap:anywhere]">
          {view.sources.map((u) => (
            <li key={u}>
              <a href={u} target="_blank" rel="noopener nofollow" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                {u.replace(/^https?:\/\//, "")}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
