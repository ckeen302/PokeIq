"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PDK_FAMILIES, PDK_FAMILY_LABELS } from "@/lib/pikadoku/types";
import type { MasterCheck } from "@/lib/pikadoku/master";

interface Info {
  today: string;
  categories: { id: string; label: string; family: string; tier: number }[];
  scheduled: { date: string; rows: string[]; cols: string[]; by: string; seed: boolean }[];
}
const FIELD = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

async function call<T>(query: string | null, body?: unknown): Promise<T> {
  const res = await fetch(query === null ? "/api/admin" : `/api/admin?${query}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** Admin: build a Pikadoku Master grid from six categories, check it live, and schedule it for a future day. */
export function PikadokuMasterEditor() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<string[]>(["", "", ""]);
  const [cols, setCols] = useState<string[]>(["", "", ""]);
  const [date, setDate] = useState("");
  const [check, setCheck] = useState<MasterCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    call<Info>("tab=pikadoku")
      .then(setInfo)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const label = useMemo(() => new Map((info?.categories ?? []).map((c) => [c.id, c.label])), [info]);
  const filled = [...rows, ...cols].every(Boolean);

  // Validate live as the six categories are picked.
  useEffect(() => {
    if (!filled) {
      setCheck(null);
      return;
    }
    let live = true;
    call<{ check: MasterCheck }>(null, { action: "pdkCheck", rows, cols })
      .then((d) => live && setCheck(d.check))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [filled, rows, cols]);

  async function schedule() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await call(null, { action: "pdkSchedule", date, rows, cols });
      setSaved(`Scheduled for ${date}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function unschedule(d: string) {
    if (!window.confirm(`Remove the Master grid for ${d}? That day goes back to the generated grid.`)) return;
    try {
      await call(null, { action: "pdkUnschedule", date: d });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const picker = (value: string, set: (v: string) => void, name: string) => (
    <select className={FIELD} value={value} onChange={(e) => set(e.target.value)} aria-label={name} data-testid={`admin-pdk-${name.replace(/\s+/g, "-").toLowerCase()}`}>
      <option value="">{name}…</option>
      {PDK_FAMILIES.map((f) => (
        <optgroup key={f} label={PDK_FAMILY_LABELS[f]}>
          {(info?.categories ?? [])
            .filter((c) => c.family === f)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );

  if (!info) return error ? <p className="text-sm text-destructive">{error}</p> : <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" />;
  return (
    <div className="space-y-5" data-testid="admin-pikadoku">
      <p className="text-sm text-muted-foreground">
        Pick three row and three column categories. The grid is checked with the same solvability test as the generated dailies (every cell needs at least two valid Pokémon). On its date, the Normal daily uses it, shown as &ldquo;Master Puzzle by you&rdquo;. A day that has begun can&apos;t be changed.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="hud-label">Rows</p>
          {rows.map((r, i) => (
            <div key={i}>{picker(r, (v) => setRows(rows.map((x, j) => (j === i ? v : x))), `Row ${i + 1}`)}</div>
          ))}
        </div>
        <div className="space-y-2">
          <p className="hud-label">Columns</p>
          {cols.map((c, i) => (
            <div key={i}>{picker(c, (v) => setCols(cols.map((x, j) => (j === i ? v : x))), `Column ${i + 1}`)}</div>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="space-y-2" data-testid="admin-pdk-check">
        {check?.counts && (
          <div className="grid max-w-md grid-cols-[minmax(4rem,1fr)_repeat(3,minmax(0,1fr))] gap-1 text-center text-xs">
            <div />
            {cols.map((c) => (
              <div key={c} className="font-semibold">
                {label.get(c)}
              </div>
            ))}
            {[0, 1, 2].flatMap((r) => [
              <div key={`r${r}`} className="self-center font-semibold">
                {label.get(rows[r])}
              </div>,
              ...[0, 1, 2].map((c) => {
                const n = check.counts![r * 3 + c];
                return (
                  <div key={c} data-testid={`admin-pdk-count-${r * 3 + c}`} className={`rounded border p-2 text-base font-bold tabular-nums ${n === 0 ? "border-destructive bg-destructive/10" : n === 1 ? "border-warning bg-warning/10" : "border-foreground/15"}`}>
                    {n}
                  </div>
                );
              }),
            ])}
          </div>
        )}
        {check && (check.ok ? <p className="text-sm text-success">Solvable: nine different Pokémon can fill it.</p> : check.errors.map((e) => <p key={e} className="text-sm text-destructive">{e}</p>))}
        {!filled && <p className="text-sm text-muted-foreground">Pick all six categories to check the grid.</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block font-semibold">Date (UTC)</span>
          <input type="date" min={info.today} value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} data-testid="admin-pdk-date" />
        </label>
        <Button type="button" onClick={() => void schedule()} disabled={busy || !check?.ok || !date || date <= info.today} data-testid="admin-pdk-save">
          Schedule Master daily
        </Button>
        {saved && <span className="text-sm text-success">{saved}</span>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <p className="hud-label">Scheduled</p>
        {info.scheduled.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10 text-sm">
          {info.scheduled.map((s) => (
            <li key={s.date} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <b className="tabular-nums">{s.date}</b>
              <span className="min-w-0 flex-1 text-muted-foreground">
                {s.rows.map((r) => label.get(r) ?? r).join(", ")} × {s.cols.map((c) => label.get(c) ?? c).join(", ")} · by {s.by}
                {s.seed && " (built in)"}
              </span>
              {!s.seed && s.date > info.today && (
                <Button type="button" size="sm" variant="ghost" onClick={() => void unschedule(s.date)}>
                  Remove
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => (setRows(s.rows), setCols(s.cols), setDate(s.seed || s.date <= info.today ? "" : s.date))}>
                Load
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
