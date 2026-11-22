import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { MASS_BATTLE_LIVE } from "@/lib/lab";
import { MASS_BATTLE_PATH } from "@/lib/mass-battle/share";
import { PRESETS } from "@/lib/mass-battle/presets";
import { presetById } from "@/lib/mass-battle/page-data";
import { MassBattlePage } from "@/components/mass-battle/MassBattlePage";
import { localPreset } from "@/lib/mass-battle/i18n";
import { serverT } from "@/i18n/server";
import mbPages from "@/messages/mass-battle-pages";

/** A ready-made battle's own page (and share link), with its own preview card. */

export const dynamicParams = false;

export function generateStaticParams() {
  return PRESETS.map((p) => ({ preset: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ preset: string }> }): Promise<Metadata> {
  const found = presetById((await params).preset);
  if (!found) return {};
  const t = serverT(mbPages);
  const p = localPreset(found, t);
  return pageMetadata({ title: p.title, description: t("meta.presetDescription", { blurb: p.blurb }), path: `${MASS_BATTLE_PATH}/${p.id}`, socialTitle: t("meta.presetSocial", { title: p.title }), noindex: !MASS_BATTLE_LIVE });
}

export default async function Page({ params }: { params: Promise<{ preset: string }> }) {
  const p = presetById((await params).preset);
  if (!p) notFound();
  return <MassBattlePage preset={p} />;
}
