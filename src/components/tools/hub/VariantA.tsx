import Link from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import type { HubData, HubTool } from "./data";
import { ShinyCycle } from "./ShinyCycle";
import { BallRack, BallStage, Chips, PickerCrown, TierFill } from "./previews";
import { CornerArrow, HubHeading, OpenPill } from "./parts";

/**
 * Direction A, "Bento": one board, no scrolling past empty space. The Shiny
 * Pokémon Maker is the hero tile (its Charizard cycling through the maker's
 * palettes); the Poké Ball Maker gets a wide tile with its renders and a rack
 * of official balls rolling by; the Tier List Maker and the Favorite Pokémon
 * Picker share the last row, each with its live picture.
 */

type Vars = React.CSSProperties & Record<`--${string}`, string>;
const vars = (tool: HubTool, sx: string, sy: string): Vars => ({ "--ac": tool.accent, "--sx": sx, "--sy": sy });
const TILE = "th-tile group block rounded-2xl focus-visible:ring-2 focus-visible:ring-ring";

export function VariantA({ data }: { data: HubData }) {
  const [shiny, ball, tier, picker] = data.tools;
  return (
    <div className="mx-auto max-w-6xl" data-testid="tools-page" data-variant="a">
      <HubHeading title={data.title} free={data.free} className="mb-5 sm:mb-6" />
      <div className="grid grid-cols-2 gap-3 md:h-[clamp(380px,calc(100svh-17.5rem),580px)] md:grid-cols-4 md:grid-rows-2 lg:gap-4">
        {/* The hero: the Shiny Pokémon Maker. */}
        <Link href={shiny.href} className={cn(TILE, "col-span-2 md:row-span-2")} style={vars(shiny, "64%", "40%")} data-testid={shiny.testId} data-hover-probe>
          <span className="th-scene" />
          <span className="th-sheen" />
          <ShinyCycle
            {...data.shiny}
            className="absolute inset-0"
            figureClassName="th-lift absolute left-1/2 top-5 h-[220px] -translate-x-1/2 md:left-auto md:right-[5%] md:top-[5%] md:h-[55%] md:translate-x-0 lg:h-[60%]"
            hudClassName="absolute left-4 top-4 rounded-md border border-white/10 bg-black/40 px-2.5 py-2 backdrop-blur md:left-6 md:top-6"
          />
          {/* On a phone the words sit under the picture (the tile grows with them); from md they lie over its foot. */}
          <div className="relative z-10 mt-[250px] p-5 pt-3 md:absolute md:inset-x-0 md:bottom-0 md:mt-0 md:bg-gradient-to-t md:from-[hsl(252_50%_5%)] md:via-[hsl(252_50%_5%/0.85)] md:to-transparent md:p-7 md:pt-20 lg:p-8">
            <Chips items={shiny.tags} className="mb-3 md:max-lg:hidden" />
            <h2 className="max-w-[14ch] font-display text-[34px] font-bold uppercase italic leading-[0.92] tracking-tight text-white md:text-4xl lg:text-[52px]">{shiny.title}</h2>
            <div className="mt-2 flex items-center justify-between gap-4 lg:mt-3">
              <p className="text-[15px] text-white/75 lg:text-lg">{shiny.subtitle}</p>
              <OpenPill label={data.open} big className="shrink-0 max-sm:hidden" />
            </div>
          </div>
          <CornerArrow className="absolute right-4 top-4 z-10 sm:hidden" />
        </Link>

        {/* The Poké Ball Maker: wide. */}
        <Link href={ball.href} className={cn(TILE, "col-span-2 h-[220px] md:h-auto")} style={vars(ball, "78%", "48%")} data-testid={ball.testId}>
          <span className="th-scene" />
          <span className="th-sheen" />
          <BallStage className="th-lift absolute right-[-3%] top-[4%] aspect-square h-[74%] sm:right-[2%] sm:top-1/2 sm:h-[92%] sm:-translate-y-1/2" priority />
          <div className="relative z-10 flex h-full max-w-[58%] flex-col p-5 max-sm:max-w-none lg:p-6">
            <Chips items={ball.tags.slice(0, 2)} className="max-lg:hidden" />
            <div className="my-auto py-2">
              <h2 className="max-w-[9ch] font-display text-[26px] font-bold uppercase italic leading-[0.95] tracking-tight text-white sm:max-w-none lg:text-[34px]">{ball.title}</h2>
              <p className="mt-1.5 max-w-[16ch] text-sm text-white/70 sm:max-w-none lg:text-base">{ball.subtitle}</p>
            </div>
            <BallRack balls={data.balls} size={30} className="-ml-1 w-full sm:w-[min(100%,300px)]" />
          </div>
        </Link>

        {/* The Tier List Maker. */}
        <Link href={tier.href} className={cn(TILE, "h-[250px] md:h-auto")} style={vars(tier, "50%", "30%")} data-testid={tier.testId}>
          <span className="th-scene" />
          <span className="th-sheen" />
          <div className="flex h-full flex-col p-3 lg:p-4">
            <TierFill className="th-lift [--tile:1.9rem] max-md:[&_img:nth-of-type(4)]:hidden md:[--tile:1.6rem] md:[&>div:nth-child(4)]:hidden lg:[--tile:2.5rem]" rows={4} perRow={4} />
            <div className="mt-auto flex items-end justify-between gap-2 pt-2">
              <h2 className="font-display text-lg font-bold uppercase italic leading-[0.95] tracking-tight text-white lg:text-[22px]">{tier.title}</h2>
              <CornerArrow className="shrink-0 max-md:hidden" />
            </div>
          </div>
        </Link>

        {/* The Favorite Pokémon Picker. */}
        <Link href={picker.href} className={cn(TILE, "h-[250px] md:h-auto")} style={vars(picker, "50%", "36%")} data-testid={picker.testId}>
          <span className="th-scene" />
          <span className="th-sheen" />
          <div className="flex h-full flex-col p-3 lg:p-4">
            <div className="flex min-h-0 flex-1 items-center justify-center [container-type:size]">
              <PickerCrown className="th-lift" size="min(72cqh, 58cqw, 10rem)" />
            </div>
            <div className="flex items-end justify-between gap-2 pt-2">
              <h2 className="font-display text-lg font-bold uppercase italic leading-[0.95] tracking-tight text-white lg:text-[22px]">{picker.title}</h2>
              <CornerArrow className="shrink-0 max-md:hidden" />
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
