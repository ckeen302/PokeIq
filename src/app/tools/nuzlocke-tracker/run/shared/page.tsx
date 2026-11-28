import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import page from "@/messages/nuzlocke-page";
import nuz from "@/messages/nuzlocke";
import { gameSummaries } from "@/lib/nuzlocke/games.server";
import { decodeRun } from "@/lib/nuzlocke/share";
import { RunShell } from "@/components/tools/nuzlocke/RunShell";

/**
 * A shared run: /tools/nuzlocke-tracker/run?s=… is rewritten here (next.config), so the run page stays static while a
 * link opens read-only with its own title and preview card. The address people see keeps ?s=; it isn't indexed.
 */
export const dynamic = "force-dynamic";

type Query = { s?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const PATH = "/tools/nuzlocke-tracker/run";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }): Promise<Metadata> {
  const t = serverT(page);
  const raw = one((await searchParams).s);
  const run = decodeRun(raw);
  const games = await gameSummaries();
  const game = run && games.find((g) => g.id === run.game);
  if (!run || !game || !raw) return pageMetadata({ title: t("run.title"), description: t("run.description"), noindex: true });
  const version = game.versions.find((v) => v.id === run.version)?.name ?? game.name;
  const meta = pageMetadata({
    title: t("shared.title", { name: run.name, game: version }),
    description: t("shared.description"),
    image: { url: `${PATH}/og?s=${raw}`, alt: t("shared.ogAlt", { name: run.name, game: version }) },
    url: `${PATH}?s=${raw}`,
    noindex: true,
  });
  return { ...meta, robots: { index: false, follow: true } };
}

export default async function SharedRunPage({ searchParams }: { searchParams: Promise<Query> }) {
  const raw = one((await searchParams).s);
  const games = await gameSummaries();
  return (
    <ClientMessages namespaces={[nuz]}>
      <RunShell games={games} shared={raw ?? ""} brokenText={serverT(page)("shared.broken")} />
    </ClientMessages>
  );
}
