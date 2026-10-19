"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardPaste, Users } from "lucide-react";
import { packedTeam, useTeams } from "@/lib/battle/teams";
import type { BattleFormatId } from "@/lib/battle/formats";
import { BATTLE_TEAM_MAX, PLAY_FORMAT_INFO, type PlayFormatId } from "@/lib/battle/play";
import { loadSpriteLookup } from "@/lib/battle/dex";
import type { SpriteSpecies } from "@/lib/battle/sprites";
import { BattleSprite } from "@/components/battle/BattleSprite";
import { cn } from "@/lib/utils";

/**
 * "Your team" for formats that take one: a saved team from the team builder
 * (sent packed), or a team pasted in Showdown's export format as a
 * fallback. Reports the team text (or "" for none yet).
 */
export function TeamPick({ format, onChange, idPrefix }: { format: PlayFormatId; onChange: (team: string) => void; idPrefix: string }) {
  const saved = useTeams(format as BattleFormatId);
  const [mode, setMode] = useState<"saved" | "paste">("saved");
  const [teamId, setTeamId] = useState("");
  const [paste, setPaste] = useState("");
  const usable = (saved ?? []).filter((t) => t.sets.length > 0);
  const chosen = usable.find((t) => t.id === teamId) ?? usable[0];
  const pasting = mode === "paste" || (saved !== null && usable.length === 0);
  // Species data loads on demand, so the page stays light.
  const [lookup, setLookup] = useState<((name: string) => SpriteSpecies | null) | null>(null);
  useEffect(() => {
    if (usable.length === 0 || lookup) return;
    let live = true;
    loadSpriteLookup()
      .then((fn) => live && setLookup(() => fn))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [usable.length, lookup]);

  useEffect(() => {
    if (pasting) onChange(paste.trim());
    else onChange(chosen ? (packedTeam(chosen.id) ?? "") : "");
  }, [pasting, paste, chosen, onChange]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="hud-label">Your team · {PLAY_FORMAT_INFO[format].name}</span>
        {usable.length > 0 && (
          <div className="flex gap-1 rounded-md border p-0.5" role="tablist" aria-label="Team source">
            {(["saved", "paste"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn("flex items-center gap-1 rounded-sm px-2 py-1 font-display text-xs font-bold uppercase", mode === m ? "bg-secondary text-foreground" : "text-muted-foreground")}
              >
                {m === "saved" ? <Users className="h-3 w-3" aria-hidden /> : <ClipboardPaste className="h-3 w-3" aria-hidden />}
                {m === "saved" ? "My teams" : "Paste"}
              </button>
            ))}
          </div>
        )}
      </div>
      {pasting ? (
        <>
          <textarea
            id={`${idPrefix}-paste`}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            maxLength={BATTLE_TEAM_MAX}
            rows={7}
            spellCheck={false}
            aria-label="Paste a team in Showdown's export format"
            placeholder={"Paste a team in Showdown's export format, e.g.\n\nGholdengo @ Choice Specs\nAbility: Good as Gold\nTera Type: Steel\nEVs: 252 SpA / 4 SpD / 252 Spe\nTimid Nature\n- Make It Rain\n- Shadow Ball\n..."}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            {saved !== null && usable.length === 0 ? (
              <>
                No saved {PLAY_FORMAT_INFO[format].short} teams yet.{" "}
                <Link href="/battle/teams" className="underline underline-offset-2">
                  Build one
                </Link>{" "}
                or paste one here. It&apos;s checked against Pokémon Showdown&apos;s rules when the battle starts.
              </>
            ) : (
              <>Checked against Pokémon Showdown&apos;s rules when the battle starts.</>
            )}
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <select
            value={chosen?.id ?? ""}
            onChange={(e) => setTeamId(e.target.value)}
            aria-label="Saved team"
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {usable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name || "Untitled team"} ({t.sets.length})
              </option>
            ))}
          </select>
          {chosen && (
            <div className="flex flex-wrap gap-1" aria-label="Team members">
              {chosen.sets.map((set, i) => (
                <BattleSprite key={i} species={lookup?.(set.species)} size={40} animated={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
