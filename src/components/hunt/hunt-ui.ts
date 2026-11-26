"use client";

import { useCallback } from "react";
import { useGeoNames } from "@/lib/geo-i18n-client";
import type { HuntRegionId } from "@/lib/hunt/types";

/** The form tag's key for an entry id ("52-alola" → "alola", "128-paldea-blaze" → "paldea-blaze"); null for a base form. */
export function formKey(id: string): string | null {
  const i = id.indexOf("-");
  return i < 0 ? null : id.slice(i + 1);
}

/** A Hunt region's name in the page's language ("kanto" → "Kanto", or that language's). */
export function useHuntRegionName(): (id: HuntRegionId | string) => string {
  const names = useGeoNames();
  return useCallback((id) => names.region(id.charAt(0).toUpperCase() + id.slice(1)), [names]);
}

/** The most a round scores. */
export const HUNT_ROUND_MAX = 5000;

/** A round's verdict, by its score. */
export const verdictOf = (score: number) => (score >= 4500 ? "perfect" : score >= 3500 ? "great" : score >= 2000 ? "good" : score > 0 ? "near" : "far");
