import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { ROOMS, ROOM_MOVED, SITE_RULES, roomById } from "@/lib/rooms";
import { RoomChat } from "@/components/rooms/RoomChat";

interface PageProps {
  params: Promise<{ id: string }>;
}

export function generateStaticParams() {
  return ROOMS.map((r) => ({ id: r.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const room = roomById((await params).id);
  return pageMetadata({ title: room ? `${room.name} chat room` : "Chat room", description: room?.description ?? "A PokéIQ chat room.", path: `/rooms/${room?.id ?? ""}` });
}

export default async function RoomPage({ params }: PageProps) {
  const { id } = await params;
  if (ROOM_MOVED[id]) permanentRedirect(`/rooms/${ROOM_MOVED[id]}`);
  const room = roomById(id);
  if (!room) notFound();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
    <BackButton href="/rooms" label="Back to rooms" />
      <nav aria-label="Breadcrumb" className="hud-label flex items-center gap-1.5">
        <Link href="/rooms" className="text-screen hover:text-foreground">
          Rooms
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <span>{room.name}</span>
      </nav>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-2">
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight">{room.name}</h1>
          <p className="text-muted-foreground">{room.description}</p>
          <div className="flex flex-wrap gap-2 pt-1" data-testid="room-links">
            {room.links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider hover:border-primary/60">
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        <details className="hud rounded-lg border bg-card p-3 text-sm" open>
          <summary className="hud-label flex cursor-pointer items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Room rules
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
            {[...room.rules, ...SITE_RULES].map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      </div>
      <RoomChat room={room.id} />
    </div>
  );
}
