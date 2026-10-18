import { BootLoader } from "@/components/layout/BootLoader";

/** Shown while a page that needs server work (leaderboards, challenge links) is loading. */
export default function Loading() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <BootLoader idPrefix="route" />
    </div>
  );
}
