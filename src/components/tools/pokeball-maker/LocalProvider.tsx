"use client";

import type { ReactNode } from "react";
import { ShinyLocalContext, type ShinyLocal } from "@/components/tools/shiny-maker/local";

/** A page in another language's Pokémon names, for the maker's Pokémon picker (the Shiny Maker's own context). */
export function ShinyLocalContextProvider({ value, children }: { value: ShinyLocal; children: ReactNode }) {
  return <ShinyLocalContext.Provider value={value}>{children}</ShinyLocalContext.Provider>;
}
