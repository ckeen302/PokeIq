"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** A short note shown above its trigger on hover or keyboard focus. The trigger is described by it. */
export function Tooltip({ content, children, className }: { content: React.ReactNode; children: React.ReactElement<{ "aria-describedby"?: string }>; className?: string }) {
  const id = React.useId();
  return (
    <span className="group/tip relative inline-flex">
      {React.cloneElement(children, { "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none invisible absolute bottom-full left-1/2 z-40 mb-2 w-max max-w-[16rem] -translate-x-1/2 rounded-md border bg-card px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-card-foreground opacity-0 shadow-lg transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100",
          className
        )}
      >
        {content}
      </span>
    </span>
  );
}

/** An ⓘ button with a tooltip: for the explanation behind a compact control. */
export function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip content={children} className={className}>
      <button type="button" aria-label={label} className="rounded-full p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Info className="h-4 w-4" aria-hidden />
      </button>
    </Tooltip>
  );
}
