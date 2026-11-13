"use client";

/**
 * The page inside the root layout's <main>, through a component of its own.
 *
 * The page's part of the server payload streams in after the layout's, and on
 * a slow connection or a busy server the browser can start hydrating before
 * it has arrived. If <main> held the page directly, <main> itself would wait
 * for it, and React's retry of a waiting element during hydration starts
 * that element over from inside it: it then looks for <main> among <main>'s
 * own children, finds the page's first node instead, and throws away the
 * server HTML (React error #418, "Hydration failed"). With this component in
 * between, it is this component that waits, and a component has no HTML of
 * its own to look for. It renders nothing but the page.
 */
export function RouteSlot({ children }: { children: React.ReactNode }) {
  return children;
}
