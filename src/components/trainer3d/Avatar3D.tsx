"use client";

import dynamic from "next/dynamic";
import type { TrainerConfig, TrainerFacing, TrainerPose } from "@/lib/trainer/config";
import { cn } from "@/lib/utils";

/**
 * A live 3D trainer (three.js, loaded only when one is on screen): a chibi
 * trainer with their Poké Ball in hand and their partner Pokémon beside
 * them. It fills its box (give the box a size); the trainer stands on the
 * box's floor.
 *
 *   <Avatar3D config={trainer} pose="fight" facing="left" />
 *
 * pose: "idle" (breathing, tossing the ball), "wave", or "fight" (battle
 *       stance, ball ready to throw).
 * facing: "front" (towards the viewer, default), or "left"/"right" (turned
 *       three-quarters that way; the partner stands on that side).
 * partner: false hides the partner Pokémon.
 * still: true draws one frame and stops (also the case under reduced motion).
 */
export interface Avatar3DProps {
  config: TrainerConfig;
  pose?: TrainerPose;
  facing?: TrainerFacing;
  partner?: boolean;
  still?: boolean;
  className?: string;
  /** Accessible name, e.g. "Red's trainer". */
  label?: string;
}

export type Avatar3DSceneProps = Omit<Avatar3DProps, "className" | "label">;

const Scene = dynamic(() => import("./Avatar3DScene").then((m) => m.Avatar3DScene), {
  ssr: false,
  loading: () => <div className="absolute inset-x-[30%] bottom-[6%] top-[18%] animate-pulse rounded-full bg-foreground/[0.05]" />,
});

export function Avatar3D({ className, label = "Trainer avatar", ...props }: Avatar3DProps) {
  return (
    <div role="img" aria-label={label} className={cn("relative h-full min-h-0 w-full select-none", className)} data-testid="avatar-3d" data-pose={props.pose ?? "idle"}>
      <Scene {...props} />
    </div>
  );
}

export type { TrainerConfig, TrainerFacing, TrainerPose };
