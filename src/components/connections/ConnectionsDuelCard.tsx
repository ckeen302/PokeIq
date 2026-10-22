"use client";

import { CONN_DUEL_PENALTY_MS, pvpHref } from "@/lib/pvp-types";
import { CONN_MAX_MISTAKES } from "@/lib/connections/types";
import { NewDuelCard } from "@/components/duel/NewDuelCard";

const BODY = { kind: "connections" };
const MATCH = { game: "connections" };

/**
 * "Duel a friend" on /connections: opens a PokéConnections race and goes to
 * its lobby, or finds an opponent searching right now.
 */
export function ConnectionsDuelCard() {
  return (
    <NewDuelCard
      body={BODY}
      href={(code) => pvpHref("connections", code)}
      match={MATCH}
      heading="Head to head · PokéConnections"
      blurb="The same sixteen Pokémon for both of you. The first to find all four groups wins."
      info={
        <>
          <p>
            Each mistake adds {CONN_DUEL_PENALTY_MS / 1000} seconds to your time, and {CONN_MAX_MISTAKES} mistakes put you out. If you&apos;re both out, more groups found wins. You see your
            opponent&apos;s groups as colours as they find them, never which Pokémon.
          </p>
          <p>Send a friend the link, or find an opponent. Duels use fresh puzzles, never the daily, and never count toward your streak.</p>
        </>
      }
    />
  );
}
