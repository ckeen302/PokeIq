import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { GeoReplay } from "@/components/geo/GeoReplay";
import { geoRegions } from "@/lib/server/geo";
import { DUEL_CODE_RE } from "@/lib/duel-types";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  return pageMetadata({
    title: "PokéGuessr duel replay",
    description: "A PokéGuessr duel, round by round: the screenshot, both pins and the true place, the scores, damage and HP.",
    path: `/guessr/history/${code}`,
    noindex: true,
  });
}

/** The replay is read in the browser: only the two trainers (or anyone, once shared) may see it, and who you are lives in your browser. */
export default async function DuelReplayPage({ params }: PageProps) {
  const { code } = await params;
  if (!DUEL_CODE_RE.test(code)) notFound();
  return <GeoReplay code={code} regions={geoRegions()} />;
}
