import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

type Vars = React.CSSProperties & Record<`--${string}`, string>;

/**
 * The card classes, for a card that is a link or a button. `base`: the calm card for text-heavy pages. `feature`: the
 * PokéGuessr landing's glossy face, for a page's few big picks (with art). `accent` is the section's colour (an HSL
 * triplet): a soft light in the card's corner, its icon well and its ring on hover. `hud` is the older bracketed panel.
 */
const cardVariants = cva("", {
  variants: {
    variant: {
      hud: "hud relative rounded-lg border bg-card text-card-foreground shadow-[0_8px_30px_-12px_hsl(var(--shade)/0.6)]",
      base: "kit-card",
      feature: "kit-feature",
    },
    interactive: { true: "kit-lift focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background", false: "" },
  },
  defaultVariants: { variant: "hud", interactive: false },
});

/** The section colour as the card's style (merged into any style it already has). */
function accentStyle(accent?: string, style?: React.CSSProperties): React.CSSProperties | undefined {
  return accent ? ({ ...style, "--kit-accent": accent } as Vars) : style;
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  /** The section's colour, an HSL triplet such as "340 86% 60%". */
  accent?: string;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, interactive, accent, style, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, interactive }), className)} style={accentStyle(accent, style)} {...props} />
  )
);
Card.displayName = "Card";

/** A section's name as a tab sitting on a card's top edge (the PokéGuessr landing's "Single player"). */
function CardTab({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("kit-tab rounded-b-none", className)} {...props} />;
}

/** An icon in a well tinted with the section's colour (inherits a card's accent, or takes its own). */
function IconWell({ accent, className, style, size = "md", ...props }: React.HTMLAttributes<HTMLSpanElement> & { accent?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={cn("kit-well", size === "sm" ? "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4" : size === "lg" ? "h-14 w-14 rounded-2xl [&_svg]:h-7 [&_svg]:w-7" : "h-11 w-11 [&_svg]:h-5 [&_svg]:w-5", className)}
      style={accentStyle(accent, style)}
      {...props}
    />
  );
}

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("font-display text-2xl font-bold leading-none tracking-tight", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, CardTab, IconWell, cardVariants, accentStyle };
