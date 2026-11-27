"use client";

import { useState } from "react";
import { ArrowRight, Brain, CalendarDays, Check, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTab, IconWell } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Toggle, ToggleGroup, toggleGroupClass } from "@/components/ui/toggle";
import { SECTION_ACCENT } from "@/components/ui/accents";
import { MODULE_INFO } from "@/lib/modes";
import home from "@/messages/en/home.json";
import featured from "@/messages/en/quiz-featured.json";
import modes from "@/messages/en/quiz-modes.json";
import quizPages from "@/messages/en/quiz-pages.json";
import battleHome from "@/messages/en/battle-home.json";
import tools from "@/messages/en/tools.json";

/** The kit, every piece once, for review (/ui-kit; mock only, not linked from anywhere). Its words are the site's own. */
export function KitShowcase() {
  const [format, setFormat] = useState<"classic" | "survival" | "blitz">("classic");
  const [level, setLevel] = useState("medium");
  const label = "font-pixel text-[10px] uppercase tracking-[0.14em] text-muted-foreground";
  return (
    <div className="mx-auto max-w-5xl space-y-10" data-testid="ui-kit">
      <div className="space-y-6">
        <p className={label}>PageHeader</p>
        <PageHeader kicker={home.free} live title={quizPages.hub.h1} />
        <PageHeader
          kicker={battleHome.unit}
          title={battleHome.title}
          accent={battleHome.accent}
          actions={
            <Card variant="base" className="flex items-center gap-2 rounded-xl px-3 py-2">
              <span className="led h-2 w-2 text-success" />
              <span className="font-display text-xl font-bold tabular-nums">0</span>
              <span className="text-xs text-muted-foreground">{battleHome.online}</span>
            </Card>
          }
        />
        <SectionHeader index={1} title={quizPages.hub.duel} aside={quizPages.hub.duelLine} />
      </div>

      <div className="space-y-4">
        <p className={label}>Card · base (calm) and feature (glossy, with art)</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Card variant="base" interactive accent={MODULE_INFO["whos-that"].accent} className="flex items-center gap-4 p-4">
            <IconWell size="lg">
              <Brain aria-hidden />
            </IconWell>
            <span className="min-w-0">
              <span className="block font-display text-lg font-bold uppercase italic tracking-wide">{modes.modules["whos-that"].title}</span>
              <span className="block text-sm text-muted-foreground">{modes.modules["whos-that"].description}</span>
            </span>
          </Card>
          <Card variant="base" interactive accent={SECTION_ACCENT.battle} className="flex items-center gap-4 p-4">
            <IconWell size="lg">
              <Swords aria-hidden />
            </IconWell>
            <span className="min-w-0">
              <span className="block font-display text-lg font-bold uppercase italic tracking-wide">{battleHome.battle}</span>
              <span className="block text-sm text-muted-foreground">{battleHome.whyName}</span>
            </span>
          </Card>
          <div className="relative pt-[1.55rem]">
            <CardTab className="absolute left-4 top-0">{featured.daily.kicker}</CardTab>
            <Card variant="feature" interactive accent="340 86% 60%" className="overflow-hidden p-6">
              <CalendarDays className="pointer-events-none absolute -bottom-6 -right-4 h-[150px] w-[150px] rotate-[-8deg] text-primary opacity-[0.14]" strokeWidth={1.5} aria-hidden />
              <span className="flex items-center gap-4">
                <IconWell size="lg">
                  <CalendarDays aria-hidden />
                </IconWell>
                <span className="kit-title block text-[1.75rem]">{featured.daily.title}</span>
              </span>
              <span className="mt-3 block max-w-md text-[15px] leading-snug text-feature-sub">{featured.daily.text}</span>
              <span className="mt-5 flex items-center gap-3">
                <Button tabIndex={-1}>
                  {featured.daily.cta} <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
                  <Check className="h-4 w-4" aria-hidden /> {featured.done}
                </span>
              </span>
            </Card>
          </div>
          <Card variant="feature" interactive accent="190 90% 56%" className="flex flex-col p-2">
            <div className="aspect-[16/9] overflow-hidden rounded-[0.7rem] bg-well">
              {/* eslint-disable-next-line @next/next/no-img-element -- a pre-sized screenshot */}
              <img src="/tools/hub/shiny-800.webp" alt="" className="h-full w-full object-cover" />
            </div>
            <div className="px-3 pb-3 pt-4">
              <span className="kit-title block text-[26px]">{tools.maker.title}</span>
              <span className="kit-ink mt-3 inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-[0.12em]">
                {tools.hub.open} <ArrowRight className="h-4 w-4" aria-hidden />
              </span>
            </div>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        <p className={label}>Button · primary (main action only), secondary, ghost, success (confirm only)</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg">
            <Swords className="h-5 w-5" aria-hidden /> {battleHome.battle}
          </Button>
          <Button size="lg" variant="secondary">
            {battleHome.invite}
          </Button>
          <Button size="lg" variant="ghost">
            {battleHome.cancel}
          </Button>
          <Button size="lg" variant="success">
            <Check className="h-5 w-5" aria-hidden /> {featured.done}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="xl">{home.play}</Button>
          <Button>{featured.iq.cta}</Button>
          <Button variant="secondary">{featured.iq.cta}</Button>
          <Button size="sm">{tools.hub.open}</Button>
          <Button size="sm" variant="secondary">
            {tools.hub.open}
          </Button>
          <Button variant="secondary" disabled>
            {battleHome.battle}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <p className={label}>Tokens · each a dark and a light pair (globals.css)</p>
        <div className="flex flex-wrap gap-3">
          {["surface", "surface-raised", "surface-line", "well", "select", "feature-1", "feature-3", "tab"].map((v) => (
            <span key={v} className="flex items-center gap-2 rounded-lg bg-surface py-1.5 pl-1.5 pr-3 shadow-[inset_0_0_0_1px_hsl(var(--surface-line))]">
              <span className="h-7 w-7 rounded-md shadow-[inset_0_0_0_1px_rgb(127_127_127/0.35)]" style={{ background: `hsl(var(--${v}))` }} />
              <code className="font-pixel text-[10px] text-muted-foreground">--{v}</code>
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <p className={label}>Tabs / toggles · chosen is a violet outline and tint, never the action pink</p>
        <div className="flex flex-wrap items-center gap-4">
          <ToggleGroup
            label="Format"
            value={format}
            onChange={setFormat}
            options={(["classic", "survival", "blitz"] as const).map((f) => ({ value: f, label: modes.formats[f].title }))}
          />
          <div className={toggleGroupClass} role="group" aria-label="Difficulty">
            {(["easy", "medium", "hard"] as const).map((l) => (
              <Toggle key={l} size="sm" pressed={level === l} onClick={() => setLevel(l)}>
                {l === "easy" ? modes.levels["shiny-easy"].label : l === "medium" ? modes.levels["whose-team-medium"].label : modes.levels["shiny-hard"].label}
              </Toggle>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
