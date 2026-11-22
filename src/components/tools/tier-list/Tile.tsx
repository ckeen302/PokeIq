"use client";

/* eslint-disable @next/next/no-img-element -- hundreds of small remote pictures, drawn as they are */
import { memo } from "react";
import { cn } from "@/lib/utils";
import { artUrl, isPixelUrl, SPRITE_HOST, type ArtStyle } from "@/lib/tier-list/art";
import type { Mon } from "@/lib/tier-list/types";

export interface TileProps {
  mon: Mon;
  art: ArtStyle;
  shiny: boolean;
  size: number;
  from: string;
  selected?: boolean;
  moving?: boolean;
  names?: boolean;
  /** Absolute position (the virtualised pool). */
  style?: React.CSSProperties;
  onPointerDown?(e: React.PointerEvent<HTMLElement>, key: string, from: string): void;
  onClick?(e: React.MouseEvent<HTMLElement>, key: string, from: string): void;
  onDoubleClick?(key: string, from: string): void;
  onKeyDown?(e: React.KeyboardEvent<HTMLElement>, key: string, from: string): void;
}

/** A picture that didn't load: the HOME render, then the plain sprite (each tried once). */
function fallback(img: HTMLImageElement, mon: Mon) {
  const tries = [`${SPRITE_HOST}/other/home/${mon.a}.png`, `${SPRITE_HOST}/${mon.a}.png`];
  const next = tries.find((u) => !img.dataset.tried?.includes(u) && img.src !== u);
  if (!next) return;
  img.dataset.tried = `${img.dataset.tried ?? ""} ${next}`;
  img.src = next;
}

/** One Pokémon: its picture, uncropped, in a rounded well. Selected tiles glow; a tile being dragged fades. */
export const Tile = memo(function Tile({ mon, art, shiny, size, from, selected, moving, names, style, onPointerDown, onClick, onDoubleClick, onKeyDown }: TileProps) {
  const src = artUrl(mon, art, shiny);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={mon.n}
      aria-pressed={selected ? true : false}
      title={mon.n}
      data-tile={mon.k}
      data-selected={selected ? "true" : undefined}
      data-moving={moving ? "true" : undefined}
      className={cn("tlm-tile", isPixelUrl(src) && "tlm-px", names && "tlm-named")}
      style={{ width: size, height: size, ...style }}
      onPointerDown={onPointerDown && ((e) => onPointerDown(e, mon.k, from))}
      onClick={onClick && ((e) => onClick(e, mon.k, from))}
      onDoubleClick={onDoubleClick && (() => onDoubleClick(mon.k, from))}
      onKeyDown={onKeyDown && ((e) => onKeyDown(e, mon.k, from))}
      onContextMenu={(e) => (e.nativeEvent as PointerEvent).pointerType === "touch" && e.preventDefault()}
    >
      <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} onError={(e) => fallback(e.currentTarget, mon)} />
      {names && <span className="tlm-name">{mon.n}</span>}
    </div>
  );
});
