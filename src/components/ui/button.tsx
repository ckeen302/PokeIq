import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Chunky game-console buttons: hard bottom shadow that compresses on press. */
const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-display text-sm font-semibold uppercase tracking-wider transition-[transform,box-shadow,filter,background-color,border-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-[2px] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] hover:brightness-110 active:shadow-[0_2px_0_hsl(var(--primary-shadow))]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_4px_0_hsl(0_70%_32%)] hover:brightness-110 active:shadow-[0_2px_0_hsl(0_70%_32%)]",
        outline:
          "border border-border bg-card text-foreground shadow-[0_3px_0_hsl(var(--border))] hover:border-screen/60 hover:text-foreground active:shadow-[0_1px_0_hsl(var(--border))]",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[0_3px_0_hsl(var(--secondary-shadow))] hover:brightness-125 active:shadow-[0_1px_0_hsl(var(--secondary-shadow))]",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground active:translate-y-0",
        success:
          "bg-success text-success-foreground shadow-[0_4px_0_hsl(154_60%_24%)] hover:brightness-110 active:shadow-[0_2px_0_hsl(154_60%_24%)]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-xs",
        lg: "h-12 px-7 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
