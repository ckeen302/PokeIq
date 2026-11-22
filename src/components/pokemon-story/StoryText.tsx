import Link from "@/components/ui/PlainLink";
import { ArrowRight, Clapperboard, ExternalLink, Globe2, Landmark } from "lucide-react";
import { STORY, sourceOf } from "@/lib/pokemon-story/data";
import { chapterPath, STORY_PATH } from "@/lib/pokemon-story/deeplink";
import { basisTagKey, type Basis, type Chapter, type Source, type Story } from "@/lib/pokemon-story/types";
import { serverT } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/catalog";
import storyNs from "@/messages/pokemon-story";
import filmNs from "@/messages/pokemon-story-film";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { boardArtUrl } from "@/lib/pokemon/art";
import { LAB_PATH } from "@/lib/lab";
import { HISTORY_PATH } from "@/lib/world-history/deeplink";
import { BackButton } from "@/components/ui/BackButton";
import { cn } from "@/lib/utils";

/**
 * The Story of Pokémon as text: what search engines, readers without WebGL
 * and reduced-motion visitors get, and the film's sources underneath it.
 * Every line carries its source (linked) and how it is known. A chapter's
 * own page leads with that chapter.
 */

type Vars = React.CSSProperties & Record<`--${string}`, string>;

const TAG_STYLE: Record<Basis, string> = {
  record: "",
  line: "",
  said: "border-sky-300/40 text-sky-200",
  reported: "border-amber-300/40 text-amber-200",
  retold: "border-orange-300/40 text-orange-200",
};

function Tag({ basis }: { basis: Basis }) {
  const t = serverT(filmNs);
  const key = basisTagKey(basis);
  if (!key) return null;
  return <span className={cn("rounded-sm border px-1.5 py-0.5 font-pixel text-[9px] uppercase tracking-[0.12em]", TAG_STYLE[basis])}>{t(`tags.${key}`)}</span>;
}

function Cite({ s }: { s: Source }) {
  return (
    <a href={s.url} target="_blank" rel="noopener noreferrer" className="not-italic underline-offset-2 hover:text-foreground hover:underline">
      {s.publisher} · {s.title} ({s.year})
    </a>
  );
}

const fmtDate = (d: string, locale: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

function ChapterSection({ c, lead }: { c: Chapter; lead: boolean }) {
  const t = serverT(storyNs);
  const tf = serverT(filmNs);
  const H = lead ? "h1" : "h2";
  const figures = c.figures.filter((f, i, all) => all.findIndex((x) => x.dex === f.dex) === i);
  return (
    <section id={c.id} aria-labelledby={`ps-h-${c.id}`} className="wh-ch scroll-mt-20 overflow-hidden rounded-xl border bg-card/40" style={{ "--wh-accent": c.accent } as Vars} data-testid={`ps-chapter-${c.id}`}>
      <div className="wh-ch-head relative px-5 pb-5 pt-6 sm:px-8 sm:pt-8">
        <p className="hud-label flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="wh-accent">{c.numeral}</span>
          <span aria-hidden>·</span>
          <span>{c.place}</span>
          <span aria-hidden>·</span>
          <span>{c.tag}</span>
        </p>
        <H id={`ps-h-${c.id}`} className="wh-serif mt-2 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          {c.title}
        </H>
        <p className="mt-3 text-sm">
          <strong className="font-display font-semibold uppercase tracking-wider text-foreground">{c.when}</strong>
        </p>
        <p className="mt-3 max-w-2xl text-foreground/85">{c.summary}</p>
      </div>
      <ol className="space-y-5 border-t border-foreground/[0.06] px-5 py-6 sm:px-8">
        {c.beats.map((b) => {
          const s = sourceOf(c, b);
          return (
            <li key={b.id} data-testid="ps-beat">
              {b.lead && <p className={cn("wh-serif leading-snug", b.quote ? "mb-1.5 text-lg text-foreground/85" : "text-xl sm:text-2xl")}>{b.lead}</p>}
              {b.quote && <blockquote className="wh-quote wh-serif text-xl italic leading-snug text-foreground sm:text-2xl">{tf("quoteOpen")}{b.quote}{tf("quoteClose")}</blockquote>}
              {b.text && <p className="wh-serif text-xl leading-snug sm:text-2xl">{b.text}</p>}
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Tag basis={b.basis} />
                {b.dates?.map((d) => <span key={d.date} className="font-display font-semibold uppercase tracking-wider text-foreground/80">{fmtDate(d.date, INTL_LOCALE[t.locale])}</span>)}
                <cite className="not-italic"><Cite s={s} /></cite>
              </p>
            </li>
          );
        })}
      </ol>
      {c.notes.length > 0 && (
        <div className="grid gap-3 px-5 pb-6 sm:grid-cols-2 sm:px-8">
          {c.notes.map((n) => (
            <aside key={n.label} className="rounded-lg border border-foreground/10 bg-background/40 p-3 text-sm" aria-label={n.label}>
              <p className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-wider">
                <span className="wh-accent">{n.label}</span>
                <Tag basis={n.basis} />
              </p>
              <p className="mt-1 text-foreground/85">{n.text}</p>
              {n.source && <p className="mt-1 text-xs text-muted-foreground"><Cite s={sourceOf(c, { source: n.source })} /></p>}
            </aside>
          ))}
        </div>
      )}
      <div className="grid gap-6 border-t border-foreground/[0.06] px-5 py-5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:px-8">
        <div>
          <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("sources")}</h3>
          <ul className="mt-2 space-y-1 text-sm" data-testid={`ps-sources-${c.id}`}>
            {c.sources.map((s) => (
              <li key={s.id} className="flex min-w-0 gap-2">
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-words hover:underline">
                  <span className="font-semibold">{s.publisher}</span> <span className="text-muted-foreground">· {s.title} ({s.year})</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        {figures.length > 0 && (
          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("inChapter")}</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {figures.map((f) => {
                const p = getPokemon(f.dex);
                return (
                  <li key={f.dex}>
                    <Link href={`/pokemon/${p?.slug ?? f.dex}`} prefetch={false} className="flex items-center gap-1.5 rounded-md border border-foreground/10 bg-background/40 py-1 pl-1 pr-2.5 text-sm hover:border-[color:var(--wh-accent)]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- small static board art */}
                      <img src={boardArtUrl(f.dex)} alt="" width={28} height={28} loading="lazy" className="h-7 w-7 object-contain" />
                      {f.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      {!lead && (
        <div className="border-t border-foreground/[0.06] px-5 py-3 sm:px-8">
          <Link href={chapterPath(c.id)} prefetch={false} className="inline-flex items-center gap-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground" data-testid={`ps-open-${c.id}`}>
            {t("chapterPage")} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      )}
    </section>
  );
}

export function StoryText({ focus, story = STORY }: { focus?: Chapter; story?: Story }) {
  const t = serverT(storyNs);
  const CHAPTERS = story.chapters;
  const others = focus ? CHAPTERS.filter((c) => c.id !== focus.id) : [];
  const chip = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-screen/60 hover:text-foreground";
  return (
    <article className="wh-text space-y-8" data-testid="ps-text">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BackButton href={focus ? STORY_PATH : LAB_PATH} label={focus ? t("wholeStory") : t("lab")} />
          <Link href="/pokedex/timeline" prefetch={false} className={chip} data-testid="ps-to-timeline">
            <Clapperboard className="h-3.5 w-3.5" aria-hidden /> {t("everyRelease")}
          </Link>
        </div>
        {!focus && (
          <div className="space-y-3 text-center">
            <p className="hud-label text-screen">{t("kicker")}</p>
            <h1 className="wh-serif text-5xl font-semibold leading-[0.95] tracking-tight sm:text-7xl">{story.title}</h1>
            <p className="mx-auto max-w-2xl text-lg text-foreground/85">{story.tagline}</p>
          </div>
        )}
        {focus && <p className="hud-label text-center text-screen">{t("chapterOf", { title: story.title, numeral: focus.numeral })}</p>}
        <div className="mx-auto max-w-2xl space-y-2 text-sm text-muted-foreground">
          <p>{story.intro}</p>
          <p>{story.method}</p>
        </div>
      </header>

      <nav aria-label={t("chapters")} className="rounded-xl border bg-card/40 p-4" data-testid="ps-toc">
        <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              <Link href={focus ? chapterPath(c.id) : `#${c.id}`} prefetch={false} className={cn("flex items-baseline gap-2 rounded px-1 py-0.5 hover:text-foreground", focus?.id === c.id ? "text-foreground" : "text-muted-foreground")} style={{ "--wh-accent": c.accent } as Vars}>
                <span className="wh-accent w-8 shrink-0 font-display text-xs font-semibold">{c.numeral}</span>
                <span className="min-w-0">
                  <span className="font-semibold text-foreground">{c.title}</span> <span>· {c.place}</span>
                  <span className="block text-xs">{c.when}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {focus ? <ChapterSection c={focus} lead /> : CHAPTERS.map((c) => <ChapterSection key={c.id} c={c} lead={false} />)}

      {focus && (
        <section aria-labelledby="ps-rest" className="space-y-3">
          <h2 id="ps-rest" className="font-display text-lg font-bold uppercase tracking-wider">{t("rest")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {others.map((c) => (
              <li key={c.id} style={{ "--wh-accent": c.accent } as Vars}>
                <Link href={chapterPath(c.id)} prefetch={false} className="block h-full rounded-lg border bg-card/40 p-4 hover:border-[color:var(--wh-accent)]">
                  <span className="hud-label wh-accent">{c.numeral} · {c.when}</span>
                  <span className="wh-serif mt-1 block text-2xl font-semibold leading-tight">{c.title}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{c.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav aria-label={t("keepExploring")} className="grid gap-3 sm:grid-cols-2" data-testid="ps-epilogue-links">
        <Link href="/pokedex/timeline" prefetch={false} className="group flex items-center gap-3 rounded-xl border bg-card/40 p-4 hover:border-screen/60" data-testid="ps-every-release">
          <Clapperboard className="h-5 w-5 shrink-0 text-screen" aria-hidden />
          <span className="min-w-0">
            <span className="block font-display text-sm font-semibold uppercase tracking-wider">{t("exploreEvery")}</span>
            <span className="block text-sm text-muted-foreground">{t("exploreEveryBody")}</span>
          </span>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
        </Link>
        <Link href={HISTORY_PATH} prefetch={false} className="group flex items-center gap-3 rounded-xl border bg-card/40 p-4 hover:border-screen/60" data-testid="ps-world-history">
          <Landmark className="h-5 w-5 shrink-0 text-[#f2c96b]" aria-hidden />
          <span className="min-w-0">
            <span className="block font-display text-sm font-semibold uppercase tracking-wider">{t("worldOwn")}</span>
            <span className="block text-sm text-muted-foreground">{t("worldOwnBody")}</span>
          </span>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
        </Link>
      </nav>

      <footer className="space-y-2 rounded-xl border bg-card/40 p-4 text-xs text-muted-foreground" data-testid="ps-footer">
        <p>
          <span className="font-display font-semibold uppercase tracking-wider text-foreground">{t("howTo")}</span>{" "}
          {t.rich("tagsHelp", {
            said: (c) => <span className="text-sky-200">{c}</span>,
            reported: (c) => <span className="text-amber-200">{c}</span>,
            retold: (c) => <span className="text-orange-200">{c}</span>,
          })}
        </p>
        <p>
          <Globe2 className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
          {t("people")}
        </p>
        <p data-testid="ps-music-credits">
          {t.rich("music", {
            a: (c) => (
              <a href="/audio/pokemon-story/CREDITS.md" className="underline underline-offset-2 hover:text-foreground">
                {c}
              </a>
            ),
          })}
        </p>
        <p>{t("fan")}</p>
      </footer>
    </article>
  );
}
