import { AlakazamMascot } from "@/components/AlakazamMascot";

/**
 * App Router loading UI — the Suspense fallback shown while a route segment
 * fetches data. Pure CSS animation (no client JS) so it paints instantly,
 * before hydration.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <AlakazamMascot size={128} />
      <p className="text-sm font-medium tracking-wide text-muted">
        Focusing psychic energy…
      </p>
    </div>
  );
}
