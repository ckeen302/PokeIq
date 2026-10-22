"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A panel that drops down from a trigger. Put it next to its trigger inside
 * a `relative` wrapper: a click anywhere outside that wrapper, or Escape,
 * calls `onClose` (the trigger itself toggles it).
 */
export function Popover({
  open,
  onClose,
  label,
  align = "center",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The panel's accessible name. */
  label: string;
  align?: "start" | "center" | "end";
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const wrapper = ref.current?.parentElement;
      if (wrapper && !wrapper.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cn(
        "absolute top-full z-40 mt-2 max-h-[75vh] overflow-y-auto rounded-lg border bg-card p-4 text-left text-card-foreground shadow-[0_16px_40px_-12px_hsl(var(--shade)/0.8)]",
        align === "start" && "left-0",
        align === "end" && "right-0",
        align === "center" && "left-1/2 -translate-x-1/2",
        className
      )}
    >
      {children}
    </div>
  );
}
