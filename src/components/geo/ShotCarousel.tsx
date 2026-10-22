"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { stepView, viewKeyStep, viewLabel } from "@/lib/geo-look";
import { cn } from "@/lib/utils";

/**
 * How a screenshot fills the frame: wide 3D captures fill it (just past the
 * light frame on Let's Go's), anything else fits inside; small pixel art is
 * scaled up without blurring.
 */
export function shotFit(img: HTMLImageElement): { className: string; pixelated: boolean } {
  const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
  return { className: ratio >= 1.6 && ratio <= 1.85 ? "scale-[1.07] object-cover" : "object-contain", pixelated: img.naturalWidth <= 512 };
}

type Fit = ReturnType<typeof shotFit>;

/**
 * Look around: a round's screenshots as a flip-through, like moving in Street
 * View: arrows on the picture, ← / → on the keyboard, and thumbnails below.
 * A place with one screenshot shows just that one, with no controls.
 */
export function ShotCarousel({
  views,
  index,
  onIndex,
  onZoom,
  zoom,
}: {
  views: string[];
  index: number;
  onIndex: (index: number) => void;
  onZoom: () => void;
  /** The Zoomed setting: blow each view up around a point of it (percentages), so only a close-up shows. */
  zoom?: (src: string) => { scale: number; origin: [number, number] } | null;
}) {
  const [fits, setFits] = useState<Record<string, Fit>>({});
  const count = views.length;
  const src = views[Math.min(index, count - 1)];
  const fit = fits[src];
  const many = count > 1;
  const zoomStyle = (v: string) => {
    const z = zoom?.(v);
    return z ? { transform: `scale(${z.scale})`, transformOrigin: `${z.origin[0]}% ${z.origin[1]}%` } : {};
  };
  const imgRef = useRef<HTMLImageElement>(null);
  const measure = (img: HTMLImageElement) => {
    const f = shotFit(img);
    setFits((all) => (all[img.getAttribute("src") ?? ""] ? all : { ...all, [img.getAttribute("src") ?? ""]: f }));
  };

  // A view already in the cache can finish loading before its load event is listened for.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) measure(img);
  }, [src]);

  // ← / → flip through the views (not while typing, or with a modifier held).
  useEffect(() => {
    if (!many) return;
    const onKey = (e: KeyboardEvent) => {
      const step = viewKeyStep(e.key);
      if (step === null || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      e.preventDefault();
      onIndex(stepView(index, step, count));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [many, index, count, onIndex]);

  // The other views load in the background, so flipping is instant.
  useEffect(() => {
    for (const v of views) if (v !== src) new window.Image().src = v;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per round
  }, [views]);

  const arrow = "absolute top-1/2 z-[3] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-screen";

  return (
    <div>
      <div className="screen relative aspect-[16/9] w-full overflow-hidden rounded-lg" aria-roledescription={many ? "carousel" : undefined}>
        {!fit && <div className="absolute inset-0 animate-pulse bg-foreground/5" aria-hidden />}
        {/* eslint-disable-next-line @next/next/no-img-element -- server-proxied, CDN-cached screenshot */}
        <img
          key={src}
          src={src}
          alt="Where is this?"
          ref={imgRef}
          onLoad={(e) => measure(e.currentTarget)}
          className={cn("absolute inset-0 h-full w-full transition-opacity duration-300", fit?.className ?? "object-contain", fit ? "opacity-100" : "opacity-0")}
          style={{ imageRendering: fit?.pixelated ? "pixelated" : "auto", ...zoomStyle(src) }}
          data-testid="geo-shot"
          data-zoomed={zoom?.(src) ? "true" : undefined}
        />
        <button
          type="button"
          onClick={onZoom}
          className="absolute left-3 top-3 z-[3] flex h-9 w-9 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
          aria-label="View the screenshot full screen"
          title="Full screen"
        >
          <Expand className="h-4 w-4" />
        </button>
        {many && (
          <>
            <button type="button" className={cn(arrow, "left-3")} onClick={() => onIndex(stepView(index, -1, count))} aria-label="Previous view" title="Previous view (←)">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" className={cn(arrow, "right-3")} onClick={() => onIndex(stepView(index, 1, count))} aria-label="Next view" title="Next view (→)">
              <ChevronRight className="h-6 w-6" />
            </button>
            <div className="hud-label absolute right-3 top-3 z-[3] rounded-md bg-black/55 px-2 py-1 tabular-nums text-white backdrop-blur" aria-live="polite" data-testid="geo-view-count">
              {index + 1} / {count}
            </div>
          </>
        )}
        {many && (
          <div className="absolute bottom-3 left-3 z-[3] flex max-w-[calc(100%-1.5rem)] gap-1.5 overflow-x-auto rounded-md bg-black/40 p-1 backdrop-blur lg:max-w-[calc(100%-27rem)]" role="tablist" aria-label="Views of this place">
            {views.map((v, i) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={viewLabel(i, count)}
                onClick={() => onIndex(i)}
                className={cn(
                  "relative h-9 w-14 shrink-0 overflow-hidden rounded border-2 bg-shade/30 transition-[border-color,opacity] sm:h-12 sm:w-20",
                  i === index ? "border-screen opacity-100" : "border-transparent opacity-60 hover:opacity-100"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- same cached screenshot, as a thumbnail */}
                <img src={v} alt="" className="h-full w-full object-cover" style={{ imageRendering: fits[v]?.pixelated ? "pixelated" : "auto", ...zoomStyle(v) }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
