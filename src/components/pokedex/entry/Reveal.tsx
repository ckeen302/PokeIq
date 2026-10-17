"use client";

import { motion } from "framer-motion";
import { HudHeading } from "@/components/game/HudHeading";

/** Fades/slides content in as it scrolls into view (once). */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
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
