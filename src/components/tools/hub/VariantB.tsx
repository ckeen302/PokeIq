import Link from "@/components/ui/Link";
import type { HubData, HubTool } from "./data";
import { ShinyCycle } from "./ShinyCycle";
import { BallStage, Chips, PickerCrown, TierFill } from "./previews";
import { HubHeading, OpenPill } from "./parts";

/**
 * Direction B, "Arcade": a tight 2×2 of game-mode cards, each washed in its
 * tool's colour with speed lines, its art big and bleeding off the edge, and
 * a huge italic title. Hovering a card lifts the art and slides up the
 * tool's line, its features and Open; on a phone it's a 2×2 of picture tiles
 * that fits on one screen.
 */

type Vars = React.CSSProperties & Record<`--${string}`, string>;

function Card({ tool, open, children, priority }: { tool: HubTool; open: string; children: React.ReactNode; priority?: boolean }) {
  return (
    <Link
      href={tool.href}
      className="th-tile group block h-[236px] rounded-2xl focus-visible:ring-2 focus-visible:ring-ring sm:h-[clamp(190px,calc((100svh-17rem)/2),310px)]"
      style={{ "--ac": tool.accent } as Vars}
      data-testid={tool.testId}
      data-hover-probe={priority || undefined}
    >
      <span
        className="absolute inset-0 -z-10"
        style={{ background: `radial-gradient(75% 110% at 82% 30%, hsl(${tool.accent} / .6), transparent 62%), radial-gradient(70% 90% at 0% 0%, hsl(${tool.accent} / .22), transparent 70%), linear-gradient(115deg, hsl(250 46% 9%) 40%, hsl(${tool.accent} / .32))` }}
      />
      <span className="th-speed" />
      <span className="th-sheen" />
      {children}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[hsl(252_50%_5%/0.92)] via-[hsl(252_50%_5%/0.5)] to-transparent p-3.5 pt-10 sm:p-5 sm:pt-14 lg:p-6">
        <h2 className="font-display text-[19px] font-bold uppercase italic leading-[0.92] tracking-tight text-white [text-shadow:0_4px_18px_rgb(0_0_0/0.6)] sm:max-w-[50%] sm:text-[28px] lg:max-w-[48%] lg:text-[42px]">
          {tool.title}
        </h2>
        <p className="max-w-[34ch] pt-1.5 text-[15px] text-white/80 [text-shadow:0_2px_10px_rgb(0_0_0/0.8)] max-lg:hidden">{tool.subtitle}</p>
        {/* Hover (or keyboard focus): the tool's features and Open slide up. */}
        <div className="th-reveal grid max-sm:hidden">
          <div>
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <OpenPill label={open} />
              <Chips items={tool.tags} className="max-lg:hidden" />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function VariantB({ data }: { data: HubData }) {
  const [shiny, ball, tier, picker] = data.tools;
  return (
    <div className="mx-auto max-w-6xl" data-testid="tools-page" data-variant="b">
      <HubHeading title={data.title} free={data.free} className="mb-5 sm:mb-6" />
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
        <Card tool={shiny} open={data.open} priority>
          <ShinyCycle
            {...data.shiny}
            className="absolute inset-0"
            figureClassName="th-lift absolute left-1/2 top-[7%] h-[56%] -translate-x-1/2 sm:-bottom-[10%] sm:left-auto sm:right-[-5%] sm:top-auto sm:h-[112%] sm:translate-x-0"
            hudClassName="absolute left-4 top-4 rounded-md border border-white/10 bg-black/40 px-2.5 py-2 backdrop-blur max-sm:hidden sm:left-6 sm:top-6"
          />
        </Card>
        <Card tool={ball} open={data.open}>
          <BallStage className="th-lift absolute left-1/2 top-[4%] aspect-square h-[60%] -translate-x-1/2 sm:left-auto sm:right-[-4%] sm:top-1/2 sm:h-[116%] sm:-translate-y-1/2 sm:translate-x-0" priority />
        </Card>
        <Card tool={tier} open={data.open}>
          <div className="absolute left-3 top-3 [--tile:1.45rem] [transform:perspective(700px)_rotateY(-18deg)_rotateX(8deg)] sm:left-auto sm:right-[-4%] sm:top-[9%] sm:[--tile:2.1rem] sm:[transform:perspective(700px)_rotateY(-24deg)_rotateX(10deg)] lg:[--tile:3rem]">
            <TierFill className="th-lift max-sm:[&_img:nth-of-type(4)]:hidden" rows={4} perRow={4} />
          </div>
        </Card>
        <Card tool={picker} open={data.open}>
          <div className="absolute inset-x-0 top-[3%] flex justify-center sm:inset-x-auto sm:bottom-[4%] sm:right-[1%] sm:top-auto">
            <PickerCrown className="th-lift" size="clamp(5.2rem, 14vw, 11.5rem)" />
          </div>
        </Card>
      </div>
    </div>
  );
}
