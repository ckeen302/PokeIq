"use client";

import { useEffect, useRef, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { cn } from "@/lib/utils";

export interface ShowcaseSlide {
  image: StaticImageData;
  /** Where the place is on the world map (0–1 across and down). */
  pin: [number, number] | null;
}

const SLIDE_MS = 4200;

/**
 * PokéGuessr in one glance on the title screen: a real in-game view per
 * region, and a pin dropping where it is on the world map. Only the first
 * view loads with the page (it's the hero image); the rest load once the page
 * has settled, and the cycle pauses off screen, in a background tab and for
 * reduced motion.
 */
export function GuessrShowcase({ slides, map, className }: { slides: ShowcaseSlide[]; map: { src: string; width: number; height: number }; className?: string }) {
  const [index, setIndex] = useState(0);
  const [armed, setArmed] = useState(false);
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set([0]));
  const root = useRef<HTMLDivElement>(null);
  const visible = useRef(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const node = root.current;
    const observer = node
      ? new IntersectionObserver(([entry]) => {
          visible.current = entry.isIntersecting;
        })
      : null;
    if (node) observer?.observe(node);
    const arm = window.setTimeout(() => setArmed(true), 1800);
    return () => {
      observer?.disconnect();
      window.clearTimeout(arm);
    };
  }, []);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setInterval(() => {
      if (document.hidden || !visible.current) return;
      setIndex((i) => {
        // The next view that has finished loading (a slow one is skipped this time round).
        for (let step = 1; step < slides.length; step++) {
          const next = (i + step) % slides.length;
          if (loaded.has(next)) return next;
        }
        return i;
      });
    }, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [armed, loaded, slides.length]);

  const pin = slides[index].pin;

  return (
    <div ref={root} className={cn("pointer-events-none select-none", className)} aria-hidden>
      {slides.map((slide, i) =>
        i === 0 || armed ? (
          <Image
            key={i}
            src={slide.image}
            alt=""
            priority={i === 0}
            sizes="(min-width: 1024px) 760px, 100vw"
            placeholder={i === 0 ? "blur" : "empty"}
            onLoad={() => setLoaded((s) => (s.has(i) ? s : new Set(s).add(i)))}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-[opacity,transform] ease-out motion-reduce:transition-none",
              i === index ? "scale-[1.06] opacity-100" : "scale-100 opacity-0"
            )}
            style={{ transitionDuration: `900ms, ${SLIDE_MS + 900}ms` }}
          />
        ) : null
      )}

      {/* The world map, with a pin where this view is. */}
      <div className="absolute right-3 top-3 z-[2] w-[34%] max-w-[200px] overflow-hidden rounded-md border border-white/25 bg-[hsl(214_70%_28%)] shadow-[0_8px_24px_rgb(0_0_0/0.45)] lg:bottom-5 lg:right-5 lg:top-auto lg:w-[30%]">
        <div className="relative" style={{ aspectRatio: `${map.width} / ${map.height}` }}>
          <Image src={map.src} alt="" width={map.width} height={map.height} sizes="200px" className="h-full w-full opacity-90" />
          {pin && (
            <span key={index} className="absolute" style={{ left: `${pin[0] * 100}%`, top: `${pin[1] * 100}%` }}>
              <span className="absolute -left-2 -top-2 h-4 w-4 animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
              <svg viewBox="0 0 24 32" className="geo-drop absolute -left-[7px] -top-[19px] h-5 w-[14px] drop-shadow-[0_2px_2px_rgb(0_0_0/0.6)]">
                <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0z" fill="hsl(340 86% 60%)" stroke="#fff" strokeWidth="2" />
                <circle cx="12" cy="11.5" r="4" fill="#fff" />
              </svg>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
