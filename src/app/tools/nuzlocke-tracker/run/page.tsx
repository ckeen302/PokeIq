import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import page from "@/messages/nuzlocke-page";
import nuz from "@/messages/nuzlocke";
import { gameSummaries } from "@/lib/nuzlocke/games.server";
import { RunShell } from "@/components/tools/nuzlocke/RunShell";

/**
 * /tools/nuzlocke-tracker/run?id=<run>: a run, from this browser's saved runs (it runs in the browser only). A shared
 * run, /tools/nuzlocke-tracker/run?s=…, is rewritten to ./shared (next.config), with its own title and preview card.
 */

export function generateMetadata(): Metadata {
  const t = serverT(page);
  return pageMetadata({ title: t("run.title"), description: t("run.description"), path: "/tools/nuzlocke-tracker/run", noindex: true });
}

export default async function NuzlockeRunPage() {
  const games = await gameSummaries();
  return (
    <ClientMessages namespaces={[nuz]}>
      <RunShell games={games} shared={null} />
    </ClientMessages>
  );
}
