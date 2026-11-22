"use client";

import { X } from "lucide-react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { useT } from "@/i18n/client";
import report from "@/messages/report";
import { cn } from "@/lib/utils";

/** The games' pop-up sheet (Pokédle's how to play, stats and archive; Pikadoku's and PokéConnections' sheets too). */

export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  // The chrome's "Close" (every page in every language has it), so the other games' sheets need nothing more.
  const r = useT(report);
  const closeRef = useDialogFocus(onClose);
  return (
    // Phones: a bottom sheet over the tab bar, scrolling inside itself, its title and close button pinned on top
    // (the sheet has no top padding there: a sticky title would otherwise stop that far down and cover the first line).
    // It fades in from transparent, so a first visit's how-to never counts as the page's largest paint: the board does.
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 max-md:z-[65] max-md:items-end max-md:overflow-hidden max-md:p-0" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn("relative my-8 w-full rounded-lg border-2 sm:my-auto border-foreground/15 bg-card p-5 shadow-2xl max-md:my-0 max-md:max-h-[92dvh] max-md:max-w-none max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:pt-0 max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-md:animate-sheet-in", wide ? "max-w-2xl" : "max-w-md")}
      >
        <div className="mb-4 flex items-center justify-between gap-2 max-md:sticky max-md:top-0 max-md:z-10 max-md:-mx-5 max-md:mt-0 max-md:mb-2 max-md:bg-card max-md:px-5 max-md:pb-2 max-md:pt-4">
          <h2 className="font-display text-xl font-bold uppercase tracking-tight">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={r("close")} className="rounded-md p-1 max-md:-mr-2 max-md:p-2.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
