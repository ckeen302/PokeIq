import { User } from "lucide-react";
import { avatarSrc, type AvatarFrame, type AvatarMap, type PublicAvatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { TrainerPortrait } from "./TrainerPortrait";

/**
 * A trainer's avatar: their 3D trainer's portrait, their approved picture or
 * their Pokémon, in a round frame. Guests and unknown names get a plain
 * trainer icon. Images load lazily; portraits are inline SVG.
 */

const FRAME_RING: Record<AvatarFrame, string> = {
  none: "ring-1 ring-border",
  lv5: "ring-2 ring-[#b07a45]",
  lv15: "ring-2 ring-[#c0c6d0]",
  lv30: "ring-2 ring-[#f2c14e]",
  lv50: "ring-[3px] ring-[#f2c14e] shadow-[0_0_10px_rgba(242,193,78,0.6)]",
  great: "ring-2 ring-[#3b82f6]",
  ultra: "ring-2 ring-[#facc15] outline outline-1 outline-[#1f2937]",
  master: "ring-[3px] ring-[#a855f7] shadow-[0_0_10px_rgba(168,85,247,0.6)]",
};

export function Avatar({ avatar, size = 20, large, className }: { avatar?: PublicAvatar | null; size?: number; large?: boolean; className?: string }) {
  const box = { width: size, height: size };
  if (!avatar) {
    return (
      <span style={box} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border", className)} aria-hidden data-testid="avatar-guest">
        <User style={{ width: size * 0.6, height: size * 0.6 }} />
      </span>
    );
  }
  if (avatar.trainer && !avatar.picture) {
    return (
      <span style={box} className={cn("inline-flex shrink-0 overflow-hidden rounded-full bg-muted", FRAME_RING[avatar.frame], className)} data-testid="avatar" data-avatar={`${avatar.pokemonId}${avatar.shiny ? "s" : ""}`} data-trainer="">
        <TrainerPortrait trainer={avatar.trainer} size={size} className="h-full w-full" />
      </span>
    );
  }
  return (
    <span style={box} className={cn("inline-flex shrink-0 overflow-hidden rounded-full bg-muted", FRAME_RING[avatar.frame], className)} data-testid="avatar" data-avatar={`${avatar.pokemonId}${avatar.shiny ? "s" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatarSrc(avatar, large ?? size > 64)} alt="" loading="lazy" decoding="async" width={size} height={size} className="h-full w-full object-contain" />
    </span>
  );
}

/** The avatar for `name` in a view's avatar map (a guest icon when it isn't an account). */
export function NameAvatar({ name, avatars, size = 20, className }: { name: string | null | undefined; avatars: AvatarMap | undefined; size?: number; className?: string }) {
  return <Avatar avatar={name ? avatars?.[name.toLowerCase()] : null} size={size} className={className} />;
}
