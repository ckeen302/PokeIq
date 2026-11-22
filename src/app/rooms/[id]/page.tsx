import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { notFound } from "next/navigation";
import { permanentRedirect } from "@/i18n/server";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { ROOMS, ROOM_MOVED, SITE_RULES, roomById } from "@/lib/rooms";
import { RoomChat } from "@/components/rooms/RoomChat";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import roomsPage from "@/messages/rooms-page";
import rooms from "@/messages/rooms";
import roomChat from "@/messages/room-chat";

interface PageProps {
  params: Promise<{ id: string }>;
}

export function generateStaticParams() {
  return ROOMS.map((r) => ({ id: r.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const room = roomById((await params).id);
  const t = serverT(roomsPage);
  const r = serverT(rooms);
  return pageMetadata({
    title: room ? t("room.title", { name: r(`names.${room.id}` as never) }) : t("room.fallbackTitle"),
    description: room ? r(`descriptions.${room.id}` as never) : t("room.fallbackDescription"),
    path: `/rooms/${room?.id ?? ""}`,
  });
}

export default async function RoomPage({ params }: PageProps) {
  const { id } = await params;
  if (ROOM_MOVED[id]) permanentRedirect(`/rooms/${ROOM_MOVED[id]}`);
  const room = roomById(id);
  if (!room) notFound();
  const t = serverT(roomsPage);
  const r = serverT(rooms);
  const name = r(`names.${room.id}` as never);
  const rules = [...room.rules.map((_, i) => t(`rules.${room.id}.${i}` as never)), ...SITE_RULES.map((_, i) => t(`siteRules.${i}` as never))];
  return (
    <div className="mx-auto max-w-6xl space-y-4">
    <BackButton href="/rooms" label={t("room.back")} />
      <nav aria-label="Breadcrumb" className="hud-label flex items-center gap-1.5">
        <Link href="/rooms" className="text-screen hover:text-foreground">
          {t("room.crumb")}
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <span>{name}</span>
      </nav>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-2">
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight">{name}</h1>
          <p className="text-muted-foreground">{r(`descriptions.${room.id}` as never)}</p>
          <div className="flex flex-wrap gap-2 pt-1" data-testid="room-links">
            {room.links.map((l, i) => (
              <Link key={l.href} href={l.href} className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider hover:border-primary/60">
                {t(`links.${room.id}.${i}` as never)}
              </Link>
            ))}
          </div>
        </div>
        <details className="hud rounded-lg border bg-card p-3 text-sm" open>
          <summary className="hud-label flex cursor-pointer items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {t("room.rules")}
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </details>
      </div>
      <ClientMessages namespaces={[roomChat]}>
        <RoomChat room={room.id} />
      </ClientMessages>
    </div>
  );
}
