import { BootLoader } from "@/components/layout/BootLoader";

/**
 * Shown while a page that needs server work (leaderboards, challenge links) is
 * loading. It holds a full screen of height so the footer stays below the fold
 * instead of painting near the top and jumping down when the page arrives.
 */
export default function Loading() {
  return (
    <div className="grid min-h-screen place-items-center" data-route-loading>
      <BootLoader idPrefix="route" />
    </div>
  );
}
