import Link from "next/link";
import { ArrowRight, BookOpen, Clapperboard } from "lucide-react";
import { HISTORY, CHAPTERS, sourceOf } from "@/lib/world-history/data";
import { chapterPath, HISTORY_PATH } from "@/lib/world-history/deeplink";
import { basisTag, sourceLine, type Basis, type Chapter } from "@/lib/world-history/types";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { boardArtUrl } from "@/lib/pokemon/art";
import { LAB_PATH } from "@/lib/lab";
import { BackButton } from "@/components/ui/BackButton";
import { cn } from "@/lib/utils";

/**
 * The History of the Pokémon World as text: what search engines, readers
 * without WebGL and reduced-motion visitors get, and the film's catalogue
 * underneath it. Every quote carries its source line and how firmly the
 * game states it. A chapter's own page leads with that chapter.
 */

type Vars = React.CSSProperties & Record<`--${string}`, string>;

const TAG_STYLE: Record<Basis, string> = {
  stated: "",
  myth: "border-amber-300/40 text-amber-200",
  implied: "border-sky-300/40 text-sky-200",
  theory: "border-violet-300/40 text-violet-200",
  speculation: "border-rose-300/40 text-rose-200",
  contested: "border-orange-300/40 text-orange-200",
};

function Tag({ basis, chapter }: { basis: Basis; chapter: Chapter }) {
  const label = basisTag(basis, chapter.tag);
  if (!label) return null;
  return <span className={cn("rounded-sm border px-1.5 py-0.5 font-pixel text-[9px] uppercase tracking-[0.12em]", TAG_STYLE[basis])}>{label}</span>;
}

function ChapterSection({ c, lead }: { c: Chapter; lead: boolean }) {
  const H = lead ? "h1" : "h2";
  const figures = c.figures.filter((f, i, all) => all.findIndex((x) => x.dex === f.dex) === i);
  return (
    <section id={c.id} aria-labelledby={`wh-h-${c.id}`} className="wh-ch scroll-mt-20 overflow-hidden rounded-xl border bg-card/40" style={{ "--wh-accent": c.accent } as Vars} data-testid={`wh-chapter-${c.id}`}>
      <div className="wh-ch-head relative px-5 pb-5 pt-6 sm:px-8 sm:pt-8">
        <p className="hud-label flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="wh-accent">{c.numeral}</span>
          <span aria-hidden>·</span>
          <span>{c.region}</span>
          <span aria-hidden>·</span>
          <span>{c.tag}</span>
        </p>
        <H id={`wh-h-${c.id}`} className="wh-serif mt-2 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          {c.title}
        </H>
        <p className="mt-3 text-sm text-muted-foreground">
          <strong className="font-display font-semibold uppercase tracking-wider text-foreground">{c.when}</strong>
          {c.whenNote && <span> · {c.whenNote}</span>}
        </p>
        <p className="mt-3 max-w-2xl text-foreground/85">{c.summary}</p>
      </div>
      <ol className="space-y-5 border-t border-foreground/[0.06] px-5 py-6 sm:px-8">
        {c.beats.map((b) => {
          const s = sourceOf(c, b);
          return (
            <li key={b.id} className="wh-beat" data-testid="wh-beat">
              {b.lead && <p className="mb-1.5 text-sm text-muted-foreground">{b.lead}</p>}
              {b.quote && (
                <blockquote className="wh-quote wh-serif whitespace-pre-line text-xl italic leading-snug text-foreground sm:text-2xl">
                  “{b.quote}”
                </blockquote>
              )}
              {b.text && <p className="wh-serif text-xl leading-snug sm:text-2xl">{b.text}</p>}
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Tag basis={b.basis} chapter={c} />
                <cite className="not-italic">{sourceLine(s)}</cite>
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
                <Tag basis={n.basis} chapter={c} />
              </p>
              <p className="mt-1 text-foreground/85">{n.text}</p>
              {n.source && <p className="mt-1 text-xs text-muted-foreground">{sourceLine(sourceOf(c, { source: n.source }))}</p>}
            </aside>
          ))}
        </div>
      )}
      <div className="grid gap-6 border-t border-foreground/[0.06] px-5 py-5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:px-8">
        <div>
          <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources</h3>
          <ul className="mt-2 space-y-1 text-sm" data-testid={`wh-sources-${c.id}`}>
            {c.sources.map((s) => (
              <li key={s.id} className="flex gap-2">
                <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  <span className="font-semibold">{s.game}</span> <span className="text-muted-foreground">· {s.label}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">In this chapter</h3>
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
      </div>
      {!lead && (
        <div className="border-t border-foreground/[0.06] px-5 py-3 sm:px-8">
          <Link href={chapterPath(c.id)} prefetch={false} className="inline-flex items-center gap-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground" data-testid={`wh-open-${c.id}`}>
            This chapter&apos;s page <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      )}
    </section>
  );
}

export function HistoryText({ focus }: { focus?: Chapter }) {
  const others = focus ? CHAPTERS.filter((c) => c.id !== focus.id) : [];
  return (
    <article className="wh-text space-y-8" data-testid="wh-text">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BackButton href={focus ? HISTORY_PATH : LAB_PATH} label={focus ? "The whole history" : "3D Lab"} />
          <Link href="/pokedex/timeline" prefetch={false} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-screen/60 hover:text-foreground" data-testid="wh-to-timeline">
            <Clapperboard className="h-3.5 w-3.5" aria-hidden /> The real-world timeline
          </Link>
        </div>
        {!focus && (
          <div className="space-y-3 text-center">
            <p className="hud-label text-screen">PokéIQ 3D Lab · In-universe history</p>
            <h1 className="wh-serif text-5xl font-semibold leading-[0.95] tracking-tight sm:text-7xl">{HISTORY.title}</h1>
            <p className="mx-auto max-w-2xl text-lg text-foreground/85">{HISTORY.tagline}</p>
          </div>
        )}
        {focus && <p className="hud-label text-center text-screen">{HISTORY.title} · Chapter {focus.numeral}</p>}
        <div className="mx-auto max-w-2xl space-y-2 text-sm text-muted-foreground">
          <p>{HISTORY.intro}</p>
          <p>{HISTORY.method}</p>
        </div>
      </header>

      <nav aria-label="Chapters" className="rounded-xl border bg-card/40 p-4" data-testid="wh-toc">
        <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              <Link href={focus ? chapterPath(c.id) : `#${c.id}`} prefetch={false} className={cn("flex items-baseline gap-2 rounded px-1 py-0.5 hover:text-foreground", focus?.id === c.id ? "text-foreground" : "text-muted-foreground")} style={{ "--wh-accent": c.accent } as Vars}>
                <span className="wh-accent w-8 shrink-0 font-display text-xs font-semibold">{c.numeral}</span>
                <span className="min-w-0">
                  <span className="font-semibold text-foreground">{c.region}</span> <span>· {c.title}</span>
                  <span className="block text-xs">{c.when}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {focus ? <ChapterSection c={focus} lead /> : CHAPTERS.map((c) => <ChapterSection key={c.id} c={c} lead={false} />)}

      {focus && (
        <section aria-labelledby="wh-rest" className="space-y-3">
          <h2 id="wh-rest" className="font-display text-lg font-bold uppercase tracking-wider">The rest of the history</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {others.map((c) => (
              <li key={c.id} style={{ "--wh-accent": c.accent } as Vars}>
                <Link href={chapterPath(c.id)} prefetch={false} className="block h-full rounded-lg border bg-card/40 p-4 hover:border-[color:var(--wh-accent)]">
                  <span className="hud-label wh-accent">{c.numeral} · {c.region} · {c.when}</span>
                  <span className="wh-serif mt-1 block text-2xl font-semibold leading-tight">{c.title}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{c.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="wh-screen" className="rounded-xl border border-dashed bg-card/30 p-5 sm:p-6" data-testid="wh-screen-lane">
        <p className="hud-label text-muted-foreground">A separate continuity</p>
        <h2 id="wh-screen" className="mt-1 font-display text-lg font-bold uppercase tracking-wider">{HISTORY.screen.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{HISTORY.screen.note}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {HISTORY.screen.items.map((i) => (
            <li key={i.film} className="rounded-lg border border-foreground/10 bg-background/40 p-3 text-sm">
              <span className="block font-display text-xs font-semibold uppercase tracking-wider">{i.film}</span>
              <span className="mt-0.5 block text-foreground/85">{i.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="space-y-2 rounded-xl border bg-card/40 p-4 text-xs text-muted-foreground">
        <p>
          <span className="font-display font-semibold uppercase tracking-wider text-foreground">How to read the tags.</span>{" "}
          <span className="text-amber-200">Myth, Legend and Folk tale</span>: the game tells it as a story. <span className="text-sky-200">Implied</span>: follows closely from what the games state. <span className="text-violet-200">Theory</span> and <span className="text-rose-200">Speculation</span>: a character&apos;s idea or guess. <span className="text-orange-200">Sources differ</span>: the games tell it more than one way. Untagged lines are stated outright.
        </p>
        <p>
          The anime and films have their own continuity, kept apart above. Looking for when the games, anime and films came out? See the <Link href="/pokedex/timeline" prefetch={false} className="underline underline-offset-2 hover:text-foreground">Pokémon Timeline</Link>.
        </p>
        <p>
          Music: “Epic Endgame Cinematic” by cynicmusic and other CC0 tracks from OpenGameArt.org (<a href="/audio/world-history/CREDITS.md" className="underline underline-offset-2 hover:text-foreground">credits</a>). The Pokémon figures are built from Pokémon HOME renders served by PokéAPI.
        </p>
      </footer>
    </article>
  );
}
