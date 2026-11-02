"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, Layers, MapPin } from "lucide-react";
import { spriteUrl } from "@/lib/pokemon/art";
import { ERA_BY_ID, LANE_BY_ID, ROMAN, dateRows, formatDate, type TimelineEntry, type TimelineSpecies } from "@/lib/timeline/types";

const KIND: Record<string, string> = {
  opener: "New generation",
  enhanced: "Enhanced version",
  remake: "Remake",
  sequel: "Sequel",
  legends: "Legends",
  dlc: "DLC",
  rerelease: "Re-release",
};

const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");

function SpeciesChips({ list, testId }: { list: TimelineSpecies[]; testId: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid={testId}>
      {list.map((s) => (
        <li key={s.id}>
          <Link href={`/pokemon/${s.slug}`} className="flex items-center gap-1 rounded-full border bg-shade/30 py-0.5 pl-0.5 pr-3 text-xs font-medium hover:border-[hsl(var(--lane)/0.7)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={spriteUrl(s.id)} alt="" width={32} height={32} loading="lazy" className="h-8 w-8 [image-rendering:pixelated]" />
            {s.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Every species a generation introduced, as a sprite strip (fetched when the panel opens). */
function GenerationStrip({ gen }: { gen: number }) {
  const [list, setList] = useState<TimelineSpecies[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setList(null);
    setFailed(false);
    fetch(`/pokedex/timeline/species/${gen}`)
      .then((r) => (r.ok ? (r.json() as Promise<TimelineSpecies[]>) : Promise.reject(new Error(String(r.status)))))
      .then((l) => alive && setList(l))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [gen]);
  if (failed) return <Link href={`/pokedex?gen=${gen}`} className="text-sm text-[hsl(var(--lane))] hover:underline">Generation {ROMAN[gen]} Pokémon in the Pokédex →</Link>;
  if (!list) return <div className="h-24 animate-pulse rounded-md bg-shade/30" />;
  return (
    <div className="space-y-2">
      <ul className="grid max-h-56 grid-cols-6 gap-0.5 overflow-y-auto overscroll-contain rounded-md border bg-shade/30 p-1 sm:grid-cols-7" data-testid="timeline-gen-strip">
        {list.map((s) => (
          <li key={s.id}>
            <Link href={`/pokemon/${s.slug}`} title={s.name} className="block rounded transition-colors hover:bg-[hsl(var(--lane)/0.18)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={spriteUrl(s.id)} alt={s.name} width={48} height={48} loading="lazy" decoding="async" className="mx-auto h-12 w-12 [image-rendering:pixelated]" />
            </Link>
          </li>
        ))}
      </ul>
      <Link href={`/pokedex?gen=${gen}`} className="inline-block text-xs text-muted-foreground hover:text-foreground">Open Generation {ROMAN[gen]} in the Pokédex →</Link>
    </div>
  );
}

export function TimelineDetail({ entry }: { entry: TimelineEntry }) {
  const lane = LANE_BY_ID[entry.lane];
  const era = ERA_BY_ID[entry.era];
  const rows = dateRows(entry);
  const label = "mb-1.5 font-pixel text-[9px] uppercase tracking-[0.16em] text-muted-foreground";
  return (
    <div className="space-y-5 p-4 sm:p-5">
      <header className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 font-pixel text-[9px] uppercase tracking-[0.16em]">
          <span className="rounded-sm px-1.5 py-0.5" style={{ background: `hsl(${lane.color} / 0.16)`, color: `hsl(${lane.color})` }}>{lane.label}</span>
          {entry.kind && <span className="text-muted-foreground">{KIND[entry.kind]}</span>}
          {entry.setHref && entry.featured && <span className="text-foreground/80">Landmark set</span>}
          <span className="text-muted-foreground" style={{ color: era.a }}>{era.device}</span>
        </p>
        <h2 className="font-display text-2xl font-bold uppercase leading-tight tracking-wide" data-testid="timeline-detail-title">{entry.title}</h2>
        {entry.series && <p className="text-sm text-muted-foreground">Japanese series: {entry.series}</p>}
        {entry.note && <p className="text-sm text-foreground/85">{entry.note}</p>}
      </header>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm">
        {rows.map((r) => (
          <div key={r.label} className="bg-card p-3" data-testid={`timeline-date-${r.label.toLowerCase().replace(/ /g, "-")}`}>
            <dt className={label}>{r.label === "Worldwide" ? "Released worldwide" : r.label}</dt>
            <dd className="font-display text-base font-semibold tabular-nums">{formatDate(r.date)}</dd>
          </div>
        ))}
        <div className={!entry.region && (rows.length + 1) % 2 ? "col-span-2 bg-card p-3" : "bg-card p-3"}>
          <dt className={label}>Platform</dt>
          <dd className="font-semibold">{entry.platform}</dd>
        </div>
        {entry.region && (
          <div className={(rows.length + 2) % 2 ? "col-span-2 bg-card p-3" : "bg-card p-3"}>
            <dt className={label}>Region</dt>
            <dd className="font-semibold">
              {entry.regionHref ? (
                <Link href={entry.regionHref} className="inline-flex items-center gap-1 hover:text-[hsl(var(--lane))]" data-testid="timeline-region-link">
                  <MapPin className="h-3.5 w-3.5" aria-hidden /> {entry.region}
                </Link>
              ) : (
                entry.region
              )}
            </dd>
          </div>
        )}
      </dl>

      {entry.setHref && (
        <Link
          href={entry.setHref}
          className="flex items-center justify-between gap-3 rounded-lg border bg-shade/30 px-3 py-2.5 text-sm font-semibold transition-colors hover:border-[hsl(var(--lane)/0.7)] hover:text-[hsl(var(--lane))]"
          data-testid="timeline-set-link"
        >
          <span className="inline-flex items-center gap-2">
            <Layers className="h-4 w-4 text-[hsl(var(--lane))]" aria-hidden /> Browse the set&apos;s cards
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </Link>
      )}

      {entry.starters.length > 0 && (
        <section>
          <h3 className={label}>Starters</h3>
          <SpeciesChips list={entry.starters} testId="timeline-starters" />
        </section>
      )}
      {entry.legendaries.length > 0 && (
        <section>
          <h3 className={label}>Box legendaries</h3>
          <SpeciesChips list={entry.legendaries} testId="timeline-legendaries" />
        </section>
      )}
      {entry.introduces && (
        <section>
          <h3 className={label}>New Pokémon in Generation {ROMAN[entry.introduces]}</h3>
          <GenerationStrip gen={entry.introduces} />
        </section>
      )}

      <section>
        <h3 className={label}>Sources</h3>
        <ul className="space-y-1 text-xs">
          {entry.sources.map((s) => (
            <li key={s}>
              <a href={s} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3 w-3" aria-hidden /> {host(s)}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
