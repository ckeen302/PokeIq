import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { natureRows, type NatureStat } from "@/lib/dex/natures";
import { INTL_LOCALE } from "@/i18n/catalog";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/pokedex-pages";
import { dexTable, listIn } from "@/lib/pokemon/dex-local";

export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return pageMetadata({
    title: t("natures.metaTitle"),
    description: t("natures.metaDescription"),
    path: "/pokedex/natures",
    image: SHARE_IMAGES.pokedex,
  });
}

/** The natures that change nothing, in the footnote's order. */
const NEUTRAL = ["Hardy", "Docile", "Serious", "Bashful", "Quirky"];

export default function NaturesPage() {
  const t = serverT(pages);
  const locale = getLocale();
  const names = locale === "en" ? null : dexTable(locale, "natures");
  const label = (name: string) => names?.[name.toLowerCase()] ?? name;
  // Each nature under its official name; another language lists them in its own alphabetical order.
  const rows = natureRows().map((n) => ({ ...n, label: label(n.name) }));
  if (locale !== "en") rows.sort((a, b) => a.label.localeCompare(b.label, INTL_LOCALE[locale]));
  const stat = (k: NatureStat) => t(`natures.stat.${k}`);
  const neutral = NEUTRAL.map(label);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <ListHeader kicker={t("natures.kicker")} title={t("titleStart")} accent={t("titleAccent")} blurb={t("natures.blurb")} />
      <DexTabs active="natures" />
      <div className="hud overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[34rem] text-left text-sm" data-testid="nature-table">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-3">{t("natures.nature")}</th>
              <th className="p-3">{t("natures.raises")}</th>
              <th className="p-3">{t("natures.lowers")}</th>
              <th className="p-3">{t("natures.likes")}</th>
              <th className="p-3">{t("natures.dislikes")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.name} data-testid={`nature-${n.name.toLowerCase()}`} className="border-t border-foreground/10">
                <th scope="row" className="p-3 font-semibold">{n.label}</th>
                <td className={n.plus ? "p-3 font-semibold text-emerald-400" : "p-3 text-muted-foreground"}>{n.plus ? `+${stat(n.plus)}` : "—"}</td>
                <td className={n.minus ? "p-3 font-semibold text-red-400" : "p-3 text-muted-foreground"}>{n.minus ? `−${stat(n.minus)}` : "—"}</td>
                <td className="p-3">{n.plus ? t(`natures.flavor.${n.plus}`) : "—"}</td>
                <td className="p-3">{n.minus ? t(`natures.flavor.${n.minus}`) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-center text-xs text-muted-foreground">{t("natures.neutral", { list: locale === "en" ? neutral.join(", ") : listIn(locale, neutral) })}</p>
    </div>
  );
}
