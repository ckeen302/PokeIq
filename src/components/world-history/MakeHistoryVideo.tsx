"use client";

import type { Film } from "@/lib/world-history/timing";

export default function MakeHistoryVideo({ onClose }: { film: Film; chapter: number; onRecording(on: boolean): void; onClose(): void }) {
  return (
    <div role="dialog" aria-label="Make a video" className="absolute inset-0 z-40 grid place-items-center bg-black/70 text-white">
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
