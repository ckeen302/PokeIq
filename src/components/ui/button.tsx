import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The one button set: chunky game-console buttons in the display face, capitals, a hard bottom shadow that
 * compresses on press. `default` (primary) is the pink, for a screen's one main action; `secondary` is the quiet
 * raised one beside it; `ghost` a bare one; `success` the green, only to confirm or say something worked.
 */
const baseButtonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-display text-sm font-bold uppercase tracking-[0.08em] transition-[transform,box-shadow,filter,background-color,border-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-[2px] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] hover:brightness-110 active:shadow-[0_2px_0_hsl(var(--primary-shadow))]",
        primary:
          "bg-primary text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] hover:brightness-110 active:shadow-[0_2px_0_hsl(var(--primary-shadow))]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_4px_0_hsl(0_70%_32%)] hover:brightness-110 active:shadow-[0_2px_0_hsl(0_70%_32%)]",
        outline:
          "border border-border bg-card text-foreground shadow-[0_3px_0_hsl(var(--border))] hover:border-screen/60 hover:text-foreground active:shadow-[0_1px_0_hsl(var(--border))]",
        secondary:
          "bg-surface-raised text-foreground shadow-[inset_0_0_0_1px_hsl(var(--surface-line)),inset_0_1px_0_rgb(255_255_255/var(--sheen)),0_3px_0_hsl(var(--surface-line))] hover:shadow-[inset_0_0_0_1px_hsl(var(--select)/0.6),inset_0_1px_0_rgb(255_255_255/var(--sheen)),0_3px_0_hsl(var(--select)/0.45)] active:shadow-[inset_0_0_0_1px_hsl(var(--surface-line)),0_1px_0_hsl(var(--surface-line))]",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground active:translate-y-0",
        success:
          "bg-success text-success-foreground shadow-[0_4px_0_hsl(154_60%_24%)] hover:brightness-110 active:shadow-[0_2px_0_hsl(154_60%_24%)]",
      },
      size: {
        default: "h-10 px-4 max-md:h-11",
        sm: "h-9 px-3 text-xs max-md:h-10",
        lg: "h-12 px-7 text-[15px]",
        xl: "h-14 px-8 text-lg tracking-[0.1em]",
        icon: "h-10 w-10 max-md:h-11 max-md:w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

/** Phones get thumb-sized buttons (44px, 40px small), unless the caller set its own height. */
function phoneSize(classes: string, className?: string | null) {
  return className && /(^|\s)(h|size)-/.test(className) ? classes.replace(/(^|\s)max-md:[hw]-1[01](?=\s|$)/g, "") : classes;
}

const buttonVariants = (props?: Parameters<typeof baseButtonVariants>[0]) => phoneSize(baseButtonVariants(props), props?.className as string | undefined);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof baseButtonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
