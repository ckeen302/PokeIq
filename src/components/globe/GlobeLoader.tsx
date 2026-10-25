"use client";

import dynamic from "next/dynamic";

// three.js only loads on this page.
const WorldGlobe = dynamic(() => import("./WorldGlobe").then((m) => m.WorldGlobe), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-[60] bg-background" />,
});

export function GlobeLoader() {
  return <WorldGlobe />;
}
