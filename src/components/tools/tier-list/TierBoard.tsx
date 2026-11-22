"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Settings2, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import tierList from "@/messages/tier-list";
import { TIER_COLORS, type TierRow } from "@/lib/tier-list/state";
import type { ArtStyle } from "@/lib/tier-list/art";
import type { Mon } from "@/lib/tier-list/types";
import { Tile } from "./Tile";
import { Field, Modal, PillButton } from "./ui";

interface Props {
  rows: TierRow[];
  byKey: ReadonlyMap<string, Mon>;
  art: ArtStyle;
  shiny: boolean;
  tile: number;
  names: boolean;
  selected: ReadonlySet<string>;
  moving: ReadonlySet<string>;
  /** Something is selected and waiting for a tier (tap-then-tap). */
  placing: boolean;
  onTileDown(e: React.PointerEvent<HTMLElement>, key: string, from: string): void;
  onTileClick(e: React.MouseEvent<HTMLElement>, key: string, from: string): void;
  onTileDouble(key: string, from: string): void;
  onPlace(rowId: string): void;
  onRename(rowId: string, label: string): void;
  onRenameStart(): void;
  onRenameEnd(): void;
  onColor(rowId: string, color: string): void;
  onMove(rowId: string, delta: number): void;
  onAdd(after?: string, before?: boolean): void;
  onRemove(rowId: string): void;
  onClear(rowId: string): void;
}

/** Readable text on a tier's colour: dark ink on light colours, white on dark ones. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.3 ? "#16131f" : "#ffffff";
}

/** The tiers: a coloured label on the left (click to edit), the row's Pokémon on the right (a drop zone). */
export function TierBoard(p: Props) {
  const t = useT(tierList);
  const [editing, setEditing] = useState<string | null>(null);
  const row = p.rows.find((r) => r.id === editing);
  const labelW = p.tile >= 96 ? 104 : 88;
  return (
    <div className="space-y-1.5" data-testid="tier-board" role="list" aria-label={t("tier.board")}>
      {p.rows.map((r, i) => (
        <div key={r.id} role="listitem" className="group flex min-h-0 overflow-hidden rounded-2xl bg-foreground/[0.035]" data-testid="tier-row" data-row={r.id}>
          <button
            type="button"
            onClick={() => (p.placing ? p.onPlace(r.id) : setEditing(r.id))}
            className="relative flex shrink-0 items-center justify-center px-2 text-center font-display font-bold leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-sm:!w-[64px]"
            style={{ width: labelW, minHeight: p.tile + 12, background: r.color, color: inkOn(r.color) }}
            aria-label={p.placing ? t("tier.placeHere", { label: r.label || t("tier.unnamed") }) : t("tier.edit", { label: r.label || t("tier.unnamed") })}
            data-testid="tier-label"
          >
            <span className={cn("break-words [overflow-wrap:anywhere]", r.label.length > 3 ? "text-[15px] max-sm:text-[13px]" : "text-[30px] max-sm:text-[24px]")}>{r.label}</span>
            {i < 9 && <span className="absolute bottom-1 left-1.5 font-display text-[12px] font-semibold opacity-55 max-md:hidden" aria-hidden>{i + 1}</span>}
          </button>
          <div
            className={cn("flex min-w-0 flex-1 flex-wrap content-start items-start gap-1.5 p-1.5 transition-colors", p.placing && "cursor-pointer hover:bg-screen/[0.06]")}
            style={{ minHeight: p.tile + 12 }}
            data-drop={`row:${r.id}`}
            data-drop-kind="list"
            data-testid="tier-items"
            onClick={(e) => p.placing && e.target === e.currentTarget && p.onPlace(r.id)}
          >
            {r.items.map((k) => {
              const m = p.byKey.get(k);
              if (!m) return null;
              return (
                <Tile
                  key={k}
                  mon={m}
                  art={p.art}
                  shiny={p.shiny}
                  size={p.tile}
                  from={`row:${r.id}`}
                  names={p.names}
                  selected={p.selected.has(k)}
                  moving={p.moving.has(k)}
                  onPointerDown={p.onTileDown}
                  onClick={p.onTileClick}
                  onDoubleClick={p.onTileDouble}
                />
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setEditing(r.id)}
            className="flex w-9 shrink-0 items-center justify-center text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100 max-sm:w-8"
            aria-label={t("tier.edit", { label: r.label || t("tier.unnamed") })}
            data-testid="tier-settings"
          >
            <Settings2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => p.onAdd()}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-foreground/[0.12] text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
        data-testid="tier-add-row"
      >
        <Plus className="h-4 w-4" aria-hidden /> {t("tier.addRow")}
      </button>
      {row && (
        <RowEditor
          row={row}
          index={p.rows.indexOf(row)}
          count={p.rows.length}
          onClose={() => setEditing(null)}
          onRename={(v) => p.onRename(row.id, v)}
          onRenameStart={p.onRenameStart}
          onRenameEnd={p.onRenameEnd}
          onColor={(c) => p.onColor(row.id, c)}
          onMove={(d) => p.onMove(row.id, d)}
          onAdd={(before) => p.onAdd(row.id, before)}
          onRemove={() => (p.onRemove(row.id), setEditing(null))}
          onClear={() => p.onClear(row.id)}
        />
      )}
    </div>
  );
}

function RowEditor({ row, index, count, onClose, onRename, onRenameStart, onRenameEnd, onColor, onMove, onAdd, onRemove, onClear }: {
  row: TierRow;
  index: number;
  count: number;
  onClose(): void;
  onRename(v: string): void;
  onRenameStart(): void;
  onRenameEnd(): void;
  onColor(c: string): void;
  onMove(d: number): void;
  onAdd(before: boolean): void;
  onRemove(): void;
  onClear(): void;
}) {
  const t = useT(tierList);
  return (
    <Modal title={t("tier.editTitle")} onClose={onClose} closeLabel={t("close")} testId="tier-editor">
      <form className="space-y-5" onSubmit={(e) => (e.preventDefault(), onClose())}>
        <Field label={t("tier.name")}>
          <input
            value={row.label}
            onChange={(e) => onRename(e.target.value.slice(0, 40))}
            onFocus={onRenameStart}
            onBlur={onRenameEnd}
            className="h-12 w-full rounded-xl bg-foreground/[0.06] px-4 font-display text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={40}
            aria-label={t("tier.name")}
            data-testid="tier-name"
          />
        </Field>
        <Field label={t("tier.colour")}>
          <div className="flex flex-wrap gap-2">
            {TIER_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => onColor(c)}
                aria-label={t("tier.colourN", { n: i + 1 })}
                aria-pressed={row.color === c}
                className={cn("h-9 w-9 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card", row.color === c && "ring-2 ring-foreground ring-offset-2 ring-offset-card")}
                style={{ background: c }}
                data-testid="tier-colour"
              />
            ))}
            <label className="relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-foreground/25 text-muted-foreground hover:text-foreground" title={t("tier.colour")}>
              <Plus className="h-4 w-4" aria-hidden />
              <input type="color" value={row.color} onChange={(e) => onColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={t("tier.colour")} />
            </label>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <PillButton onClick={() => onMove(-1)} disabled={index === 0}>
            <ArrowUp className="h-4 w-4" aria-hidden /> {t("tier.moveUp")}
          </PillButton>
          <PillButton onClick={() => onMove(1)} disabled={index === count - 1}>
            <ArrowDown className="h-4 w-4" aria-hidden /> {t("tier.moveDown")}
          </PillButton>
          <PillButton onClick={() => onAdd(true)}>
            <Plus className="h-4 w-4" aria-hidden /> {t("tier.addAbove")}
          </PillButton>
          <PillButton onClick={() => onAdd(false)}>
            <Plus className="h-4 w-4" aria-hidden /> {t("tier.addBelow")}
          </PillButton>
          <PillButton onClick={onClear} disabled={!row.items.length}>
            <Undo2 className="h-4 w-4" aria-hidden /> {t("tier.clear")}
          </PillButton>
          <PillButton onClick={onRemove} disabled={count <= 1} className="text-destructive" testId="tier-remove">
            <Trash2 className="h-4 w-4" aria-hidden /> {t("tier.remove")}
          </PillButton>
        </div>
        <PillButton type="submit" primary className="w-full">
          {t("pool.done")}
        </PillButton>
      </form>
    </Modal>
  );
}
