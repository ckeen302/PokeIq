"use client";

import dynamic from "next/dynamic";
import { useT } from "@/i18n/client";
import tools from "@/messages/tools";
import type { Design } from "@/lib/shiny-maker/design";

/**
 * The maker loads in the browser only (it measures the screen and draws on canvases); until then, a skeleton with
 * the same geometry as the stage and the dock, so nothing moves when it arrives. The title is in the page's HTML.
 */
function Skeleton() {
  const t = useT(tools);
  const chips = [96, 88, 104, 84];
  return (
    <div className="dark-scope" data-testid="shiny-maker-skeleton">
      <div className="space-y-4 lg:hidden">
        {/* One H1 in the page's HTML (the desktop one below); the phone's copy is the same words. */}
        <header className="px-1" aria-hidden>
          <p className="font-display text-[22px] font-semibold leading-tight tracking-tight">{t("maker.title")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("maker.subtitle")}</p>
        </header>
        <section className="sm-stage-skel relative h-[min(440px,56svh)] min-h-[340px] overflow-hidden rounded-[24px] border border-white/[0.06]">
          <Glow />
        </section>
        <div className="space-y-3">
          <div className="flex h-11 items-center gap-2.5"><span className="h-9 w-9 rounded-full bg-white/[0.06]" /><span className="h-4 w-24 rounded bg-white/[0.06]" /></div>
          <div className="flex gap-2">{chips.map((w, i) => <span key={i} className="h-11 shrink-0 rounded-full bg-white/[0.04]" style={{ width: w }} />)}</div>
          <div className="grid grid-cols-2 gap-3 pt-1"><span className="h-12 rounded-full bg-white/[0.05]" /><span className="h-12 rounded-full bg-primary/40" /></div>
        </div>
      </div>
      <section className="sm-stage-skel relative h-[calc(100dvh-108px)] min-h-[640px] overflow-hidden rounded-[28px] border border-white/[0.06] max-lg:hidden">
        <header className="absolute left-9 top-8">
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">{t("maker.title")}</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">{t("maker.subtitle")}</p>
        </header>
        <Glow />
        <div className="absolute bottom-8 left-1/2 flex h-14 w-[760px] max-w-[calc(100%-48px)] -translate-x-1/2 items-center gap-2 rounded-full bg-white/[0.05] px-2">
          <span className="h-9 w-9 rounded-full bg-white/[0.06]" />
          {chips.map((w, i) => <span key={i} className="h-8 rounded-full bg-white/[0.04]" style={{ width: w }} />)}
        </div>
      </section>
      <p className="mt-4 px-1 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
      <style>{`.sm-stage-skel{background:radial-gradient(70% 60% at 50% 48%,hsl(250 40% 14%/.65),transparent 75%),linear-gradient(180deg,hsl(248 34% 9%/.94),hsl(248 36% 6%/.97))}
@keyframes sm-skel{0%,100%{opacity:.5}50%{opacity:.9}}.sm-skel-glow{animation:sm-skel 2.4s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.sm-skel-glow{animation:none}}`}</style>
    </div>
  );
}

function Glow() {
  return <div className="sm-skel-glow absolute left-1/2 top-1/2 h-[46%] w-[36%] max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-[45%] bg-white/[0.05] blur-2xl" aria-hidden />;
}

const ShinyMaker = dynamic(() => import("./ShinyMaker"), { ssr: false, loading: Skeleton });

export function MakerShell({ initial, linkBroken }: { initial: Design | null; linkBroken: boolean }) {
  return <ShinyMaker initial={initial} linkBroken={linkBroken} />;
}
