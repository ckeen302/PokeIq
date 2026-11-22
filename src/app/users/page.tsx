import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { UserSearch } from "@/components/community/UserSearch";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import profile from "@/messages/profile";
import userSearch from "@/messages/user-search";

export function generateMetadata(): Metadata {
  const t = serverT(profile);
  return pageMetadata({
    title: t("users.title"),
    description: t("users.description"),
    path: "/users",
    image: SHARE_IMAGES.site,
  });
}

const hl = (c: React.ReactNode) => <span className="text-primary [text-shadow:0_0_30px_hsl(var(--primary)/0.45)]">{c}</span>;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const t = serverT(profile);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
    <BackButton href="/" />
      <div className="space-y-2">
        <p className="hud-label max-md:hidden text-screen">{t("users.label")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          {t.rich("users.heading", { hl })}
        </h1>
        <p className="text-muted-foreground">{t("users.intro")}</p>
      </div>
      <ClientMessages namespaces={[userSearch]}>
        <UserSearch initial={typeof q === "string" ? q.slice(0, 20) : ""} />
      </ClientMessages>
    </div>
  );
}
