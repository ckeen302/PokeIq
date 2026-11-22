"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The maker's drag and drop: pointer events, one floating ghost moved with a transform (60fps however many tiles are
 * on screen), drop zones found under the pointer by [data-drop], and the insertion point between the zone's tiles
 * ([data-tile], in reading order). A mouse drags after a few pixels; a finger after a short press (a quick swipe still
 * scrolls, and a tap stays a tap for tap-then-tap placement). Near the top or bottom of a scrolling panel
 * ([data-scroll]) the panel scrolls along.
 */

export interface DragStart {
  keys: string[];
  from: string;
  /** The image the ghost shows. */
  src: string;
  pixel: boolean;
  size: number;
}

export interface DropAt {
  zone: string;
  index: number;
}

interface Options {
  begin(key: string, from: string, el: HTMLElement): DragStart | null;
  drop(drag: DragStart, at: DropAt): void;
  /** Called as the drag starts and ends (the board can mark what's moving). */
  onActive?(drag: DragStart | null): void;
}

const LONG_PRESS = 220;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 4;
const EDGE = 56;

function zoneAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return (el?.closest("[data-drop]") as HTMLElement | null) ?? null;
}

/** Where in the zone's tiles the pointer is: the index to insert at, and where to draw the marker. */
function insertionAt(zone: HTMLElement, x: number, y: number) {
  const tiles = [...zone.querySelectorAll<HTMLElement>("[data-tile]")].filter((t) => t.closest("[data-drop]") === zone);
  let marker: { left: number; top: number; height: number } | null = null;
  for (let i = 0; i < tiles.length; i++) {
    const r = tiles[i].getBoundingClientRect();
    if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return { index: i, marker: { left: r.left - 3, top: r.top, height: r.height } };
    marker = { left: r.right + 1, top: r.top, height: r.height };
  }
  if (!marker) {
    const r = zone.getBoundingClientRect();
    marker = { left: r.left + 10, top: r.top + 8, height: Math.max(24, Math.min(r.height - 16, 72)) };
  }
  return { index: tiles.length, marker };
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  return (el?.closest("[data-scroll]") as HTMLElement | null) ?? null;
}

export function useDragDrop({ begin, drop, onActive }: Options) {
  const opts = useRef({ begin, drop, onActive });
  opts.current = { begin, drop, onActive };
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>, key: string, from: string) => {
    if (e.button !== 0 || cleanup.current) return;
    const el = e.currentTarget;
    const touch = e.pointerType === "touch";
    const sx = e.clientX, sy = e.clientY;
    let x = sx, y = sy;
    let drag: DragStart | null = null;
    let ghost: HTMLDivElement | null = null;
    let marker: HTMLDivElement | null = null;
    let zoneEl: HTMLElement | null = null;
    let raf = 0;
    let offX = 0, offY = 0;
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let lastAt: DropAt | null = null;

    const start = () => {
      drag = opts.current.begin(key, from, el);
      if (!drag) return end(false);
      const r = el.getBoundingClientRect();
      offX = Math.min(r.width / 2, sx - r.left);
      offY = Math.min(r.height / 2, sy - r.top);
      ghost = document.createElement("div");
      ghost.className = "tlm-ghost";
      ghost.style.width = ghost.style.height = `${drag.size}px`;
      const img = document.createElement("img");
      img.src = drag.src;
      img.alt = "";
      img.draggable = false;
      if (drag.pixel) img.style.imageRendering = "pixelated";
      ghost.appendChild(img);
      if (drag.keys.length > 1) {
        const badge = document.createElement("span");
        badge.className = "tlm-ghost-count";
        badge.textContent = String(drag.keys.length);
        ghost.appendChild(badge);
      }
      document.body.appendChild(ghost);
      marker = document.createElement("div");
      marker.className = "tlm-marker";
      document.body.appendChild(marker);
      document.documentElement.classList.add("tlm-dragging");
      if (touch && navigator.vibrate) navigator.vibrate(8);
      opts.current.onActive?.(drag);
      frame();
    };

    const frame = () => {
      raf = 0;
      if (!drag || !ghost || !marker) return;
      ghost.style.transform = `translate3d(${x - offX}px, ${y - offY}px, 0) scale(1.06)`;
      const zone = zoneAt(x, y);
      if (zone !== zoneEl) {
        zoneEl?.classList.remove("tlm-over");
        zone?.classList.add("tlm-over");
        zoneEl = zone;
      }
      lastAt = null;
      marker.style.opacity = "0";
      if (zone) {
        const name = zone.dataset.drop!;
        if (zone.dataset.dropKind === "list") {
          const { index, marker: m } = insertionAt(zone, x, y);
          lastAt = { zone: name, index };
          if (m) {
            marker.style.opacity = "1";
            marker.style.transform = `translate3d(${m.left}px, ${m.top}px, 0)`;
            marker.style.height = `${m.height}px`;
          }
        } else lastAt = { zone: name, index: -1 };
      }
      // Scroll the panel under the pointer when it's near the panel's top or bottom edge.
      const sc = scrollParent(zone ?? (document.elementFromPoint(x, y) as HTMLElement | null));
      if (sc) {
        const r = sc.getBoundingClientRect();
        const dy = y < r.top + EDGE ? -(r.top + EDGE - y) : y > r.bottom - EDGE ? y - (r.bottom - EDGE) : 0;
        if (dy) {
          sc.scrollTop += Math.max(-24, Math.min(24, dy / 2.5));
          raf = requestAnimationFrame(frame);
        }
      }
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      if (!drag) {
        const d = Math.hypot(x - sx, y - sy);
        if (touch) {
          if (d > TOUCH_SLOP) end(false);
        } else if (d > MOUSE_SLOP) start();
        return;
      }
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      end(true);
    };
    const cancel = () => end(false);
    const touchmove = (ev: TouchEvent) => {
      if (drag) ev.preventDefault();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") end(false);
    };

    function end(commit: boolean) {
      if (pressTimer) clearTimeout(pressTimer);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("touchmove", touchmove);
      window.removeEventListener("keydown", onKey, true);
      cleanup.current = null;
      if (drag) {
        if (commit) {
          frame();
          if (lastAt) opts.current.drop(drag, lastAt);
        }
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        ghost?.remove();
        marker?.remove();
        zoneEl?.classList.remove("tlm-over");
        document.documentElement.classList.remove("tlm-dragging");
        opts.current.onActive?.(null);
      }
      drag = null;
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("touchmove", touchmove, { passive: false });
    window.addEventListener("keydown", onKey, true);
    cleanup.current = () => end(false);
    if (touch) pressTimer = setTimeout(start, LONG_PRESS);
  }, []);

  /** Whether a click that just happened ended a drag (and should be ignored). */
  const wasDrag = useCallback(() => suppressClick.current, []);

  return { onPointerDown, wasDrag };
}
