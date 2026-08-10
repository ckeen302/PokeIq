import Image from "next/image";
import { officialArtworkUrl } from "@/lib/pokeapi";
import { cn } from "@/lib/utils";

const ALAKAZAM_ID = 65;

/**
 * PokéIQ's mascot: Alakazam, framed with expanding psychic sonar rings and
 * a pair of bending spoons. Used on the global loading screen, empty states,
 * and the 404 page.
 */
export function AlakazamMascot({
  size = 120,
  showSpoons = true,
  className,
}: {
  size?: number;
  showSpoons?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("relative mx-auto", className)}
      style={{ width: size, height: size }}
    >
      <div aria-hidden className="psychic-rings" />
      <div
        aria-hidden
        className="absolute inset-0 rounded-full bg-purple-500/20 blur-2xl"
      />
      <Image
        src={officialArtworkUrl(ALAKAZAM_ID)}
        alt="Alakazam"
        width={size}
        height={size}
        className="relative drop-shadow-[0_8px_20px_rgba(147,51,234,0.35)]"
        priority
      />
      {showSpoons && (
        <>
          <span
            aria-hidden
            className="spoon-bend absolute -left-1 top-2 text-xl"
            style={{ fontSize: size * 0.16 }}
          >
            🥄
          </span>
          <span
            aria-hidden
            className="spoon-bend spoon-bend-delay absolute -right-1 top-2 scale-x-[-1] text-xl"
            style={{ fontSize: size * 0.16 }}
          >
            🥄
          </span>
        </>
      )}
    </div>
  );
}
