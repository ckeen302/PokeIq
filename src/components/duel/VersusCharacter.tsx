"use client";

import { useEffect, useState } from "react";
import { pictureSrc, type PublicAvatar } from "@/lib/avatar";
import { artUrl } from "@/lib/pokemon/art";
import { cn } from "@/lib/utils";
import { Avatar3D } from "@/components/trainer3d/Avatar3D";
import type { TrainerConfig, TrainerPose } from "@/lib/trainer/config";
import type { TauntId } from "@/lib/trainer/taunts";

/**
 * A trainer's character on the versus screen, facing their opponent.
 *
 * Their 3D trainer in a battle stance when they made one; otherwise their
 * profile avatar drawn large (the Pokémon's official art, or their approved
 * picture in a round frame). Guests and unknown trainers get a silhouette.
 *
 * With `paintWithin`, a 3D trainer that isn't on screen in that many ms (a
 * weak GPU, no WebGL, a lost context) gives way to the flat version for good:
 * their profile art or picture, else `flat` (e.g. their lead Pokémon's art),
 * else the silhouette. Never an empty spot.
 */

export type VersusFacing = "left" | "right";

export interface VersusCharacterProps {
  avatar?: PublicAvatar | null;
  /** The side they face: the left trainer faces right, toward the right one. */
  facing: VersusFacing;
  /** A computer opponent's own figure (the Gym Leader), drawn in place of an avatar. */
  figure?: React.ReactNode;
  className?: string;
  /** The 3D trainer's pose (default: battle stance). */
  pose?: TrainerPose;
  /** A dance or emote to play (post-game taunts). */
  taunt?: { id: TauntId; n: number } | null;
  /** A 3D trainer to show when they haven't made one (so everyone can taunt), in place of the art or silhouette. */
  fallback?: TrainerConfig;
  /** Give up on the 3D trainer if it hasn't drawn in this many ms (see above). */
  paintWithin?: number;
  /** Drawn when the 3D trainer gives way and they have no profile avatar (see `PokemonArt`). */
  flat?: React.ReactNode;
  /** Draw the 3D trainer on the page's shared WebGL context (Avatar3D's `shared`). */
  shared?: boolean;
}

export function VersusCharacter({ avatar, facing, figure, className, pose = "fight", taunt, fallback, paintWithin, flat, shared }: VersusCharacterProps) {
  // Official art mostly faces the viewer's left: mirrored for the trainer who faces right.
  const flip = facing === "right" ? "-scale-x-100" : "";
  const box = cn("relative flex aspect-square items-end justify-center", className);
  // undefined: waiting on the first frame; true: on screen; false: gave way to the flat version.
  const [drawn, setDrawn] = useState<boolean | undefined>(undefined);
  const watching = paintWithin !== undefined && !figure && !!(avatar?.trainer ?? fallback);
  useEffect(() => {
    if (!watching || drawn !== undefined) return;
    const id = window.setTimeout(() => setDrawn((d) => d ?? false), paintWithin);
    return () => window.clearTimeout(id);
  }, [watching, drawn, paintWithin]);
  if (figure) {
    return (
      <div className={box} data-testid="versus-character" data-kind="figure">
        <div className="flex h-full w-full items-center justify-center">{figure}</div>
      </div>
    );
  }
  const trainer = avatar?.trainer ?? fallback;
  const look = flatLook(avatar, flat, facing, flip);
  if (trainer && !figure && drawn !== false) {
    return (
      <div className={box} data-testid="versus-character" data-kind="trainer" data-painted={watching ? (drawn ? "1" : "0") : undefined}>
        {/* Until the trainer's first frame: the flat look fades in under it after paintWithin. It runs on the
            compositor, so it shows even while the GPU work holds up the page (where a timer couldn't fire). */}
        {watching && !drawn && (
          <div
            aria-hidden
            className="absolute inset-0 flex items-end justify-center animate-in fade-in fill-mode-both"
            style={{ animationDelay: `${paintWithin}ms`, animationDuration: "250ms" }}
            data-testid="versus-flat-underlay"
          >
            {look.node}
          </div>
        )}
        <Avatar3D
          config={trainer}
          pose={pose}
          taunt={taunt}
          facing={facing}
          shared={shared}
          label={pose === "fight" ? "Trainer, ready to battle" : "Trainer"}
          onPaint={watching ? () => setDrawn((d) => d ?? true) : undefined}
          onFail={watching ? () => setDrawn(false) : undefined}
        />
      </div>
    );
  }
  return (
    <div className={box} data-testid="versus-character" data-kind={look.kind} data-avatar={look.kind === "art" && avatar ? `${avatar.pokemonId}${avatar.shiny ? "s" : ""}` : undefined}>
      {look.node}
    </div>
  );
}

/** Them without a 3D trainer: their approved picture, their avatar's art, the stand-in (`flat`), else a silhouette. */
function flatLook(avatar: PublicAvatar | null | undefined, flat: React.ReactNode, facing: VersusFacing, flip: string): { kind: string; node: React.ReactNode } {
  if (avatar?.picture) {
    return {
      kind: "picture",
      // eslint-disable-next-line @next/next/no-img-element
      node: <img src={pictureSrc(avatar.picture, true)} alt="" decoding="async" className="aspect-square w-[78%] self-center rounded-full object-cover ring-4 ring-white/70 shadow-2xl" />,
    };
  }
  if (avatar?.pokemonId) return { kind: "art", node: <PokemonArt id={avatar.pokemonId} shiny={avatar.shiny} facing={facing} /> };
  if (flat) return { kind: "flat", node: flat };
  return { kind: "silhouette", node: <Silhouette className={cn("h-[92%] w-auto text-black/55 drop-shadow-[0_0_18px_rgba(169,156,255,0.35)]", flip)} /> };
}

/** A Pokémon's official art, drawn as a versus character (mirrored to face the other side); the silhouette if it won't load. */
export function PokemonArt({ id, shiny, facing }: { id: number; shiny?: boolean; facing: VersusFacing }) {
  const [broken, setBroken] = useState(false);
  const flip = facing === "right" ? "-scale-x-100" : "";
  if (broken) return <Silhouette className={cn("h-[92%] w-auto text-black/55 drop-shadow-[0_0_18px_rgba(169,156,255,0.35)]", flip)} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={artUrl(id, 400, shiny)}
      alt=""
      decoding="async"
      width={400}
      height={400}
      data-testid="versus-art"
      onError={() => setBroken(true)}
      className={cn("h-full w-full object-contain drop-shadow-[0_14px_24px_rgba(0,0,0,0.55)]", flip)}
    />
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
