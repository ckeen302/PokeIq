import { cn } from "@/lib/utils";

/**
 * A home section's heading: the site's HUD style on wider screens (display
 * type over a hairline), a plain bold heading on a phone. `aside` sits on the
 * right (under the heading on a phone), `action` is a link at the far right.
 */
export function HomeHeading({ id, title, aside, action, className }: { id: string; title: React.ReactNode; aside?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 md:mb-5 md:border-b md:border-foreground/[0.07] md:pb-2", className)}>
      <h2 id={id} className="text-xl font-bold leading-tight md:font-display md:text-2xl md:uppercase md:tracking-[0.06em]">
        {title}
      </h2>
      {(aside || action) && (
        <div className="flex min-h-5 items-center gap-4 max-md:w-full max-md:justify-between">
          {aside}
          {action}
        </div>
      )}
    </div>
  );
}
