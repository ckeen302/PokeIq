"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import { stageOf, type StageId, type TrainerConfig, type TrainerFacing, type TrainerPose } from "@/lib/trainer/config";
import type { TauntId } from "@/lib/trainer/taunts";
import { cn } from "@/lib/utils";

/**
 * A live 3D trainer (three.js, loaded only when one is on screen): a chibi
 * trainer with their Poké Ball in hand. It fills its box (give the box a
 * size); the trainer stands on the box's floor.
 *
 *   <Avatar3D config={trainer} pose="fight" facing="left" />
 *
 * pose: "idle" (breathing, tossing the ball), "wave", "fight" (battle
 *       stance), "throw" (a throw on a loop), "victory" or "think".
 * facing: "front" (towards the viewer, default), or "left"/"right" (turned
 *       three-quarters that way).
 * stage: true draws the trainer's chosen backdrop behind them (creator and profile).
 * partner: true shows the partner Pokémon sprite beside them (off by default: the flat sprite clashes with the 3D trainer).
 * still: true draws one frame and stops (also the case under reduced motion).
 * taunt: plays a dance or emote once (lib/trainer/taunts); a new `n` plays it
 *       again. Under reduced motion the trainer holds the move's key pose.
 */
export interface Avatar3DProps {
  config: TrainerConfig;
  pose?: TrainerPose;
  facing?: TrainerFacing;
  partner?: boolean;
  still?: boolean;
  taunt?: { id: TauntId; n: number } | null;
  stage?: boolean;
  className?: string;
  /** Accessible name, e.g. "Red's trainer". */
  label?: string;
}

export type Avatar3DSceneProps = Omit<Avatar3DProps, "className" | "label" | "stage">;

const Scene = dynamic(() => import("./Avatar3DScene").then((m) => m.Avatar3DScene), {
  ssr: false,
  loading: () => <div className="absolute inset-x-[30%] bottom-[6%] top-[18%] animate-pulse rounded-full bg-foreground/[0.05]" />,
});

export function Avatar3D({ className, label = "Trainer avatar", stage, ...props }: Avatar3DProps) {
  return (
    <div role="img" aria-label={label} className={cn("relative h-full min-h-0 w-full select-none", className)} data-testid="avatar-3d" data-pose={props.pose ?? "idle"} data-taunt={props.taunt?.id}>
      {stage && <StageBackdrop stage={props.config.stage} />}
      <Scene {...props} />
    </div>
  );
}

/** The CSS for a stage backdrop (null for "plain"). */
export function stageStyle(id: StageId): CSSProperties | null {
  const s = stageOf(id);
  if (s.id === "plain") return null;
  const layers = [`radial-gradient(ellipse 70% 45% at 50% 34%, ${s.glow}b3, transparent 70%)`];
  if (s.pattern === "rays") layers.push(`repeating-conic-gradient(from 0deg at 50% 0%, ${s.glow}1f 0deg 6deg, transparent 6deg 14deg)`);
  if (s.pattern === "stars")
    layers.push(
      "radial-gradient(1.5px 1.5px at 20% 18%, #fff, transparent)",
      "radial-gradient(1px 1px at 70% 12%, #fff, transparent)",
      "radial-gradient(1.5px 1.5px at 84% 40%, #fff, transparent)",
      "radial-gradient(1px 1px at 36% 46%, #fff, transparent)",
      "radial-gradient(1px 1px at 58% 28%, #ffffffaa, transparent)",
      "radial-gradient(1.5px 1.5px at 10% 52%, #ffffffaa, transparent)",
    );
  // The floor: a pool of light where the trainer stands, and gym lines.
  layers.push(`radial-gradient(ellipse 46% 9% at 50% 91%, ${s.glow}66, transparent 70%)`);
  if (s.pattern === "gym") layers.push("repeating-linear-gradient(90deg, transparent 0 11%, #00000014 11% 11.6%)");
  layers.push(`linear-gradient(to bottom, ${s.sky} 0%, ${s.sky} 44%, ${s.glow} 69.5%, ${s.ground} 70%, ${s.ground} 100%)`);
  return { background: layers.join(", ") };
}

export function StageBackdrop({ stage, className }: { stage: StageId; className?: string }) {
  const style = stageStyle(stage);
  if (!style) return null;
  return <div aria-hidden className={cn("absolute inset-0", className)} style={style} data-testid="trainer-stage-backdrop" data-stage={stage} />;
}

export type { TrainerConfig, TrainerFacing, TrainerPose };
