"use client";

import dynamic from "next/dynamic";
import type { GlobeEra, GlobeRegionCard } from "@/lib/globe/regions";
import type { GlobeLocal } from "./WorldGlobe";
import { STAGE_POSTERS, StagePoster } from "@/components/lab/StagePoster";

// three.js only loads on this page.
const WorldGlobe = dynamic(() => import("./WorldGlobe").then((m) => m.WorldGlobe), {
  ssr: false,
  // The page's own HTML: on a phone, a still of the world (the largest paint) until the globe's code has arrived.
  loading: () => (
    <div className="fixed inset-0 z-[60] bg-background">
      <StagePoster src={STAGE_POSTERS.globe} gone={false} fullScreen />
    </div>
  ),
});

export function GlobeLoader(props: { regions: GlobeRegionCard[]; eras: GlobeEra[]; local?: GlobeLocal }) {
  return <WorldGlobe {...props} />;
}
