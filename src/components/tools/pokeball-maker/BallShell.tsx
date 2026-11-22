"use client";

import dynamic from "next/dynamic";
import { useT } from "@/i18n/client";
import msgs from "@/messages/pokeball-maker";
import type { Design } from "@/lib/pokeball-maker/design";

/**
 * The maker loads in the browser only (it draws with WebGL and measures the screen); until then, a skeleton with the
 * stage's and the dock's geometry, so nothing moves when it arrives. The title is in the page's HTML.
 */
function Skeleton() {
  const t = useT(msgs);
  const tabs = [62, 70, 74, 60, 58, 70, 58, 58, 48];
  return (
    <div className="dark-scope" data-testid="pokeball-maker-skeleton">
      <div className="space-y-4 lg:hidden">
        <header className="px-1" aria-hidden>
          <p className="font-display text-[22px] font-semibold leading-tight tracking-tight">{t("title")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
        </header>
        <section className="pbm-skel relative h-[min(440px,56svh)] min-h-[340px] overflow-hidden rounded-[24px] border border-white/[0.06]">
          <Ball />
        </section>
        <div className="flex gap-2 overflow-hidden">{tabs.map((w, i) => <span key={i} className="h-11 shrink-0 rounded-full bg-white/[0.04]" style={{ width: w + 16 }} />)}</div>
      </div>
      <section className="pbm-skel relative h-[calc(100dvh-108px)] min-h-[640px] overflow-hidden rounded-[28px] border border-white/[0.06] max-lg:hidden">
        <header className="absolute left-9 top-8">
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">{t("subtitle")}</p>
        </header>
        <Ball />
        <div className="absolute bottom-8 left-1/2 flex h-14 w-[880px] max-w-[calc(100%-48px)] -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/[0.05] px-2">
          {tabs.map((w, i) => <span key={i} className="h-8 rounded-full bg-white/[0.04]" style={{ width: w }} />)}
        </div>
      </section>
      <p className="mt-4 px-1 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
      <style>{`.pbm-skel{background:radial-gradient(70% 60% at 50% 48%,hsl(250 40% 14%/.65),transparent 75%),linear-gradient(180deg,hsl(248 34% 9%/.94),hsl(248 36% 6%/.97))}
@keyframes pbm-skel{0%,100%{opacity:.5}50%{opacity:.9}}.pbm-skel-ball{animation:pbm-skel 2.4s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.pbm-skel-ball{animation:none}}`}</style>
    </div>
  );
}

function Ball() {
  return <div className="pbm-skel-ball absolute left-1/2 top-1/2 aspect-square h-[44%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.05] blur-xl" aria-hidden />;
}

const BallMaker = dynamic(() => import("./BallMaker"), { ssr: false, loading: Skeleton });

export function BallShell({ initial, linkBroken }: { initial: Design | null; linkBroken: boolean }) {
  return <BallMaker initial={initial} linkBroken={linkBroken} />;
}
