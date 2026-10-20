import { permanentRedirect } from "next/navigation";

/** Battle profiles are part of the trainer's profile now: /u/<name>. */
export default async function BattlePlayerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  permanentRedirect(`/u/${encodeURIComponent(decodeURIComponent(name))}`);
}
