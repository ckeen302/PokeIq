"use client";

import { useState } from "react";
import { Check, ClipboardCopy, CopyPlus, FileInput, FileOutput, LoaderCircle, Plus, ShieldAlert, ShieldCheck, Shuffle, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BATTLE_FORMATS, BATTLE_FORMAT_IDS, isBattleFormatId, type BattleFormatId } from "@/lib/battle/formats";
import { exportShowdown, importShowdown, TEAM_SIZE, type TeamSet } from "@/lib/battle/sets";
import { saveTeam, type BattleTeam } from "@/lib/battle/teams";
import { cn } from "@/lib/utils";
import { BattleSprite } from "./BattleSprite";
import { inputClass } from "./controls";
import { useFormatDex, useSpriteLookup, useTeamCheck, type CheckState } from "./hooks";
import { SetEditor } from "./SetEditor";

type Panel = "import" | "export" | null;

export function TeamEditor({
  team,
  onDuplicate,
  onDelete,
  onRandom,
  randomBusy,
}: {
  team: BattleTeam;
  onDuplicate: () => void;
  onDelete: () => void;
  onRandom: (format: BattleFormatId) => void;
  randomBusy: boolean;
}) {
  const format = BATTLE_FORMATS[team.format];
  const { dex, error } = useFormatDex(team.format);
  const sprite = useSpriteLookup();
  const check = useTeamCheck(team.format, team.sets);
  const [slot, setSlot] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = (patch: Partial<BattleTeam>) => saveTeam({ ...team, ...patch });
  const setAt = (i: number, set: TeamSet | null) => {
    const sets = [...team.sets];
    if (set) sets[i] = set;
    else sets.splice(i, 1);
    save({ sets: sets.filter(Boolean) });
    if (!set) setSlot(Math.max(0, Math.min(i, sets.length - 1)));
  };

  const done = check.status === "done" ? check.check : check.status === "checking" ? check.last : null;
  const slotProblems = (i: number) => done?.sets[i] ?? [];

  async function copy() {
    try {
      await navigator.clipboard.writeText(exportShowdown(team.sets));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setPanel("export");
    }
  }

  return (
    <div className="space-y-4">
      {/* Name, format and verdict */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[12rem] flex-1 space-y-1.5">
          <span className="hud-label block">Team name</span>
          <input
            value={team.name}
            maxLength={60}
            onChange={(e) => save({ name: e.target.value })}
            className={cn(inputClass, "h-10 font-display text-base font-bold tracking-wide")}
          />
        </label>
        <label className="w-48 space-y-1.5">
          <span className="hud-label block">Format</span>
          <select value={team.format} onChange={(e) => isBattleFormatId(e.target.value) && save({ format: e.target.value })} className={cn(inputClass, "h-10")}>
            {BATTLE_FORMAT_IDS.map((id) => (
              <option key={id} value={id}>
                {BATTLE_FORMATS[id].name}
              </option>
            ))}
          </select>
        </label>
        <Verdict state={check} formatName={format.name} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={panel === "import" ? "secondary" : "outline"} onClick={() => setPanel(panel === "import" ? null : "import")}>
          <FileInput className="h-4 w-4" aria-hidden /> Import
        </Button>
        <Button size="sm" variant={panel === "export" ? "secondary" : "outline"} onClick={() => setPanel(panel === "export" ? null : "export")} disabled={!team.sets.length}>
          <FileOutput className="h-4 w-4" aria-hidden /> Export
        </Button>
        <Button size="sm" variant="outline" onClick={copy} disabled={!team.sets.length}>
          {copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <ClipboardCopy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onRandom(team.format)} disabled={randomBusy}>
          {randomBusy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Shuffle className="h-4 w-4" aria-hidden />} Random team
        </Button>
        <Button size="sm" variant="outline" onClick={onDuplicate}>
          <CopyPlus className="h-4 w-4" aria-hidden /> Duplicate
        </Button>
        {confirmDelete ? (
          <span className="flex items-center gap-1.5">
            <Button size="sm" variant="destructive" onClick={onDelete}>
              Delete team
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" aria-hidden /> Delete
          </Button>
        )}
      </div>

      {panel === "import" && (
        <ImportPanel
          confirmLabel="Replace this team"
          onImport={(sets, meta) => {
            save({ sets, name: meta.name ?? team.name, format: meta.format ?? team.format });
            setSlot(0);
            setPanel(null);
          }}
        />
      )}
      {panel === "export" && <ExportPanel text={exportShowdown(team.sets)} />}

      {done && done.team.length > 0 && (
        <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" aria-label="Team problems">
          {done.team.map((p) => (
            <li key={p} className="flex gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      )}

      {/* Slots */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="tablist" aria-label="Team slots">
        {Array.from({ length: TEAM_SIZE }, (_, i) => {
          const set = team.sets[i];
          const reachable = i <= team.sets.length;
          const bad = slotProblems(i).length > 0;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={slot === i}
              disabled={!reachable}
              onClick={() => setSlot(i)}
              className={cn(
                "relative flex flex-col items-center gap-0.5 rounded-lg border bg-card px-1 pb-1.5 pt-1 transition-colors disabled:opacity-35",
                slot === i ? "border-screen/70 bg-screen/10 shadow-[0_0_18px_-6px_hsl(var(--screen))]" : "hover:border-screen/40"
              )}
            >
              {bad && <span className="led absolute right-1.5 top-1.5 h-1.5 w-1.5 text-destructive" aria-label="has problems" />}
              {set ? (
                <>
                  <BattleSprite species={sprite?.(set.species)} shiny={set.shiny} animated={false} size={48} />
                  <span className="w-full truncate text-center font-display text-xs font-semibold">{set.name || set.species}</span>
                </>
              ) : (
                <>
                  <span className="flex h-12 w-12 items-center justify-center">
                    <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="hud-label">{reachable ? "Add" : "Empty"}</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div className="hud rounded-lg border bg-card p-4 sm:p-5">
        {dex ? (
          <SetEditor
            key={`${team.id}:${slot}`}
            dex={dex}
            set={team.sets[slot] ?? null}
            slot={slot}
            problems={slotProblems(slot)}
            onChange={(set) => setAt(slot, set)}
          />
        ) : error ? (
          <p className="py-10 text-center text-sm text-destructive">Couldn&apos;t load the Pokédex data. Check your connection and reload.</p>
        ) : (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading {format.name} data…
          </p>
        )}
      </div>
    </div>
  );
}

function Verdict({ state, formatName }: { state: CheckState; formatName: string }) {
  const base = "flex h-10 items-center gap-2 rounded-md border px-3 font-display text-sm font-semibold";
  if (state.status === "empty") {
    return <span className={cn(base, "text-muted-foreground")}>Add a Pokémon to start</span>;
  }
  if (state.status === "error") {
    return (
      <span className={cn(base, "border-warning/50 text-warning")} role="status">
        <ShieldAlert className="h-4 w-4" aria-hidden /> Couldn&apos;t check: {state.message}
      </span>
    );
  }
  if (state.status === "checking") {
    return (
      <span className={cn(base, "text-muted-foreground")} role="status">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Checking…
      </span>
    );
  }
  const problems = state.check.team.length + state.check.sets.reduce((n, p) => n + p.length, 0);
  return state.check.ok ? (
    <span className={cn(base, "border-success/50 bg-success/10 text-success")} role="status">
      <ShieldCheck className="h-4 w-4" aria-hidden /> Legal in {formatName}
    </span>
  ) : (
    <span className={cn(base, "border-destructive/50 bg-destructive/10 text-destructive")} role="status">
      <ShieldAlert className="h-4 w-4" aria-hidden /> {problems} problem{problems === 1 ? "" : "s"}
    </span>
  );
}

/** Paste a Showdown export; a "=== [format] Name ===" header picks the format and name. */
export function ImportPanel({
  confirmLabel,
  onImport,
}: {
  confirmLabel: string;
  onImport: (sets: TeamSet[], meta: { name?: string; format?: BattleFormatId }) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <label className="block space-y-1.5">
        <span className="hud-label block">Showdown team</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          rows={10}
          spellCheck={false}
          placeholder={"Garchomp @ Rocky Helmet\nAbility: Rough Skin\nTera Type: Steel\nEVs: 252 HP / 4 Def / 252 Spe\nJolly Nature\n- Stealth Rock\n- Earthquake"}
          className="w-full rounded-md border-2 border-foreground/15 bg-shade/40 p-3 font-mono text-xs leading-relaxed focus-visible:border-screen/70 focus-visible:outline-none"
        />
      </label>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            const imported = importShowdown(text);
            if (!imported) return setError("No Pokémon found. Paste a team exported from Showdown's teambuilder.");
            onImport(imported.sets, {
              name: imported.name?.slice(0, 60),
              format: isBattleFormatId(imported.format) ? imported.format : undefined,
            });
          }}
          disabled={!text.trim()}
        >
          <FileInput className="h-4 w-4" aria-hidden /> {confirmLabel}
        </Button>
        <span className="text-xs text-muted-foreground">Up to six Pokémon; anything after the sixth is left out.</span>
      </div>
    </div>
  );
}

function ExportPanel({ text }: { text: string }) {
  return (
    <label className="block space-y-1.5 rounded-lg border bg-card p-4">
      <span className="hud-label block">Showdown export</span>
      <textarea
        readOnly
        value={text}
        rows={12}
        onFocus={(e) => e.target.select()}
        className="w-full rounded-md border-2 border-foreground/15 bg-shade/40 p-3 font-mono text-xs leading-relaxed focus-visible:outline-none"
      />
    </label>
  );
}
