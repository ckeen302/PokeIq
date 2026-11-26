import Link from "@/components/ui/Link";
import type { HubData, HubTool } from "./data";
import { HubHeading, OpenPill } from "./parts";

type Vars = React.CSSProperties & Record<`--${string}`, string>;

/**
 * A tool's card: a screenshot of the tool in use, full bleed, shaded for its
 * big italic title and line: along the foot on a phone and in the three-wide
 * grid of a wide screen, on the left in the two-wide grid of a tablet.
 * Pointing at it lights its border in the tool's colour and eases the picture in.
 */
function ToolCard({ tool, open, priority }: { tool: HubTool; open: string; priority?: boolean }) {
  return (
    <Link
      href={tool.href}
      className="group relative isolate block h-[236px] overflow-hidden [container-type:inline-size] rounded-2xl border border-[hsl(var(--ac)/0.18)] bg-[hsl(250_40%_7%)] transition-[border-color,box-shadow] duration-300 hover:border-[hsl(var(--ac)/0.65)] hover:shadow-[0_18px_50px_-12px_hsl(var(--ac)/0.45)] focus-visible:border-[hsl(var(--ac)/0.65)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-[clamp(200px,calc((100svh-17rem)/2),320px)]"
      style={{ "--ac": tool.accent } as Vars}
      data-testid={tool.testId}
    >
      {/* The picture: on a phone and a wide screen the whole card, under the title; on a tablet the card's right side, fading into the words on the left. */}
      <div className="absolute inset-0 -z-10 sm:left-[36%] sm:[mask-image:linear-gradient(to_right,transparent,#000_28%)] lg:left-0 lg:[mask-image:none]">
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized screenshots, no optimiser needed */}
        <img
          src={tool.image.replace(".webp", "-800.webp")}
          srcSet={`${tool.image.replace(".webp", "-800.webp")} 640w, ${tool.image} 1200w`}
          sizes="(min-width: 1152px) 380px, (min-width: 1024px) 33vw, (min-width: 640px) 32vw, 50vw"
          alt=""
          decoding="async"
          loading={priority ? undefined : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          className="h-full w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
        />
      </div>
      <span className="absolute inset-x-0 bottom-0 -z-10 h-3/5 bg-gradient-to-t from-[hsl(252_50%_5%/0.95)] to-transparent sm:hidden lg:block lg:h-[78%] lg:via-[hsl(252_50%_5%/0.7)] lg:via-40%" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 p-3.5 sm:inset-y-0 sm:right-auto sm:flex sm:w-[52%] sm:flex-col sm:justify-end sm:p-5 lg:top-auto lg:w-full lg:p-6">
        <h2 className="font-display text-[19px] font-bold uppercase italic leading-[0.92] tracking-tight text-white [text-shadow:0_4px_18px_rgb(0_0_0/0.6)] [overflow-wrap:anywhere] sm:text-[min(26px,6cqw)] lg:text-[30px] xl:text-[32px]">
          {tool.title}
        </h2>
        <p className="pt-2 text-[15px] leading-snug text-white/75 max-lg:hidden lg:line-clamp-2">{tool.subtitle}</p>
        <OpenPill label={open} className="mt-4 max-sm:hidden" />
      </div>
    </Link>
  );
}

/** /tools: the tools as picture cards under the page's title: three wide on a wide screen (two rows that fit a laptop), two wide on a tablet and a phone. */
export function ToolsHub({ data }: { data: HubData }) {
  return (
    <div className="mx-auto max-w-6xl" data-testid="tools-page">
      <HubHeading title={data.title} free={data.free} className="mb-5 sm:mb-6" />
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
        {data.tools.map((tool, i) => (
          <ToolCard key={tool.href} tool={tool} open={data.open} priority={i < 3} />
        ))}
      </div>
    </div>
  );
}
