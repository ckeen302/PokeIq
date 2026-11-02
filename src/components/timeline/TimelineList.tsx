"use client";

import Link from "next/link";
import { ERAS, LANE_BY_ID, ROMAN, dateRows, formatDate, isCompact, type TimelineEntry } from "@/lib/timeline/types";
import type { EraStart } from "./TimelineExperience";

/**
 * Every timeline entry as plain, server-rendered HTML, era by era. It is what
 * search engines index, and the whole page without WebGL or with reduced motion.
 * A client component only so its props travel once in the page payload (the
 * 3D view takes the same entries) rather than as a second, rendered tree.
 */
export function TimelineList({ entries, eraStarts }: { entries: TimelineEntry[]; eraStarts: EraStart[] }) {
  return (
    <div className="space-y-10" data-testid="timeline-list">
      {eraStarts.map((s, i) => {
        const era = ERAS.find((e) => e.id === s.id)!;
        const list = entries.filter((e) => e.era === s.id);
        const end = eraStarts[i + 1]?.year;
        return (
          <section key={s.id} aria-labelledby={`era-${s.id}`} className="relative">
            <header className="sticky top-14 z-10 -mx-2 mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-foreground/[0.06] bg-background/85 px-2 py-2 backdrop-blur">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: era.a, boxShadow: `0 0 10px ${era.a}` }} aria-hidden />
              <h2 id={`era-${s.id}`} className="font-display text-xl font-bold uppercase tracking-wide">{era.label}</h2>
              <span className="font-pixel text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {s.year}–{end ?? "today"} · {era.device}
              </span>
            </header>
            <ol className="relative space-y-2 border-l pl-4 sm:pl-6" style={{ borderColor: `${era.a}55` }}>
              {list.map((e) => {
                const lane = LANE_BY_ID[e.lane];
                if (isCompact(e)) return <CompactItem key={e.id} entry={e} />;
                return (
                  <li key={e.id} id={e.id} className="relative scroll-mt-28">
                    <span className="absolute -left-[21px] top-4 h-2 w-2 rounded-full sm:-left-[29px]" style={{ background: `hsl(${lane.color})` }} aria-hidden />
                    <article className="rounded-lg border bg-card p-3 sm:p-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-pixel text-[9px] uppercase tracking-[0.14em]" style={{ color: `hsl(${lane.color})` }}>{lane.label}</span>
                        <span className="text-xs text-muted-foreground">{e.platform}</span>
                      </div>
                      <h3 className="mt-1 font-display text-lg font-bold uppercase leading-tight tracking-wide">{e.title}</h3>
                      {e.note && <p className="mt-1 text-sm text-muted-foreground">{e.note}</p>}
                      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                        {dateRows(e).map((r) => (
                          <div key={r.label} className="flex gap-1.5">
                            <dt className="text-muted-foreground">{r.label}</dt>
                            <dd className="font-semibold tabular-nums">
                              <time dateTime={r.date}>{formatDate(r.date)}</time>
                            </dd>
                          </div>
                        ))}
                        {e.region && (
                          <div className="flex gap-1.5">
                            <dt className="text-muted-foreground">Region</dt>
                            <dd className="font-semibold">{e.regionHref ? <Link href={e.regionHref} className="hover:text-primary">{e.region}</Link> : e.region}</dd>
                          </div>
                        )}
                      </dl>
                      {(e.starters.length > 0 || e.legendaries.length > 0 || e.introduces) && (
                        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {e.starters.length > 0 && (
                            <span>
                              <span className="text-muted-foreground">Starters </span>
                              {e.starters.map((p, k) => (
                                <span key={p.id}>{k > 0 && ", "}<Link href={`/pokemon/${p.slug}`} className="hover:text-primary">{p.name}</Link></span>
                              ))}
                            </span>
                          )}
                          {e.legendaries.length > 0 && (
                            <span>
                              <span className="text-muted-foreground">Box legendaries </span>
                              {e.legendaries.map((p, k) => (
                                <span key={p.id}>{k > 0 && ", "}<Link href={`/pokemon/${p.slug}`} className="hover:text-primary">{p.name}</Link></span>
                              ))}
                            </span>
                          )}
                          {e.introduces && (
                            <Link href={`/pokedex?gen=${e.introduces}`} className="text-muted-foreground hover:text-primary">Generation {ROMAN[e.introduces]} Pokémon →</Link>
                          )}
                        </p>
                      )}
                      {e.setHref && (
                        <p className="mt-2 text-sm">
                          <Link href={e.setHref} className="text-muted-foreground hover:text-primary">Browse the set&apos;s cards →</Link>
                        </p>
                      )}
                      <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground/80">
                        Sources:
                        {e.sources.map((u) => (
                          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
                            {new URL(u).hostname.replace(/^www\./, "")}
                          </a>
                        ))}
                      </p>
                    </article>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");

/** A compact lane's entry (a TCG set): one slim row with its date, card list and sources. */
function CompactItem({ entry: e }: { entry: TimelineEntry }) {
  const lane = LANE_BY_ID[e.lane];
  return (
    <li id={e.id} className="relative scroll-mt-28">
      <span className="absolute -left-[20px] top-3.5 h-1.5 w-1.5 rounded-full sm:-left-[28px]" style={{ background: `hsl(${lane.color})` }} aria-hidden />
      <article className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg border bg-card/70 px-3 py-2 sm:px-4">
        <span className="font-pixel text-[9px] uppercase tracking-[0.14em]" style={{ color: `hsl(${lane.color})` }}>{lane.label}</span>
        <h3 className="font-display text-base font-bold uppercase leading-tight tracking-wide">{e.title}</h3>
        {dateRows(e).map((r) => (
          <span key={r.label} className="text-sm text-muted-foreground">
            <span className="sr-only">{r.label} </span>
            <time dateTime={r.date} className="font-semibold tabular-nums text-foreground/90">{formatDate(r.date)}</time>
          </span>
        ))}
        <span className="text-xs text-muted-foreground">{e.platform.replace(/^Trading Card Game · /, "")}</span>
        <span className="ml-auto flex flex-wrap items-baseline gap-x-3 text-[11px] text-muted-foreground/80">
          {e.setHref && <Link href={e.setHref} className="text-sm text-muted-foreground hover:text-primary">Cards →</Link>}
          {e.sources.map((u) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
              {host(u)}
            </a>
          ))}
        </span>
      </article>
    </li>
  );
}
