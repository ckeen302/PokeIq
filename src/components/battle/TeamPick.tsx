"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Hammer, LoaderCircle, Pencil, Shuffle, Users, X, Zap } from "lucide-react";
import { createTeam, deleteTeam, fetchQuickTeam, fetchQuickTeamFor, lastTeamId, packedTeam, rememberTeam, saveTeam, useTeams, type BattleTeam } from "@/lib/battle/teams";
import { packTeam, type TeamSet } from "@/lib/battle/sets";
import type { BattleFormatId } from "@/lib/battle/formats";
import { BATTLE_TEAM_MAX, PLAY_FORMAT_INFO, type PlayFormatId } from "@/lib/battle/play";
import { Button } from "@/components/ui/button";
import { BattleSprite } from "@/components/battle/BattleSprite";
import { cn } from "@/lib/utils";
import { useSpriteLookup } from "./hooks";
import { TeamEditor } from "./TeamEditor";

type Mode = "saved" | "quick" | "paste";
type Quick = { sets: TeamSet[] | null; busy: boolean; error: string | null };
/** The team open in the inline builder; `fresh` ones are dropped on Discard. */
type Editing = { id: string; fresh: boolean };

/**
 * "Your team" for formats that take one, without leaving the battle setup:
 * pick a saved team (the last one used in the format comes preselected),
 * build one in the team builder opened in place, or take a quick team
 * (legal for the format, editable afterwards). Pasting a Showdown export
 * stays as a secondary import. Reports the team text (or "" for none yet).
 */
/**
 * Where a team comes from when it isn't one of PLAY_FORMATS (custom rules, the Battle Tower):
 * the team builder format whose saved teams fit (null: none), and the quick-team request.
 */
export interface TeamSource {
  name: string;
  short: string;
  saved: BattleFormatId | null;
  quick: Record<string, unknown>;
  /** What the quick team note says about its sets. */
  quickNote?: string;
}

export function TeamPick({ format, onChange, idPrefix, source }: { format: PlayFormatId; onChange: (team: string) => void; idPrefix: string; source?: TeamSource }) {
  const fmt = (source ? (source.saved ?? "gen9ou") : format) as BattleFormatId;
  const short = source?.short ?? PLAY_FORMAT_INFO[format].short;
  const name = source?.name ?? PLAY_FORMAT_INFO[format].name;
  const canSave = !source || source.saved !== null;
  const library = useTeams(fmt);
  const saved = canSave ? library : library && [];
  const sprite = useSpriteLookup();
  const [picked, setPicked] = useState<Mode | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [quick, setQuick] = useState<Quick>({ sets: null, busy: false, error: null });
  const [paste, setPaste] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);

  const usable = (saved ?? []).filter((t) => t.sets.length > 0);
  // Until the player chooses: their saved teams if they have any, else a quick team.
  const mode: Mode | null = picked ?? (saved === null ? null : usable.length ? "saved" : "quick");
  const last = saved === null ? null : lastTeamId(fmt);
  const chosen = usable.find((t) => t.id === teamId) ?? usable.find((t) => t.id === last) ?? usable[0];

  const choose = (id: string) => {
    setTeamId(id);
    setPicked("saved");
    rememberTeam(fmt, id);
  };

  async function dealQuick() {
    setQuick((q) => ({ ...q, busy: true, error: null }));
    try {
      setQuick({ sets: await (source ? fetchQuickTeamFor(source.quick) : fetchQuickTeam(fmt)), busy: false, error: null });
    } catch (err) {
      setQuick((q) => ({ ...q, busy: false, error: err instanceof Error ? err.message : "Couldn't deal a quick team." }));
    }
  }

  // A quick team is dealt as soon as it's the choice.
  useEffect(() => {
    if (mode === "quick" && !quick.sets && !quick.busy && !quick.error) void dealQuick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, quick]);

  useEffect(() => {
    if (mode === "paste") onChange(paste.trim());
    else if (mode === "quick") onChange(quick.sets ? packTeam(quick.sets) : "");
    else if (mode === "saved" && chosen) onChange(packedTeam(chosen.id) ?? "");
    else onChange("");
  }, [mode, paste, quick.sets, chosen, onChange]);

  const build = () => setEditing({ id: createTeam(fmt, `My ${short} team`).id, fresh: true });
  const editQuick = () => quick.sets && setEditing({ id: createTeam(fmt, `Quick ${short} team`, quick.sets).id, fresh: true });

  const OPTIONS = [
    { key: "saved", Icon: Users, title: "Saved team", note: usable.length ? `${usable.length} for ${short}` : "None yet", disabled: !usable.length, act: () => setPicked("saved") },
    { key: "build", Icon: Hammer, title: "Build a team", note: canSave ? "Team builder, right here" : "Not for this generation", disabled: !canSave, act: build },
    { key: "quick", Icon: Zap, title: "Quick team", note: "One click, legal and ready", disabled: false, act: () => setPicked("quick") },
  ] as const;

  return (
    <div className="space-y-3" data-testid="team-pick">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="hud-label">Your team · {name}</span>
        <button
          type="button"
          onClick={() => setPicked(mode === "paste" ? null : "paste")}
          aria-pressed={mode === "paste"}
          className={cn("flex items-center gap-1 text-xs underline-offset-2 hover:underline", mode === "paste" ? "text-foreground" : "text-muted-foreground")}
        >
          <ClipboardPaste className="h-3 w-3" aria-hidden /> Import from Showdown
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Team source">
        {OPTIONS.map(({ key, Icon, title, note, disabled, act }) => (
          <button
            key={key}
            type="button"
            onClick={act}
            disabled={disabled}
            aria-pressed={key === "build" ? undefined : mode === key}
            className={cn(
              "flex items-start gap-2.5 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:border-screen/60 disabled:cursor-not-allowed disabled:opacity-50",
              mode === key && "border-primary ring-1 ring-primary"
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block font-display text-sm font-bold uppercase">{title}</span>
              <span className="block text-xs text-muted-foreground">{note}</span>
            </span>
          </button>
        ))}
      </div>

      {mode === "saved" && (
        <div className="space-y-2">
          <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label="Saved team">
            {usable.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={t.id === chosen?.id}
                  onClick={() => choose(t.id)}
                  className={cn(
                    "flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2 text-left hover:border-screen/50",
                    t.id === chosen?.id && "border-screen/60 bg-screen/10"
                  )}
                >
                  <span className="min-w-[8rem] flex-1 truncate font-display text-sm font-bold uppercase tracking-wide">{t.name || "Untitled team"}</span>
                  <Sprites sets={t.sets} sprite={sprite} />
                </button>
              </li>
            ))}
          </ul>
          {chosen && (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ id: chosen.id, fresh: false })}>
              <Pencil className="h-4 w-4" aria-hidden /> Edit {chosen.name || "team"}
            </Button>
          )}
        </div>
      )}

      {mode === "quick" && (
        <div className="space-y-2 rounded-md border border-dashed border-foreground/15 p-3" data-testid="quick-team">
          {quick.error ? (
            <p className="text-sm text-destructive" role="alert">
              {quick.error}
            </p>
          ) : quick.sets ? (
            <Sprites sets={quick.sets} sprite={sprite} size={44} />
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Dealing a {short} team…
            </p>
          )}
          <p className="text-xs text-muted-foreground">{source?.quickNote ?? `Tournament-tested sets, legal in ${short}.`} Keep it, deal another{canSave ? ", or make it yours" : ""}.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void dealQuick()} disabled={quick.busy}>
              <Shuffle className="h-4 w-4" aria-hidden /> Another
            </Button>
            {canSave && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={editQuick} disabled={!quick.sets || quick.busy}>
                  <Pencil className="h-4 w-4" aria-hidden /> Edit this team
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={build}>
                  <Hammer className="h-4 w-4" aria-hidden /> Build your own
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {mode === "paste" && (
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
          <p className="text-xs text-muted-foreground">Checked against Pokémon Showdown&apos;s rules when the battle starts.</p>
        </>
      )}

      {editing && (
        <BuilderDialog
          team={saved?.find((t) => t.id === editing.id)}
          fresh={editing.fresh}
          onClose={(discard) => {
            const team = saved?.find((t) => t.id === editing.id);
            if (!discard && team?.sets.length) choose(team.id);
            else if (editing.fresh) deleteTeam(editing.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Sprites({ sets, sprite, size = 32 }: { sets: TeamSet[]; sprite: ReturnType<typeof useSpriteLookup>; size?: number }) {
  return (
    <span className="flex flex-wrap items-center" aria-label={sets.map((s) => s.species).join(", ")}>
      {sets.map((s, i) => (
        <BattleSprite key={i} species={sprite?.(s.species)} animated={false} size={size} />
      ))}
    </span>
  );
}

/**
 * The team builder in a large dialog over the battle setup. Edits save as
 * they're made, like on the Teams page; closing it picks the team for the
 * battle (a new team is dropped only on Discard, or if it's still empty).
 */
function BuilderDialog({ team, fresh, onClose }: { team: BattleTeam | undefined; fresh: boolean; onClose: (discard: boolean) => void }) {
  const [random, setRandom] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function reroll(format: BattleFormatId) {
    if (!team) return;
    setRandom({ busy: true, error: null });
    try {
      saveTeam({ ...team, sets: await fetchQuickTeam(format) });
      setRandom({ busy: false, error: null });
    } catch (err) {
      setRandom({ busy: false, error: err instanceof Error ? err.message : "Couldn't deal a team." });
    }
  }

  // Portaled out of the setup form, so the builder's buttons and inputs never submit it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 backdrop-blur-sm sm:p-6">
      <div role="dialog" aria-modal="true" aria-label="Team builder" className="relative w-full max-w-5xl rounded-xl border bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
          <h2 className="font-display text-lg font-bold uppercase tracking-wide">Team builder</h2>
          <button type="button" onClick={() => onClose(false)} aria-label="Close team builder" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="px-4 py-4 sm:px-6">
          {random.error && (
            <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {random.error}
            </p>
          )}
          {team ? (
            <TeamEditor team={team} onRandom={(f) => void reroll(f)} randomBusy={random.busy} lockFormat />
          ) : (
            <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading…
            </p>
          )}
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t bg-background/95 px-4 py-3 sm:px-6">
          <span className="mr-auto text-xs text-muted-foreground">Saved to your teams as you go.</span>
          {fresh && (
            <Button type="button" variant="ghost" onClick={() => onClose(true)}>
              Discard
            </Button>
          )}
          <Button type="button" onClick={() => onClose(false)} disabled={!team?.sets.length}>
            Use this team
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
