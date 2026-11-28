import Link from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import type { HubData, HubTool } from "./data";
import { HubHeading, OpenPill } from "./parts";

type Vars = React.CSSProperties & Record<`--${string}`, string>;

/**
 * A tool's card, the 3D Lab's card in a smaller size: its picture on top, then just its name and Open (the tools explain
 * themselves). A plain card face, so it sits on the page in either theme. Pointing at it lights its border in the tool's
 * colour and eases the picture in.
 */
function ToolCard({ tool, open, priority }: { tool: HubTool; open: string; priority?: boolean }) {
  return (
    <Link
      href={tool.href}
      className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-[hsl(var(--ac)/0.6)] hover:shadow-[0_18px_44px_-14px_hsl(var(--ac)/0.45)] focus-visible:border-[hsl(var(--ac)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={{ "--ac": tool.accent } as Vars}
      data-testid={tool.testId}
    >
      <div className="relative aspect-[4/3] shrink-0 overflow-hidden bg-[hsl(250_40%_7%)]">
        {/* By night and by day, as the theme is. */}
        {(["", "-light"] as const).map((v) => {
          const src = tool.image.replace(".webp", `${v}.webp`);
          return (
            // eslint-disable-next-line @next/next/no-img-element -- pre-sized pictures, no optimiser needed
            <img
              key={v}
              src={src.replace(".webp", "-800.webp")}
              srcSet={`${src.replace(".webp", "-800.webp")} 640w, ${src} 1200w`}
              sizes="(min-width: 1152px) 370px, (min-width: 1024px) 31vw, 48vw"
              alt=""
              decoding="async"
              loading={priority && !v ? undefined : "lazy"}
              fetchPriority={priority && !v ? "high" : undefined}
              className={cn("h-full w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none", v ? "hidden [.light_&]:block" : "[.light_&]:hidden")}
            />
          );
        })}
      </div>
      <div className="flex flex-1 flex-col justify-between gap-4 p-5 max-sm:gap-0 max-sm:p-3 lg:p-6">
        <h2 className="font-display text-xl font-bold uppercase leading-[0.95] tracking-tight [overflow-wrap:anywhere] max-sm:text-[15px] lg:text-2xl">{tool.title}</h2>
        <OpenPill label={open} className="max-sm:hidden" />
      </div>
    </Link>
  );
}

/** /tools: the tools as cards under the page's title: three wide on a wide screen, two wide on a tablet and a phone. */
export function ToolsHub({ data }: { data: HubData }) {
  return (
    <div className="mx-auto max-w-6xl" data-testid="tools-page">
      <HubHeading title={data.title} free={data.free} className="mb-5 sm:mb-6" />
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
        {data.tools.map((tool, i) => (
          <ToolCard key={tool.href} tool={tool} open={data.open} priority={i < 3} />
        ))}
      </div>
    </div>
  );
}
