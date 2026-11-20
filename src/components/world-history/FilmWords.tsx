"use client";

import { motion, useIsPresent, usePresenceData, type Variants } from "framer-motion";

/**
 * The words over the films (captions, title cards, the prologue and the end
 * card), shared by World History and The Story of Pokémon. Each one fades in
 * as the picture reaches it. On the film's own progression the old words
 * fade out under the new ones (a crossfade); after a jump (a chapter from
 * the list, a caption skipped to, a click on the timeline, the address) the
 * old ones are gone at once, so the words on screen are always the part the
 * picture shows. Words on their way out are hidden from assistive tech and
 * carry a "-out" test id, so checks read only the words that are current.
 */

const EASE = [0.2, 0.8, 0.2, 1] as const;
const OUT = [0.4, 0, 1, 1] as const;
/** Gone at once (after a jump). */
const CUT = { opacity: 0, transition: { duration: 0 } };

/** Only opacity and transform on the captions: they change every few seconds, and blur repaints are costly on phones. */
export const WORD_MOTION: Record<"caption" | "title" | "prologue" | "end", Variants> = {
  caption: {
    hidden: { opacity: 0, y: 14 },
    // A jump's caption comes up with its picture; on the film's own run it follows the old one out.
    shown: (jumped: boolean) => ({ opacity: 1, y: 0, transition: { duration: jumped ? 0.4 : 0.55, ease: EASE, delay: jumped ? 0 : 0.14 } }),
    gone: (jumped: boolean) => (jumped ? CUT : { opacity: 0, y: -8, transition: { duration: 0.3, ease: OUT } }),
  },
  title: {
    hidden: { opacity: 0, scale: 1.04 },
    shown: { opacity: 1, scale: 1, transition: { duration: 0.8, ease: EASE } },
    gone: (jumped: boolean) => (jumped ? CUT : { opacity: 0, y: -14, filter: "blur(6px)", transition: { duration: 0.7, ease: EASE } }),
  },
  prologue: {
    hidden: { opacity: 0, y: 12 },
    shown: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE } },
    gone: (jumped: boolean) => (jumped ? CUT : { opacity: 0, scale: 0.97, filter: "blur(6px)", transition: { duration: 0.8, ease: EASE } }),
  },
  end: {
    hidden: { opacity: 0, y: 14 },
    shown: { opacity: 1, y: 0, transition: { duration: 1, ease: EASE } },
    gone: (jumped: boolean) => (jumped ? CUT : { opacity: 0, transition: { duration: 0.6 } }),
  },
};

interface Props {
  kind: keyof typeof WORD_MOTION;
  /** Whether these words came by a jump (and so whether the words before them go at once). */
  jumped: boolean;
  testId: string;
  as?: "div" | "figure";
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/** One set of words: a direct child of an AnimatePresence whose `custom` is the same `jumped`. */
export function FilmWords({ kind, jumped, testId, as = "div", className, style, children }: Props) {
  const present = useIsPresent();
  const exitJumped = usePresenceData() === true;
  // On the way out after a jump: hidden in the same commit that brings the new words, so the old ones never share a painted frame with the new picture.
  const cut = !present && exitJumped;
  const M = as === "figure" ? motion.figure : motion.div;
  return (
    <M
      className={className}
      style={cut ? { ...style, visibility: "hidden" } : style}
      variants={WORD_MOTION[kind]}
      custom={jumped}
      initial="hidden"
      animate="shown"
      exit="gone"
      data-testid={present ? testId : `${testId}-out`}
      aria-hidden={present ? undefined : true}
    >
      {children}
    </M>
  );
}
