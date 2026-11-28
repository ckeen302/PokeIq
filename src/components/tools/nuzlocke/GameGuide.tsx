import "server-only";
import { ArrowLeft, Medal, Swords, VenetianMask } from "lucide-react";
import Link from "@/components/ui/Link";
import { jsonLd } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { getLocale, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import { INTL_LOCALE } from "@/i18n/format";
import type { Translator } from "@/i18n/catalog";
import { localizePath } from "@/i18n/paths";
import { localeHref } from "@/i18n/href";
import type { Locale } from "@/i18n/config";
import page from "@/messages/nuzlocke-page";
import nuz from "@/messages/nuzlocke";
import tools from "@/messages/tools";
import { toolJsonLd } from "@/lib/tier-list/seo";
import { groupByMethod, levelSpan, methodLabel, postStats, storyStats, type EncounterRow, type EncounterStat } from "@/lib/nuzlocke/group";
import { capFor, inVersion, type GameSummary, type GameView, type ViewArea, type ViewBoss } from "@/lib/nuzlocke/view";
import { versionColor } from "@/lib/nuzlocke/versions";
import { cn } from "@/lib/utils";
import { GameStart } from "./GameStart";
import { GuideList, type GuideGroup, type GuideRow } from "./GuideList";
import { METHOD_ICONS, methodIconKey } from "./icons";
import "./nuzlocke.css";

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

/** The text of some of a row's lines: each line of the data ("1F 69%", "FireRed 20%") or of a summary ("Overcast · Rain · 1–20%"), then the levels. */
function linesText(t: PageT, view: GameView, stats: readonly EncounterStat[], versionTags: boolean): string {
  const lines = stats.map((s) => {
    const rate = s.rate === undefined ? null : s.rateMin !== undefined ? t("game.rates", { min: s.rateMin, max: s.rate }) : t("game.rate", { n: s.rate });
    const summed = !!s.when || s.rateMin !== undefined;
    return [versionTags && s.versions ? versionNames(view, s.versions) : null, s.condition, ...(s.when ?? []), rate].filter(Boolean).join(summed ? " · " : " ");
  });
  const span = levelSpan(stats);
  const parts = [...new Set(lines.filter(Boolean))];
  if (span) parts.push(span[0] === span[1] ? t("game.level", { n: span[0] }) : t("game.levels", { min: span[0], max: span[1] }));
  return parts.join(" · ");
}

/**
 * A Pokémon's line: its version tag (an exclusive), then its story-time lines; and, apart, its post-game lines ("After
 * the Hall of Fame: Lv 60"), never summed up with the story's.
 */
function rowText(t: PageT, view: GameView, row: EncounterRow): { only: string[] | null; text: string; post: string } {
  const sets = new Set(row.stats.map((s) => s.versions?.join(",") ?? "*"));
  const union = new Set(row.stats.flatMap((s) => s.versions ?? view.versions.map((v) => v.id)));
  const only = !sets.has("*") && union.size < view.versions.length ? [...union] : null;
  const by = new Map<string, EncounterStat[]>();
  for (const s of postStats(row.stats)) by.set(s.post!, [...(by.get(s.post!) ?? []), s]);
  const post = [...by].map(([when, lines]) => t("game.post", { when, text: linesText(t, view, lines, sets.size > 1) })).join(" · ");
  return { only, text: linesText(t, view, storyStats(row.stats), sets.size > 1), post };
}

/** A small grey tag beside a boss's name ("Optional"). */
function Tag({ children }: { children: React.ReactNode }) {
  return <i className="nzg-only nzg-tag shrink-0">{children}</i>;
}

/** "Sword only": a boss met in some versions only (a version's own Gym Leader). */
function VersionsOnly({ t, view, ids }: { t: PageT; view: GameView; ids: readonly string[] }) {
  return (
    <i className="nzg-only shrink-0" style={{ "--v": versionColor(ids[0]) } as React.CSSProperties} data-testid="nz-boss-only">
      {t("game.only", { version: versionNames(view, ids) })}
    </i>
  );
}

/** The method icons, drawn once: each area's headings point at them (<use>), so a long page carries each icon once. */
function IconSheet() {
  return (
    <svg aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        {Object.entries(METHOD_ICONS).map(([key, Icon]) => (
          <symbol key={key} id={`nzi-${key}`} viewBox="0 0 24 24">
            <Icon />
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

/** An area's Pokémon as rows of data, by way of meeting them; GuideList writes them out (see there for why). */
function areaGroups(t: PageT, view: GameView, area: ViewArea, locale: Locale): GuideGroup[] {
  return groupByMethod(area.encounters).map((g) => {
    const kind = g.kind !== "wild" && g.method.toLowerCase() !== t(`game.kinds.${g.kind}`).toLowerCase() ? t(`game.kinds.${g.kind}`) : null;
    const rows = g.rows.flatMap((row): GuideRow[] => {
      const mon = view.mons[row.mon];
      if (!mon) return [];
      const { only, text, post } = rowText(t, view, row);
      const href = localeHref(`/pokemon/${mon.slug}`, locale).href;
      const tag: [string, string] | [] = only ? [t("game.only", { version: versionNames(view, only) }), versionColor(only[0])] : [];
      return [post ? [href, mon.art, mon.name, text, tag[0] ?? "", tag[1] ?? "", post] : only ? [href, mon.art, mon.name, text, tag[0]!, tag[1]!] : [href, mon.art, mon.name, text]];
    });
    return [methodIconKey(g.method, g.kind), methodLabel(g.method), kind, rows];
  });
}

function AreaBlock({ t, view, area, locale }: { t: PageT; view: GameView; area: ViewArea; locale: Locale }) {
  return (
    <li className="rounded-[22px] border border-foreground/[0.08] bg-card p-4 shadow-[0_16px_40px_-34px_hsl(var(--shade)/0.9)] sm:p-5" id={`area-${area.id}`} data-testid="nz-guide-area">
      <h3 className="font-display text-[19px] font-bold tracking-tight">{area.name}</h3>
      {area.encounters.length === 0 ? <p className="mt-1 text-[14px] text-muted-foreground">{t("game.noEncounters")}</p> : <GuideList groups={areaGroups(t, view, area, locale)} />}
    </li>
  );
}

/** A story battle (a rival, a villain) shows its top level; any other boss, its level cap. */
const levelKey = (b: ViewBoss) => (b.kind === "story" ? "game.topLevel" : "game.levelCap");

function BossLine({ t, view, boss }: { t: PageT; view: GameView; boss: ViewBoss }) {
  const caps = view.versions.filter((v) => inVersion(boss, v.id)).map((v) => [v, capFor(boss, v.id)] as const);
  const same = new Set(caps.map(([, c]) => c)).size === 1;
  const key = levelKey(boss);
  const cap = same ? (caps[0]?.[1] !== undefined ? t(key, { n: caps[0][1]! }) : null) : caps.filter(([, c]) => c !== undefined).map(([v, c]) => `${v.name}: ${t(key, { n: c! })}`).join(" · ");
  const story = boss.kind === "story";
  const Icon = story ? VenetianMask : boss.badge ? Medal : Swords;
  return (
    <li className="flex items-center gap-3 py-1" data-testid="nz-guide-boss" data-story={story ? "1" : undefined}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-foreground/[0.14]" aria-hidden />
      <span className={cn("flex max-w-[85%] flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full border px-4 text-center font-semibold", story ? "border-foreground/[0.14] bg-foreground/[0.03] py-1.5 text-[13px]" : "border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.08)] py-2 text-[14px]")}>
        <Icon className={cn("h-4 w-4 shrink-0", story ? "text-muted-foreground" : "text-[hsl(var(--warning))]")} aria-label={story ? t("game.storyBattle") : undefined} aria-hidden={!story} />
        <span>{boss.name}</span>
        {boss.badge && <span className="text-muted-foreground">· {boss.badge}</span>}
        {boss.optional && <Tag>{t("game.optional")}</Tag>}
        {boss.versions && <VersionsOnly t={t} view={view} ids={boss.versions} />}
        {/* On a phone the cap takes the second line, so no line starts with a dot. */}
        {cap && (
          <span className="text-foreground/90 max-sm:basis-full">
            <span className="max-sm:hidden">· </span>
            {cap}
          </span>
        )}
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-foreground/[0.14]" aria-hidden />
    </li>
  );
}

/** Every boss's level cap at a glance, in story order (each version's, where they differ). */
function CapList({ t, view }: { t: PageT; view: GameView }) {
  const bosses = view.steps.flatMap((s) => (s.type === "boss" ? [s.boss] : []));
  if (!bosses.some((b) => b.cap !== undefined || b.capByVersion)) return null;
  return (
    <section className="mt-12 max-sm:mt-9" aria-labelledby="nz-caps" data-testid="nz-guide-caps">
      <h2 id="nz-caps" className="font-display text-2xl font-semibold tracking-tight">
        {t("game.capsHeading")}
      </h2>
      <p className="mb-4 mt-1 text-[15px] text-muted-foreground">{t("game.capsLead")}</p>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {bosses.map((b) => {
          const caps = view.versions.filter((v) => inVersion(b, v.id)).map((v) => [v, capFor(b, v.id)] as const).filter(([, c]) => c !== undefined);
          const same = new Set(caps.map(([, c]) => c)).size <= 1;
          const story = b.kind === "story";
          const Icon = story ? VenetianMask : b.badge ? Medal : Swords;
          return (
            // A story battle (a rival, a villain) is listed lighter: its top level is the cap only if a run's rule says so.
            <li key={b.key} className={cn("flex min-h-[60px] items-center gap-3 rounded-2xl border px-3.5 py-2.5", story ? "border-dashed border-foreground/[0.12] bg-transparent" : "border-foreground/[0.07] bg-card")} data-story={story ? "1" : undefined}>
              <Icon className={cn("h-4 w-4 shrink-0", story ? "text-muted-foreground" : "text-[hsl(var(--warning))]")} aria-label={story ? t("game.storyBattle") : undefined} aria-hidden={!story} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold leading-tight">{b.name}</span>
                {(b.badge || b.versions || story || b.optional) && (
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    {b.badge && <span className="truncate">{b.badge}</span>}
                    {story && <span>{t("game.storyBattle")}</span>}
                    {b.optional && <Tag>{t("game.optional")}</Tag>}
                    {b.versions && <VersionsOnly t={t} view={view} ids={b.versions} />}
                  </span>
                )}
              </span>
              <span className={cn("shrink-0 text-right font-display text-[19px] font-bold leading-none [font-variant-numeric:tabular-nums]", story && "text-muted-foreground")}>
                {caps.length === 0 ? "–" : same ? caps[0][1] : caps.map(([v, c]) => `${v.name} ${c}`).join(" · ")}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
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
      <IconSheet />
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
            <GameStart game={game} label={t("game.start", { versions })} short={t("game.startShort")} />
          </ClientMessages>
        </div>
      </header>

      <CapList t={t} view={view} />

      <section className="mt-12 max-sm:mt-9" aria-labelledby="nz-story">
        <h2 id="nz-story" className="mb-4 font-display text-2xl font-semibold tracking-tight">
          {t("game.story")}
        </h2>
        <ol className="space-y-3">
          {view.steps.map((s, i) => (s.type === "area" ? <AreaBlock key={s.area.id} t={t} view={view} area={s.area} locale={locale} /> : <BossLine key={`${s.boss.key}-${i}`} t={t} view={view} boss={s.boss} />))}
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
              <AreaBlock key={a.id} t={t} view={view} area={a} locale={locale} />
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
