"use client";

/* eslint-disable @next/next/no-img-element -- pre-sized art */
import { useEffect, useMemo, useState } from "react";
import Link from "@/components/ui/Link";
import { motion } from "framer-motion";
import { BookOpenCheck, Gamepad2 } from "lucide-react";
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
import { NamesSection } from "./NamesSection";
import { EntriesSection } from "./EntriesSection";
import { TrainingSection } from "./TrainingSection";
import { LookalikesSection } from "./LookalikesSection";
import { EncountersSection } from "./EncountersSection";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { DexPager } from "@/components/pokedex/detail/DexPager";
import { useT } from "@/i18n/client";
import dexEntryNs from "@/messages/dex-entry";
import dexPager from "@/messages/dex-pager";

/**
 * One Pokémon's full study page. Selecting a form (Mega, regional,
 * Gigantamax…) re-derives typing, stats, abilities and matchups live.
 */
export function DexEntry({ data }: { data: DexEntryData }) {
  const t = useT(dexEntryNs);
  const tp = useT(dexPager);
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

  // A page in another language has no entries for a species its games' texts don't cover (Generation 9).
  const hasEntries = !data.local || data.entries.length > 0;
  const sections = [
    { id: "overview", label: t("nav.overview") },
    { id: "stats", label: t("nav.stats") },
    { id: "matchups", label: t("nav.matchups") },
    data.evolutionTree && { id: "evolution", label: t("nav.evolution") },
    data.lookalikes.length > 0 && { id: "lookalikes", label: t("nav.lookalikes") },
    data.encounters && { id: "encounters", label: t("nav.encounters") },
    data.learnset && { id: "moves", label: t("nav.moves") },
    hasEntries && { id: "pokedex", label: t("nav.pokedex") },
    data.names.length > 0 && { id: "names", label: t("nav.names") },
    { id: "breeding", label: t("nav.breeding") },
  ].filter(Boolean) as { id: string; label: string }[];
  const active = useScrollSpy(sections.map((s) => s.id));
  const sectionIndex = (id: string) => sections.findIndex((s) => s.id === id) + 1;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DexPager
        prev={data.prev && { href: `/pokemon/${data.prev.slug}`, label: `#${data.prev.id} ${data.prev.name}` }}
        next={data.next && { href: `/pokemon/${data.next.slug}`, label: `#${data.next.id} ${data.next.name}` }}
        center={{ href: "/pokedex", label: tp("pokedex") }}
        words={{ nav: tp("nav"), prev: tp("prev"), next: tp("next") }}
      />

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

      <Section id="stats" index={sectionIndex("stats")} title={t("sec.stats")} subtitle={form ? form.name : undefined}>
        <StatsSection stats={stats} percentiles={data.percentiles} accent={accent} isShedinja={p.slug === "shedinja"} showPercentiles={!form} />
      </Section>

      <Section id="matchups" index={sectionIndex("matchups")} title={t("sec.matchups")} subtitle={t("sec.matchupsSub")}>
        <MatchupSection defenses={defenses} stab={stab} typeNames={data.local?.types} />
      </Section>

      {data.evolutionTree && (
        <Section id="evolution" index={sectionIndex("evolution")} title={t("sec.evolution")}>
          <EvolutionSection tree={data.evolutionTree} currentId={p.id} typeNames={data.local?.types} />
        </Section>
      )}

      {data.lookalikes.length > 0 && (
        <Section id="lookalikes" index={sectionIndex("lookalikes")} title={t("sec.lookalikes")} subtitle={t("sec.lookalikesSub")}>
          <LookalikesSection self={{ id: p.id, name: p.name }} lookalikes={data.lookalikes} />
        </Section>
      )}

      {data.encounters && (
        <Section id="encounters" index={sectionIndex("encounters")} title={t("sec.encounters")} subtitle={t("sec.encountersSub")}>
          <EncountersSection gens={data.encounters} name={p.name} local={data.local} />
        </Section>
      )}

      {data.learnset && (
        <Section id="moves" index={sectionIndex("moves")} title={t("sec.moves")}>
          <MovesSection moves={data.learnset.moves} game={data.learnset.game} typeNames={data.local?.types} />
        </Section>
      )}

      {hasEntries && (
        <Section id="pokedex" index={sectionIndex("pokedex")} title={t("sec.entries")} subtitle={t("sec.entriesSub", { n: data.entries.length })}>
          <EntriesSection entries={data.entries} />
        </Section>
      )}

      {data.names.length > 0 && (
        <Section id="names" index={sectionIndex("names")} title={t("sec.names")} subtitle={t("sec.namesSub", { n: data.names.length })}>
          <NamesSection names={data.names} />
        </Section>
      )}

      <Section id="breeding" index={sectionIndex("breeding")} title={t("sec.breeding")}>
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
        <img src={artUrl(p.id, 256)} alt="" aria-hidden loading="lazy" decoding="async" className="pointer-events-none absolute -bottom-8 -right-6 h-48 w-48 opacity-20 [filter:brightness(0)_invert(1)] [.light_&]:opacity-10 [.light_&]:[filter:brightness(0)]" />
        <h2 className="font-display text-2xl font-bold uppercase">{t("cta.title", { name: p.name })}</h2>
        <p className="mt-1 max-w-lg text-muted-foreground">{t("cta.body")}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/pokedex/study?gen=${p.gen}`} className={buttonVariants()}>
            <BookOpenCheck className="h-4 w-4" /> {t("cta.study", { n: p.gen })}
          </Link>
          <Link href={`/quiz/gen-${p.gen}-pokemon-quiz`} className={buttonVariants({ variant: "outline" })}>
            <Gamepad2 className="h-4 w-4" /> {t("cta.quiz", { n: p.gen })}
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
                <div className="hud-label">{t("no", { n: String(n.id).padStart(4, "0") })}</div>
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
