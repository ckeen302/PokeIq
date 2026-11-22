import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { RoomList } from "@/components/rooms/RoomList";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import roomsPage from "@/messages/rooms-page";
import rooms from "@/messages/rooms";

export function generateMetadata(): Metadata {
  const t = serverT(roomsPage);
  return pageMetadata({
    title: t("list.title"),
    description: t("list.description"),
    path: "/rooms",
    image: SHARE_IMAGES.site,
  });
}

const hl = (c: React.ReactNode) => <span className="text-primary">{c}</span>;

export default function RoomsPage() {
  const t = serverT(roomsPage);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
    <BackButton href="/" />
      <div className="space-y-2">
        <p className="hud-label max-md:hidden">{t("list.label")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">
          {t.rich("list.heading", { hl })}
        </h1>
        <p className="max-w-2xl text-muted-foreground">{t("list.intro")}</p>
      </div>
      <ClientMessages namespaces={[rooms]}>
        <RoomList />
      </ClientMessages>
    </div>
  );
}
