"use client";

import { ArrowRight } from "lucide-react";

/**
 * The banner's one thing to press: down to Today on this page. A plain link
 * to #home-today (so it works before the page's script runs); once it has,
 * the press glides there instead of jumping (a jump with reduced motion) and
 * lands on Today's section, under the sticky header.
 */
export function PlayTodayLink({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <a
      href="#home-today"
      data-testid="home-hero-play"
      className={className}
      onClick={(e) => {
        const heading = document.getElementById("home-today");
        if (!heading || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // The section, not its heading: the section's scroll margin clears the header.
        (heading.closest("section") ?? heading).scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
        // Keyboard and screen reader users carry on from Today, as they would after a jump.
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }}
    >
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
    </a>
  );
}
