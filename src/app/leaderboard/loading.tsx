import { BootLoader } from "@/components/layout/BootLoader";

/**
 * Shown while the leaderboards load. It lives here rather than at the app root
 * because a root loading boundary streams every page, so a page that turns out
 * not to exist (an unknown profile, an expired challenge link) would be sent
 * with HTTP 200 instead of 404. It holds a full screen of height (and the
 * footer stays hidden behind it, see globals.css) so nothing jumps when the
 * page arrives.
 */
export default function Loading() {
  return (
    <div className="grid min-h-screen place-items-center" data-route-loading>
      <BootLoader idPrefix="route" />
    </div>
  );
}
