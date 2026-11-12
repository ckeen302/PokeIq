"use client";

import { motion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";
import { HudHeading } from "@/components/game/HudHeading";

const EASE = [0.21, 0.47, 0.32, 0.98] as const;

/**
 * Fades/slides content in as it scrolls into view (once). The page's HTML has
 * it visible, so a slow phone shows the content before the scripts arrive;
 * once they do, only what is still below the screen is hidden, to slide in
 * when it's scrolled to.
 */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    if (ref.current && ref.current.getBoundingClientRect().top > window.innerHeight) setBelow(true);
  }, []);
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={false}
      animate={below ? { opacity: 0, y: 28, transition: { duration: 0 } } : { opacity: 1, y: 0 }}
      whileInView={below ? { opacity: 1, y: 0, transition: { duration: 0.55, delay, ease: EASE } } : undefined}
      viewport={{ once: true, margin: "-60px" }}
    >
      {children}
    </motion.div>
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
