"use client";

/* MOCK ONLY: /tools, the Tools hub, with the Shiny Pokémon Maker as its one tool. */

import { ArrowRight } from "lucide-react";
import Link from "@/components/ui/Link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dot, Hero, MAKER_CSS, PARTS } from "./maker-parts";

export function ToolsHubMock() {
  return (
    <div className="mx-auto max-w-5xl pt-4 max-sm:pt-0" data-testid="tools-page">
      <h1 className="font-display text-5xl font-bold uppercase tracking-tight sm:text-6xl">Tools</h1>

      <Link
        href="/tools/shiny-maker"
        className="group mt-10 grid overflow-hidden rounded-[28px] border border-foreground/[0.07] bg-card/70 transition-colors hover:border-foreground/15 max-sm:mt-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
        data-testid="tool-card-shiny-maker"
      >
        <div className="maker-stage relative flex h-[400px] items-center justify-center max-sm:h-[300px]">
          <Hero scale={3.5} className="transition-transform duration-500 group-hover:scale-[1.03] max-sm:scale-[0.8]" />
        </div>
        <div className="flex flex-col justify-center gap-5 p-10 max-sm:p-6">
          <h2 className="font-display text-[34px] font-semibold leading-tight tracking-tight max-sm:text-[26px]">Shiny Pokémon Maker</h2>
          <p className="-mt-2 text-[17px] text-muted-foreground">Design your own shiny Pokémon.</p>
          <div className="flex gap-2" aria-hidden>
            {PARTS.map((p) => (
              <Dot key={p.id} color={p.color} size={16} />
            ))}
          </div>
          <span className={cn(buttonVariants(), "mt-3 h-11 w-fit rounded-full px-6 shadow-none")}>
            Open <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </Link>
      <style>{MAKER_CSS}</style>
    </div>
  );
}
