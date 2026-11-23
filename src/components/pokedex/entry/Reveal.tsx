"use client";

import { useLayoutEffect, useRef } from "react";
import { HudHeading } from "@/components/game/HudHeading";

const EASE = "cubic-bezier(0.21, 0.47, 0.32, 0.98)";
const HIDDEN = { opacity: "0", transform: "translateY(28px)" };

/**
 * Fades/slides content in as it scrolls into view (once). The page's HTML has
 * it visible, so a slow phone shows the content before the scripts arrive;
 * once they do, only what is still below the screen is hidden, to slide in
 * when it's scrolled to (60 px into the screen, over 0.55 s).
 *
 * Plain DOM (an IntersectionObserver and the Web Animations API) rather than an
 * animation library: these sections are on every move, item, ability, place
 * and type page, which otherwise need no animation code.
 */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el.getBoundingClientRect().top <= window.innerHeight || typeof IntersectionObserver !== "function") return;
    Object.assign(el.style, HIDDEN);
    let anim: Animation | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const show = () => {
          el.style.opacity = "";
          el.style.transform = "";
        };
        if (typeof el.animate !== "function") return show();
        anim = el.animate([HIDDEN, { opacity: "1", transform: "none" }], { duration: 550, delay: delay * 1000, easing: EASE, fill: "backwards" });
        show();
      },
      { rootMargin: "-60px" }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      anim?.cancel();
    };
  }, [delay]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

export function Section({
  id,
  index,
  title,
  subtitle,
  children,
}: {
  id: string;
  index?: number;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-32 space-y-4" aria-labelledby={`${id}-title`}>
      <Reveal>
        <HudHeading index={index} title={title} aside={subtitle} />
        <span id={`${id}-title`} className="sr-only">
          {title}
        </span>
      </Reveal>
      <Reveal delay={0.05}>{children}</Reveal>
    </section>
  );
}
