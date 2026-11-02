import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { MASS_BATTLE_LIVE } from "@/lib/lab";
import { MASS_BATTLE_PATH } from "@/lib/mass-battle/share";
import { PRESETS } from "@/lib/mass-battle/presets";
import { presetById } from "@/lib/mass-battle/page-data";
import { MassBattlePage } from "@/components/mass-battle/MassBattlePage";

/** A ready-made battle's own page (and share link), with its own preview card. */

export const dynamicParams = false;

export function generateStaticParams() {
  return PRESETS.map((p) => ({ preset: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ preset: string }> }): Promise<Metadata> {
  const p = presetById((await params).preset);
  if (!p) return {};
  return pageMetadata({ title: p.title, description: `${p.blurb} A Pokémon mass battle in 3D with the real games' damage maths.`, path: `${MASS_BATTLE_PATH}/${p.id}`, socialTitle: `${p.title} · PokéIQ`, noindex: !MASS_BATTLE_LIVE });
}

export default async function Page({ params }: { params: Promise<{ preset: string }> }) {
  const p = presetById((await params).preset);
  if (!p) notFound();
  return <MassBattlePage preset={p} />;
}
