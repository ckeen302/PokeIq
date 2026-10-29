"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, ClipboardCopy, FileInput, Folder, LoaderCircle, Plus, Search, Shuffle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BATTLE_FORMATS, BATTLE_FORMAT_IDS, DEFAULT_FORMAT, type BattleFormatId } from "@/lib/battle/formats";
import type { TeamSet } from "@/lib/battle/sets";
import { createTeam, deleteTeam, duplicateTeam, restoreTeam, teamsBackupText, useTeams, type BattleTeam } from "@/lib/battle/teams";
import { normalize } from "@/lib/battle/search";
import { cn } from "@/lib/utils";
import { BattleSprite } from "./BattleSprite";
import { useSpriteLookup } from "./hooks";
import { inputClass } from "./controls";
import { ImportPanel, TeamEditor } from "./TeamEditor";

type View = { kind: "team"; id: string } | { kind: "new" } | { kind: "import" };

/** The open team lives in ?team=<id>, so a reload (or a shared tab) reopens it. */
function readTeamParam(): string | null {
  return new URLSearchParams(window.location.search).get("team");
}

function writeTeamParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("team", id);
  else url.searchParams.delete("team");
  window.history.replaceState(window.history.state, "", url);
}

export function TeamBuilder() {
  const teams = useTeams();
  const [view, setView] = useState<View | null>(null);
  const [random, setRandom] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [undo, setUndo] = useState<BattleTeam | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(undoTimer.current ?? undefined), []);

  // Open the team from the URL, else the latest one, else the format picker.
  useEffect(() => {
    if (!teams || view) return;
    const id = readTeamParam();
    const open = (id && teams.find((t) => t.id === id)) || teams[0];
    setView(open ? { kind: "team", id: open.id } : { kind: "new" });
  }, [teams, view]);

  const openTeam = (team: BattleTeam) => {
    setView({ kind: "team", id: team.id });
    writeTeamParam(team.id);
  };
  const openOther = (kind: "new" | "import") => {
    setView({ kind });
    writeTeamParam(null);
  };

  async function randomTeam(format: BattleFormatId) {
    setRandom({ busy: true, error: null });
    try {
      const res = await fetch("/api/battle/random", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      const body = (await res.json().catch(() => ({}))) as { sets?: TeamSet[]; error?: string };
      if (!res.ok || !body.sets) throw new Error(body.error ?? "Couldn't deal a team.");
      openTeam(createTeam(format, `Random ${BATTLE_FORMATS[format].name}`, body.sets));
      setRandom({ busy: false, error: null });
    } catch (err) {
      setRandom({ busy: false, error: err instanceof Error ? err.message : "Couldn't deal a team." });
    }
  }

  const current = view?.kind === "team" ? teams?.find((t) => t.id === view.id) : undefined;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => openOther("new")} variant={view?.kind === "new" ? "default" : "secondary"}>
            <Plus className="h-4 w-4" aria-hidden /> New team
          </Button>
          <Button size="sm" onClick={() => openOther("import")} variant={view?.kind === "import" ? "default" : "outline"}>
            <FileInput className="h-4 w-4" aria-hidden /> Import
          </Button>
        </div>
        <TeamList teams={teams} activeId={current?.id} onOpen={openTeam} />
      </aside>

      <section className="min-w-0">
        {undo && (
          <div className="mb-3 flex items-center gap-3 rounded-md border border-foreground/15 bg-card px-3 py-2 text-sm" role="status" data-testid="undo-delete">
            <span className="min-w-0 flex-1 truncate">
              Deleted <b className="font-display">{undo.name || "Untitled team"}</b>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                restoreTeam(undo);
                openTeam(undo);
                setUndo(null);
              }}
            >
              <Undo2 className="h-4 w-4" aria-hidden /> Undo
            </Button>
          </div>
        )}
        {random.error && (
          <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {random.error}
          </p>
        )}
        {!teams || !view ? (
          <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading your teams…
          </p>
        ) : current ? (
          <TeamEditor
            key={current.id}
            team={current}
            onDuplicate={() => {
              const copy = duplicateTeam(current.id);
              if (copy) openTeam(copy);
            }}
            onDelete={() => {
              const removed = current;
              deleteTeam(removed.id);
              setUndo(removed);
              clearTimeout(undoTimer.current ?? undefined);
              undoTimer.current = setTimeout(() => setUndo(null), 10_000);
              const next = teams.find((t) => t.id !== removed.id);
              if (next) openTeam(next);
              else openOther("new");
            }}
            onRandom={randomTeam}
            randomBusy={random.busy}
          />
        ) : view.kind === "import" ? (
          <NewFromImport onCreate={openTeam} />
        ) : (
          <FormatPicker onPick={(format) => openTeam(createTeam(format))} onRandom={randomTeam} randomBusy={random.busy} />
        )}
      </section>
    </div>
  );
}

/** Saved teams in one folder per format (the open team's folder starts open), with a search over names and Pokémon. */
function TeamList({ teams, activeId, onOpen }: { teams: BattleTeam[] | null; activeId?: string; onOpen: (team: BattleTeam) => void }) {
  const sprite = useSpriteLookup();
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  const q = normalize(query);
  const folders = useMemo(() => {
    const matches = (t: BattleTeam) => !q || normalize(t.name).includes(q) || t.sets.some((s) => normalize(s.species).includes(q) || normalize(s.name).includes(q));
    return BATTLE_FORMAT_IDS.map((format) => ({ format, teams: (teams ?? []).filter((t) => t.format === format && matches(t)) })).filter((f) => f.teams.length > 0);
  }, [teams, q]);
  if (!teams) return null;
  if (!teams.length) {
    return <p className="rounded-lg border border-dashed border-foreground/15 p-4 text-sm text-muted-foreground">No teams yet. They save on this device as you build.</p>;
  }
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(teamsBackupText(teams ?? []));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard (insecure context): nothing to do.
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="hud-label">My teams · {teams.length}</p>
        <button type="button" onClick={copyAll} className="hud-label flex items-center gap-1 hover:text-foreground" title="Copy every team as a Showdown backup">
          {copied ? <Check className="h-3 w-3 text-success" aria-hidden /> : <ClipboardCopy className="h-3 w-3" aria-hidden />}
          {copied ? "Copied" : "Backup all"}
        </button>
      </div>
      {teams.length > 3 && (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teams or Pokémon"
            aria-label="Search teams"
            className={cn(inputClass, "h-8 pl-7 text-xs")}
          />
        </label>
      )}
      <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1" data-testid="team-folders">
        {folders.length === 0 && <p className="px-1 text-xs text-muted-foreground">No team matches.</p>}
        {folders.map(({ format, teams: list }) => {
          const isOpen = !!q || !closed.has(format);
          return (
            <section key={format} aria-label={`${BATTLE_FORMATS[format].name} teams`}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setClosed((prev) => {
                    const next = new Set(prev);
                    if (next.has(format)) next.delete(format);
                    else next.add(format);
                    return next;
                  })
                }
                className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-foreground/5"
              >
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} aria-hidden />
                <Folder className="h-3.5 w-3.5 shrink-0 text-screen" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-display text-xs font-bold uppercase tracking-wide">{BATTLE_FORMATS[format].name}</span>
                <span className="hud-label">{list.length}</span>
              </button>
              {isOpen && (
                <ul className="mt-1 space-y-1.5 pl-2">
                  {list.map((team) => (
                    <li key={team.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(team)}
                        data-selected={team.id === activeId}
                        className={cn(
                          "menu-item w-full rounded-lg border bg-card px-3 py-2 text-left hover:border-screen/50",
                          team.id === activeId && "border-screen/60 bg-screen/10"
                        )}
                      >
                        <span className="block truncate font-display text-sm font-bold uppercase tracking-wide">{team.name || "Untitled team"}</span>
                        <span className="mt-1 flex h-8 items-center">
                          {team.sets.map((s, i) => (
                            <BattleSprite key={i} species={sprite?.(s.species)} animated={false} size={32} className="-ml-1 first:ml-0" />
                          ))}
                          {team.sets.length === 0 && <span className="hud-label normal-case tracking-wider">Empty</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function FormatPicker({
  onPick,
  onRandom,
  randomBusy,
}: {
  onPick: (format: BattleFormatId) => void;
  onRandom: (format: BattleFormatId) => void;
  randomBusy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold uppercase tracking-wide">Pick a format</h2>
        <p className="text-sm text-muted-foreground">The format sets the rules your team is checked against: which Pokémon, moves and items are allowed.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {BATTLE_FORMAT_IDS.map((id, i) => {
          const f = BATTLE_FORMATS[id];
          return (
            <div key={id} className="group relative flex flex-col gap-2 rounded-lg border bg-card p-4 transition-colors hover:border-screen/50">
              <div className="flex items-baseline gap-2">
                <span className="hud-label">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-display text-lg font-bold uppercase tracking-wide">{f.name}</span>
                <span className="hud-label ml-auto text-screen">{f.gameType}</span>
              </div>
              <p className="flex-1 text-sm text-muted-foreground">{f.blurb}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onPick(id)} aria-label={`New ${f.name} team`}>
                  <Plus className="h-4 w-4" aria-hidden /> Build
                </Button>
                <Button size="sm" variant="outline" onClick={() => onRandom(id)} disabled={randomBusy} aria-label={`Random ${f.name} team`}>
                  <Shuffle className="h-4 w-4" aria-hidden /> Random
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewFromImport({ onCreate }: { onCreate: (team: BattleTeam) => void }) {
  const [format, setFormat] = useState<BattleFormatId>(DEFAULT_FORMAT);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold uppercase tracking-wide">Import a team</h2>
        <p className="text-sm text-muted-foreground">Paste a team from Pokémon Showdown&apos;s teambuilder (Import / Export, or a team backup).</p>
      </div>
      <label className="block w-56 space-y-1.5">
        <span className="hud-label block">Format</span>
        <select value={format} onChange={(e) => setFormat(e.target.value as BattleFormatId)} className="h-10 w-full rounded-md border-2 border-foreground/15 bg-shade/40 px-2.5 text-sm">
          {BATTLE_FORMAT_IDS.map((id) => (
            <option key={id} value={id}>
              {BATTLE_FORMATS[id].name}
            </option>
          ))}
        </select>
      </label>
      <ImportPanel
        confirmLabel="Import team"
        onImport={(sets, meta) => onCreate(createTeam(meta.format ?? format, meta.name ?? "Imported team", sets))}
        onImportMany={(teams) => {
          // Saved last to first, so the backup's order is the list's order; then the first one opens.
          const made = [...teams].reverse().map((t) => createTeam(t.format ?? format, t.name ?? "Imported team", t.sets));
          onCreate(made[made.length - 1]);
        }}
      />
    </div>
  );
}
