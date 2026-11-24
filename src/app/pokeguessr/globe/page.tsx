import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GlobeLoader } from "@/components/globe/GlobeLoader";
import { globeEras, globeRegionCards } from "@/lib/globe/regions";
import { globeLocal } from "@/lib/globe/local";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import pokeguessr from "@/messages/pokeguessr";
import globeNs from "@/messages/globe";
import labClip from "@/messages/lab-clip";
import shareNs from "@/messages/share";

export function generateMetadata(): Metadata {
  const t = serverT(pokeguessr);
  return pageMetadata({
    title: t("globe.title"),
    description: t("globe.description"),
    path: "/pokeguessr/globe",
  });
}

export default function GlobePage() {
  const regions = globeRegionCards();
  // Another language's page gets its cards and names in that language (English: exactly as before).
  const { cards, local } = globeLocal(regions);
  return (
    <ClientMessages namespaces={[globeNs, labClip, shareNs]}>
      <GlobeLoader regions={cards} eras={globeEras(regions)} {...(local && { local })} />
    </ClientMessages>
  );
}
