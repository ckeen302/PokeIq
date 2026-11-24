"use client";

import { useSearchParams } from "next/navigation";

/**
 * MOCK ONLY: picks one of the hub's design directions from ?v=a|b|c, on a
 * development server only (a production build always shows the first).
 */
export function VariantSwitch({ a, b, c }: { a: React.ReactNode; b?: React.ReactNode; c?: React.ReactNode }) {
  const v = useSearchParams().get("v");
  if (process.env.NODE_ENV !== "development") return <>{a}</>;
  return <>{v === "b" && b ? b : v === "c" && c ? c : a}</>;
}
