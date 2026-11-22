"use client";

import dynamic from "next/dynamic";
import type { GlobeEra, GlobeRegionCard } from "@/lib/globe/regions";
import type { GlobeLocal } from "./WorldGlobe";

// three.js only loads on this page.
const WorldGlobe = dynamic(() => import("./WorldGlobe").then((m) => m.WorldGlobe), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-[60] bg-background" />,
});

export function GlobeLoader(props: { regions: GlobeRegionCard[]; eras: GlobeEra[]; local?: GlobeLocal }) {
  return <WorldGlobe {...props} />;
}
