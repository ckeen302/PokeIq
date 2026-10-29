import { pictureSrc, type PublicAvatar } from "@/lib/avatar";
import { artUrl } from "@/lib/pokemon/art";
import { cn } from "@/lib/utils";

/**
 * A trainer's character on the versus screen, facing their opponent.
 *
 * For now it's their profile avatar drawn large (the Pokémon's official art,
 * or their approved picture in a round frame); guests and unknown trainers
 * get a silhouette. Everything that draws the character is in this one
 * component, so a posed 3D trainer can replace the art here without the
 * versus screen changing.
 */

export type VersusFacing = "left" | "right";

export interface VersusCharacterProps {
  avatar?: PublicAvatar | null;
  /** The side they face: the left trainer faces right, toward the right one. */
  facing: VersusFacing;
  /** A computer opponent's own figure (the Gym Leader), drawn in place of an avatar. */
  figure?: React.ReactNode;
  className?: string;
}

export function VersusCharacter({ avatar, facing, figure, className }: VersusCharacterProps) {
  // Official art mostly faces the viewer's left: mirrored for the trainer who faces right.
  const flip = facing === "right" ? "-scale-x-100" : "";
  const box = cn("relative flex aspect-square items-end justify-center", className);
  if (figure) {
    return (
      <div className={box} data-testid="versus-character" data-kind="figure">
        <div className="flex h-full w-full items-center justify-center">{figure}</div>
      </div>
    );
  }
  if (!avatar) {
    return (
      <div className={box} data-testid="versus-character" data-kind="silhouette">
        <Silhouette className={cn("h-[92%] w-auto text-black/55 drop-shadow-[0_0_18px_rgba(169,156,255,0.35)]", flip)} />
      </div>
    );
  }
  if (avatar.picture) {
    return (
      <div className={box} data-testid="versus-character" data-kind="picture">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pictureSrc(avatar.picture, true)} alt="" decoding="async" className="aspect-square w-[78%] self-center rounded-full object-cover ring-4 ring-white/70 shadow-2xl" />
      </div>
    );
  }
  return (
    <div className={box} data-testid="versus-character" data-kind="art" data-avatar={`${avatar.pokemonId}${avatar.shiny ? "s" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={artUrl(avatar.pokemonId, 400, avatar.shiny)}
        alt=""
        decoding="async"
        width={400}
        height={400}
        className={cn("h-full w-full object-contain drop-shadow-[0_14px_24px_rgba(0,0,0,0.55)]", flip)}
      />
    </div>
  );
}

/** A trainer in a ready stance, as a flat shape: who it is isn't known. */
function Silhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 200" className={className} fill="currentColor" aria-hidden>
      {/* cap */}
      <path d="M38 34c0-15 10-24 24-24s24 9 24 22l9 3c2 1 2 4-1 5H38z" />
      {/* head */}
      <ellipse cx="61" cy="45" rx="19" ry="17" />
      {/* torso and arms, one fist forward */}
      <path d="M36 66c6-5 15-7 25-7s19 2 25 7l14 20c3 5 2 9-2 11l-16 6 4 14H34l3-15-11-9c-4-3-4-8 0-11z" />
      {/* legs apart */}
      <path d="M36 116h50l6 42 9 30c1 4-1 6-5 6H82l-9-38-11-24-10 26-7 36H33c-4 0-6-3-4-6l7-30z" />
    </svg>
  );
}
