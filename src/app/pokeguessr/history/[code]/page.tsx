import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { GeoReplay } from "@/components/geo/GeoReplay";
import { geoRegions } from "@/lib/server/geo";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pokeguessr from "@/messages/pokeguessr";
import { GEO_REPLAY_NAMESPACES } from "@/lib/geo-namespaces";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const t = serverT(pokeguessr);
  return pageMetadata({
    title: t("replay.title"),
    description: t("replay.description"),
    path: `/pokeguessr/history/${code}`,
    noindex: true,
  });
}

/** The replay is read in the browser: only the two trainers (or anyone, once shared) may see it, and who you are lives in your browser. */
export default async function DuelReplayPage({ params }: PageProps) {
  const { code } = await params;
  if (!DUEL_CODE_RE.test(code)) notFound();
  return (
    <ClientMessages namespaces={GEO_REPLAY_NAMESPACES}>
      <GeoReplay code={code} regions={geoRegions()} />
    </ClientMessages>
  );
}
