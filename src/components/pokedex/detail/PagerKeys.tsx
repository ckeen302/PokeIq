"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * ← / → go to the previous / next entry. Arrow keys keep their native meaning
 * in form fields, tab lists and horizontally scrolling rows ([data-hscroll]).
 */
export function PagerKeys({ prev, next }: { prev?: string; next?: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!prev && !next) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [contenteditable], [data-hscroll], [role="tablist"], [role="slider"], [role="radiogroup"], [role="listbox"], [role="menu"]')) return;
      const href = e.key === "ArrowLeft" ? prev : next;
      if (!href) return;
      e.preventDefault();
      router.push(href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router]);
  return null;
}
