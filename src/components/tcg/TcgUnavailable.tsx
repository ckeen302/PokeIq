import { serverT } from "@/i18n/server";
import tcg from "@/messages/tcg";

/** What a TCG page says when the Pokémon TCG API can't give it what it needs (server pages only). */
export function TcgUnavailable({ what = "cards" }: { what?: "cards" | "sets" | "set" | "setCards" }) {
  const t = serverT(tcg);
  return (
    <div className="hud rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="tcg-unavailable">
      {t(`unavailable.${what}`)}
    </div>
  );
}
