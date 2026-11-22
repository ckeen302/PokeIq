import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { TournamentRoom } from "@/components/tournaments/TournamentRoom";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-pages";
import battleTournaments from "@/messages/battle-tournaments";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const t = serverT(battlePages);
  return pageMetadata({ title: t("tournament.title"), description: t("tournament.description"), path: `/battle/tournaments/${id}`, noindex: true });
}

export default async function TournamentPage({ params }: PageProps) {
  const { id } = await params;
  if (!/^[a-z0-9-]{8,24}$/.test(id)) notFound();
  const t = serverT(battlePages);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
    <BackButton href="/battle/tournaments" label={t("tournament.back")} />
      <nav aria-label="Breadcrumb" className="hud-label flex items-center gap-1.5">
        <Link href="/battle" className="text-screen hover:text-foreground">
          {t("crumb")}
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <Link href="/battle/tournaments" className="text-screen hover:text-foreground">
          {t("tournament.crumb")}
        </Link>
      </nav>
      <ClientMessages namespaces={[battleTournaments]}>
        <TournamentRoom id={id} />
      </ClientMessages>
    </div>
  );
}
