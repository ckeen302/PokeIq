import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { RoomList } from "@/components/rooms/RoomList";

export const metadata: Metadata = pageMetadata({
  title: "Chat rooms",
  description: "Chat with other trainers on PokéIQ: the Lobby, Random Battles, OverUsed, Little Cup, PokéGuessr, Pokédle, Help and the Trainer Academy for beginners.",
  path: "/rooms",
});

export default function RoomsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
    <BackButton href="/" />
      <div className="space-y-2">
        <p className="hud-label">Community</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">
          Chat <span className="text-primary">rooms</span>
        </h1>
        <p className="max-w-2xl text-muted-foreground">Talk Pokémon with other trainers. Anyone can read; sign in to chat. Moderators keep every room friendly.</p>
      </div>
      <RoomList />
    </div>
  );
}
