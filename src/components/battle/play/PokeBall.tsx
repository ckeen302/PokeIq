import { BALLS, type BallId } from "@/lib/trainer/config";

/**
 * A Poké Ball drawn in CSS, for the send-out on the stage and the team balls
 * in the HUD: the trainer's own ball (their 3D trainer's) or a standard one.
 * The markings follow the 3D trainer's ball (components/trainer3d/model.ts).
 */

export interface BallLook {
  id: BallId;
  top: string;
  bottom: string;
}

export const STANDARD_BALL: BallLook = { id: "poke", top: BALLS[0].top, bottom: BALLS[0].bottom };

export function ballLook(id: string | undefined | null): BallLook {
  const b = BALLS.find((x) => x.id === id);
  return b ? { id: b.id, top: b.top, bottom: b.bottom } : STANDARD_BALL;
}

/** The ball's markings over its top half, as CSS backgrounds sized to that half (coordinates within it). */
function markings(id: BallId): string[] {
  switch (id) {
    case "great":
      return ["radial-gradient(ellipse 22% 34% at 22% 62%, #e3262f 98%, transparent)", "radial-gradient(ellipse 22% 34% at 78% 62%, #e3262f 98%, transparent)"];
    case "ultra":
      return ["linear-gradient(90deg, transparent 20%, #f2c230 20% 31%, transparent 31% 69%, #f2c230 69% 80%, transparent 80%)"];
    case "master":
      return ["radial-gradient(circle at 26% 56%, #ef6fb0 10%, transparent 11%)", "radial-gradient(circle at 74% 56%, #ef6fb0 10%, transparent 11%)"];
    case "quick":
      return ["linear-gradient(90deg, transparent 44%, #f5d132 44% 56%, transparent 56%)"];
    case "timer":
      return ["repeating-linear-gradient(90deg, transparent 0 18%, #d8262f 18% 26%)"];
    case "dusk":
      return ["linear-gradient(transparent 58%, #5bc04d 58% 74%, transparent 74%)"];
    case "luxury":
      return ["linear-gradient(transparent 50%, #d8262f 50% 76%, transparent 76%)"];
    case "heal":
      return ["linear-gradient(transparent 54%, #ffd0e4 54% 72%, transparent 72%)"];
    case "love":
      return ["radial-gradient(ellipse 16% 30% at 50% 66%, #e8336f 98%, transparent)"];
    case "safari":
      return ["radial-gradient(circle at 30% 50%, #4e6b2a 9%, transparent 10%)", "radial-gradient(circle at 68% 66%, #4e6b2a 8%, transparent 9%)", "radial-gradient(circle at 48% 26%, #4e6b2a 7%, transparent 8%)"];
    case "beast":
      return ["linear-gradient(90deg, transparent 47%, #f2c230 47% 53%, transparent 53%)", "linear-gradient(transparent 44%, #f2c230 44% 54%, transparent 54%)"];
    case "cherish":
      return ["linear-gradient(transparent 54%, #f27b7b 54% 66%, transparent 66%)"];
    default:
      return [];
  }
}

/** The band and button colour (gold on a Luxury Ball, red on a Premier). */
const bandOf = (id: BallId) => (id === "premier" ? "#d8262f" : id === "luxury" ? "#e0b33a" : "#1b1b1f");

/** The full CSS background of a ball (top half, band, bottom half, markings and a highlight). */
export function ballBackground(look: BallLook): string {
  const band = bandOf(look.id);
  return [
    "radial-gradient(circle at 34% 28%, rgb(255 255 255 / 0.85) 0 7%, rgb(255 255 255 / 0) 22%)",
    `radial-gradient(circle at 50% 50%, #fff 0 9%, ${band} 9% 15%, transparent 15%)`,
    ...markings(look.id).map((m) => `${m} top / 100% 45% no-repeat`),
    `linear-gradient(180deg, ${look.top} 0 45%, ${band} 45% 55%, ${look.bottom} 55%)`,
  ].join(", ");
}

/** A small ball (team balls; `dim` for a fainted Pokémon). */
export function PokeBallIcon({ look, size = 14, className, dim }: { look: BallLook; size?: number; className?: string; dim?: boolean }) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: ballBackground(look),
        boxShadow: "inset -1px -2px 2px rgb(0 0 0 / 0.35), 0 1px 2px rgb(0 0 0 / 0.5)",
        border: "1px solid rgb(0 0 0 / 0.6)",
        filter: dim ? "grayscale(1) brightness(0.55)" : undefined,
      }}
    />
  );
}
