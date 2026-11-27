import Link from "@/components/ui/Link";
import { ArrowRight } from "lucide-react";
import { accentStyle, cardVariants } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import type { HubData, HubTool } from "./data";

/**
 * A tool's card: the kit's feature card, its art a screenshot of the tool in use set into the top like a picture
 * in a frame, its big italic title and line on the face under it (violet by night, white-lavender by day: no more
 * night-black card on the light page). Pointing at it lifts it, lights its ring in the tool's colour and eases the picture in.
 */
function ToolCard({ tool, open, priority }: { tool: HubTool; open: string; priority?: boolean }) {
  return (
    <Link
      href={tool.href}
      className={cn(cardVariants({ variant: "feature", interactive: true }), "group flex h-full flex-col p-1.5 sm:p-2")}
      style={accentStyle(tool.accent)}
      data-testid={tool.testId}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-[0.7rem] bg-well shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)] sm:aspect-[16/10] lg:aspect-[16/9]">
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized screenshots, no optimiser needed */}
        <img
          src={tool.image.replace(".webp", "-800.webp")}
          srcSet={`${tool.image.replace(".webp", "-800.webp")} 640w, ${tool.image} 1200w`}
          sizes="(min-width: 1152px) 380px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 50vw"
          alt=""
          decoding="async"
          loading={priority ? undefined : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          className="h-full w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
        />
      </div>
      <div className="flex flex-1 flex-col px-2 pb-2 pt-3 sm:px-3 sm:pb-3 sm:pt-4">
        <h2 className="kit-title text-[17px] leading-[0.98] [overflow-wrap:anywhere] sm:text-[24px] xl:text-[26px]">{tool.title}</h2>
        <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-feature-sub max-sm:hidden">{tool.subtitle}</p>
        <span className="kit-ink mt-auto inline-flex items-center gap-1.5 pt-3 font-display text-xs font-bold uppercase tracking-[0.12em] max-sm:hidden">
          {open} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

/** /tools: the tools as picture cards under the page's header: three wide on a wide screen, two wide on a tablet and a phone. */
export function ToolsHub({ data }: { data: HubData }) {
  return (
    <div className="mx-auto max-w-6xl" data-testid="tools-page">
      <PageHeader kicker={data.free} live title={data.title} className="mb-6 sm:mb-8" />
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
        {data.tools.map((tool, i) => (
          <ToolCard key={tool.href} tool={tool} open={data.open} priority={i < 3} />
        ))}
      </div>
    </div>
  );
}
