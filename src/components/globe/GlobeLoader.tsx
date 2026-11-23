"use client";

import dynamic from "next/dynamic";
import type { GlobeEra, GlobeRegionCard } from "@/lib/globe/regions";
import type { GlobeLocal } from "./WorldGlobe";
import { useT } from "@/i18n/client";
import globeNs from "@/messages/globe";

// three.js only loads on this page.
const WorldGlobe = dynamic(() => import("./WorldGlobe").then((m) => m.WorldGlobe), {
  ssr: false,
  loading: () => <GlobeCover />,
});

/**
 * What covers the screen until the globe has loaded. It holds the globe's heading and how to use it, unseen, so the
 * page's HTML has them (the globe draws its own once it is there, and this goes).
 */
function GlobeCover() {
  const t = useT(globeNs);
  return (
    <div className="fixed inset-0 z-[60] bg-background">
      <div className="sr-only">
        <h1>{t.rich("title", { accent: (chunks) => chunks })}</h1>
        <p>{t("tagline")}</p>
        <p>{t("help")}</p>
      </div>
    </div>
  );
}

export function GlobeLoader(props: { regions: GlobeRegionCard[]; eras: GlobeEra[]; local?: GlobeLocal }) {
  return <WorldGlobe {...props} />;
}
