import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * A selected chip or tab: a violet outline and tint. Solid pink is kept for primary actions.
 * (The violet is written out: tailwind-merge takes "border-screen" for a border width and would drop the chip's "border".)
 */
export const SELECTED_CHIP = "border-[hsl(var(--screen))] bg-screen/15 text-foreground";
/** The same for a segment of a segmented control, whose segments have no border (an inset ring instead). */
export const SELECTED_SEGMENT = "bg-screen/15 text-foreground ring-1 ring-inset ring-[hsl(var(--screen))]";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-1 font-pixel text-[10px] uppercase leading-none tracking-wider transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        success: "border-transparent bg-success text-success-foreground",
        outline: "border-border text-foreground",
        selected: SELECTED_CHIP,
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
