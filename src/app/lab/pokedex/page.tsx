import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { labRows } from "@/lib/lab-dex/data";
import { labLocal, labRowsIn } from "@/lib/lab-dex/local";
import { LabDexApp } from "@/components/lab-dex/LabDexApp";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import labDex from "@/messages/lab-dex";
import labClip from "@/messages/lab-clip";
import share from "@/messages/share";
import labDexPage from "@/messages/lab-dex-page";
import sizesNames from "@/messages/sizes-names";
import lab from "@/messages/lab";

/**
 * The Professor's Lab (/lab/pokedex): a 3D Pokédex. Every Pokémon (and,
 * with Forms on, every Mega, regional and Gigantamax form) on an endless
 * wheel of capsule pods round a holo-table. Static: the page carries a
 * compact index of every Pokémon (numbers, types, stats, evolution links);
 * each one's longer text comes from /api/lab-dex/<id> when it's picked.
 * The 3D scene is loaded by the page itself, on its own, so nothing else on
 * the site carries three.js for it. In another language the rows carry that
 * language's names (and the English ones, for the search) and the type names.
 */

export function generateMetadata(): Metadata {
  const t = serverT(labDexPage);
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: "/lab/pokedex",
    socialTitle: t("socialTitle"),
  });
}

export const dynamic = "force-static";

export default function Page() {
  const locale = getLocale();
  const t = serverT(lab);
  // The lab is drawn by its scripts: its heading and what it is are in the HTML too (unseen), for crawlers.
  const intro = (
    <div className="sr-only">
      <h1>{t("cards.pokedex.title")}</h1>
      <p>{t("cards.pokedex.kicker")}</p>
      <p>{t("cards.pokedex.pitch")}</p>
    </div>
  );
  if (locale === "en") return <LabDexApp rows={labRows()} intro={intro} />;
  return (
    <ClientMessages namespaces={[labDex, labClip, share]}>
      <LabDexApp rows={labRowsIn(locale, serverT(sizesNames))} local={labLocal(locale)} intro={intro} />
    </ClientMessages>
  );
}
