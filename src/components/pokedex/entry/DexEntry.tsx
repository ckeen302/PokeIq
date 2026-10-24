"use client";

/* eslint-disable @next/next/no-img-element -- pre-sized art */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BookOpenCheck, ChevronLeft, ChevronRight, Gamepad2 } from "lucide-react";
import type { DexEntryData, DexForm } from "@/lib/pokemon/dex-types";
import { TYPES, defensiveProfile, effectiveness, type PokemonType } from "@/lib/pokemon/type-matrix";
import { typeColor } from "@/lib/pokemon/type-colors";
import { artUrl } from "@/lib/pokemon/art";
import { Hero } from "./Hero";
import { Section } from "./Reveal";
import { StatsSection } from "./StatsSection";
import { MatchupSection } from "./MatchupSection";
import { EvolutionSection } from "./EvolutionSection";
import { MovesSection } from "./MovesSection";
import { EntriesSection } from "./EntriesSection";
import { TrainingSection } from "./TrainingSection";
import { LookalikesSection } from "./LookalikesSection";
import { EncountersSection } from "./EncountersSection";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * One Pokémon's full study page. Selecting a form (Mega, regional,
 * Gigantamax…) re-derives typing, stats, abilities and matchups live.
 */
export function DexEntry({ data }: { data: DexEntryData }) {
  const router = useRouter();
  const p = data.core;
  const [form, setForm] = useState<DexForm | null>(null);

  const types = form?.types ?? p.types;
  const stats = form?.stats ?? p.stats;
  const abilities = form?.abilities ?? data.abilities;
  const accent = typeColor(types[0]);

  const defenses = useMemo(() => {
    if (!form) return data.defenses;
    const profile = defensiveProfile(form.types as PokemonType[]);
    return TYPES.map((t) => ({ type: t, multiplier: profile.get(t)! }));
  }, [form, data.defenses]);
  const stab = useMemo(
    () => (form ? TYPES.filter((d) => (form.types as PokemonType[]).some((a) => effectiveness(a, [d]) === 2)) : data.stabSuperEffective),
    [form, data.stabSuperEffective]
  );

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "stats", label: "Stats" },
    { id: "matchups", label: "Matchups" },
    data.evolutionTree && { id: "evolution", label: "Evolution" },
    data.lookalikes.length > 0 && { id: "lookalikes", label: "Lookalikes" },
    data.encounters && { id: "encounters", label: "Where to find it" },
    data.learnset && { id: "moves", label: "Moves" },
    { id: "pokedex", label: "Pokédex" },
    { id: "breeding", label: "Training + breeding" },
  ].filter(Boolean) as { id: string; label: string }[];
  const active = useScrollSpy(sections.map((s) => s.id));
  const sectionIndex = (id: string) => sections.findIndex((s) => s.id === id) + 1;

  // ← / → to flip through the Pokédex. Arrow keys keep their native meaning
  // in form fields and in horizontally scrolling rows ([data-hscroll]).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, select, textarea, [contenteditable], [data-hscroll]")) return;
      if (e.key === "ArrowLeft" && data.prev) router.push(`/pokemon/${data.prev.slug}`);
      if (e.key === "ArrowRight" && data.next) router.push(`/pokemon/${data.next.slug}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data.prev, data.next, router]);

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <nav className="flex items-center justify-between text-sm text-muted-foreground">
        {data.prev ? (
          <Link href={`/pokemon/${data.prev.slug}`} className="flex items-center gap-1 hover:text-foreground">
            <ChevronLeft className="h-4 w-4" /> #{data.prev.id} {data.prev.name}
          </Link>
        ) : (
          <span />
        )}
        <Link href="/pokedex" className="hover:text-foreground">
          Pokédex
        </Link>
        {data.next ? (
          <Link href={`/pokemon/${data.next.slug}`} className="flex items-center gap-1 hover:text-foreground">
            #{data.next.id} {data.next.name} <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span />
        )}
      </nav>

      <Hero data={data} form={form} onFormChange={setForm} types={types} abilities={abilities} />

      {/* Sticky section nav with scroll-spy */}
      <div className="sticky top-14 z-30 -mx-4 border-b border-foreground/5 bg-background/80 px-4 py-2 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" data-hscroll>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn("relative shrink-0 rounded-sm px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider transition-colors", active === s.id ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {active === s.id && (
                <motion.span layoutId="dex-section-pill" className="absolute inset-0 rounded-sm bg-primary" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
              )}
              <span className="relative">{s.label}</span>
            </a>
          ))}
        </div>
      </div>

      <Section id="stats" index={sectionIndex("stats")} title="Base stats" subtitle={form ? form.name : undefined}>
        <StatsSection stats={stats} percentiles={data.percentiles} accent={accent} isShedinja={p.slug === "shedinja"} showPercentiles={!form} />
      </Section>

      <Section id="matchups" index={sectionIndex("matchups")} title="Type matchups" subtitle="Defensive multipliers">
        <MatchupSection defenses={defenses} stab={stab} />
      </Section>

      {data.evolutionTree && (
        <Section id="evolution" index={sectionIndex("evolution")} title="Evolution">
          <EvolutionSection tree={data.evolutionTree} currentId={p.id} />
        </Section>
      )}

      {data.lookalikes.length > 0 && (
        <Section id="lookalikes" index={sectionIndex("lookalikes")} title="Easily confused with" subtitle="Most similar silhouettes">
          <LookalikesSection self={{ id: p.id, name: p.name }} lookalikes={data.lookalikes} />
        </Section>
      )}

      {data.encounters && (
        <Section id="encounters" index={sectionIndex("encounters")} title="Where to find it" subtitle="By game">
          <EncountersSection gens={data.encounters} name={p.name} />
        </Section>
      )}

      {data.learnset && (
        <Section id="moves" index={sectionIndex("moves")} title="Moves" subtitle={`${data.learnset.moves.length} moves`}>
          <MovesSection moves={data.learnset.moves} game={data.learnset.game} />
        </Section>
      )}

      <Section id="pokedex" index={sectionIndex("pokedex")} title="Pokédex entries" subtitle={`${data.entries.length} unique entries`}>
        <EntriesSection entries={data.entries} />
      </Section>

      <Section id="breeding" index={sectionIndex("breeding")} title="Training & breeding">
        <TrainingSection data={data} />
      </Section>

      {/* Study CTA */}
      <motion.div
        className="hud relative overflow-hidden rounded-lg border p-6 sm:p-8"
        style={{ background: `linear-gradient(135deg, ${accent}30, hsl(var(--card)) 70%)` }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <img src={artUrl(p.id, 256)} alt="" aria-hidden className="pointer-events-none absolute -bottom-8 -right-6 h-48 w-48 opacity-20 [filter:brightness(0)_invert(1)] [.light_&]:opacity-10 [.light_&]:[filter:brightness(0)]" />
        <h2 className="font-display text-2xl font-bold uppercase">Think you&apos;ve got {p.name} down?</h2>
        <p className="mt-1 max-w-lg text-muted-foreground">Lock it in with flashcards, then prove it in a quiz.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/pokedex/study?gen=${p.gen}`} className={buttonVariants()}>
            <BookOpenCheck className="h-4 w-4" /> Study Gen {p.gen} flashcards
          </Link>
          <Link href={`/quiz/gen-${p.gen}-pokemon-quiz`} className={buttonVariants({ variant: "outline" })}>
            <Gamepad2 className="h-4 w-4" /> Gen {p.gen} quiz
          </Link>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        {[data.prev, data.next].map((n, i) =>
          n ? (
            <Link
              key={n.id}
              href={`/pokemon/${n.slug}`}
              className={cn("group flex items-center gap-3 hud rounded-lg border bg-card p-3 transition hover:border-primary/40", i === 1 && "flex-row-reverse text-right")}
            >
              <img src={artUrl(n.id, 96)} loading="lazy" alt="" width={64} height={64} className="h-16 w-16 transition-transform group-hover:scale-110" />
              <div>
                <div className="hud-label">No.{String(n.id).padStart(4, "0")}</div>
                <div className="font-display font-bold uppercase tracking-wide">{n.name}</div>
              </div>
            </Link>
          ) : (
            <span key={i} />
          )
        )}
      </div>
    </article>
  );
}

/**
 * Highlights the first section (in page order) inside the reading band. The
 * observer only reports sections whose state changed, so every section's
 * latest state is kept: a tall section that stays in the band the whole time
 * (Moves) must still win once the section below it scrolls out.
 */
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join(",");
  useEffect(() => {
    const order = key.split(",");
    const els = order.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const inBand = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) inBand.set(e.target.id, e.isIntersecting);
        const first = order.find((id) => inBand.get(id));
        if (first) setActive(first);
      },
      { rootMargin: "-120px 0px -55% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key]);
  return active;
}
