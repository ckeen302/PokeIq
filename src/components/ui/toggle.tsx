"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The one tabs / toggle control. The chosen one is a violet outline and tint (the "select" token), never the action
 * pink, so a choice never looks like a button to press. Marked chosen by aria-pressed, aria-selected,
 * aria-current or data-state="on".
 */
const toggleVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-display font-bold uppercase tracking-[0.08em] transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 " +
    "border-transparent text-muted-foreground hover:bg-select/[0.07] hover:text-foreground " +
    "aria-pressed:border-select aria-pressed:bg-select/[0.14] aria-pressed:text-select-ink aria-pressed:shadow-[0_0_0_3px_hsl(var(--select)/0.12)] " +
    "aria-selected:border-select aria-selected:bg-select/[0.14] aria-selected:text-select-ink aria-selected:shadow-[0_0_0_3px_hsl(var(--select)/0.12)] " +
    "aria-[current=page]:border-select aria-[current=page]:bg-select/[0.14] aria-[current=page]:text-select-ink " +
    "data-[state=on]:border-select data-[state=on]:bg-select/[0.14] data-[state=on]:text-select-ink",
  {
    variants: {
      size: {
        sm: "h-8 px-2.5 text-[11px] max-md:h-9",
        default: "h-9 px-3.5 text-xs max-md:h-10",
        lg: "h-11 px-5 text-sm",
      },
    },
    defaultVariants: { size: "default" },
  }
);

/** The row the toggles sit in: a recessed track. */
const toggleGroupClass = "inline-flex flex-wrap items-center gap-1 rounded-xl bg-surface p-1 shadow-[inset_0_0_0_1px_hsl(var(--surface-line)),inset_0_2px_4px_hsl(var(--shade)/0.25)]";

export interface ToggleProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof toggleVariants> {
  pressed: boolean;
}

/** One toggle button (aria-pressed). */
const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(({ className, size, pressed, ...props }, ref) => (
  <button ref={ref} type="button" aria-pressed={pressed} className={cn(toggleVariants({ size }), className)} {...props} />
));
Toggle.displayName = "Toggle";

/** A set of toggles where one is chosen. */
function ToggleGroup<V extends string>({
  value,
  onChange,
  options,
  size,
  label,
  className,
}: {
  value: V;
  onChange: (v: V) => void;
  options: readonly { value: V; label: React.ReactNode }[];
  size?: VariantProps<typeof toggleVariants>["size"];
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn(toggleGroupClass, className)}>
      {options.map((o) => (
        <Toggle key={o.value} pressed={value === o.value} size={size} onClick={() => onChange(o.value)}>
          {o.label}
        </Toggle>
      ))}
    </div>
  );
}

export { Toggle, ToggleGroup, toggleVariants, toggleGroupClass };
