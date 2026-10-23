import "server-only";
import seedFile from "@/data/pikadoku-master.json";
import { getServiceSupabase } from "@/lib/supabase";
import { MASTER_DATE_RE, checkMaster, type MasterGrid } from "@/lib/pikadoku/master";

/**
 * Curated Master dailies. The committed seeds (src/data/pikadoku-master.json)
 * always apply; grids an admin schedules are stored in `pikadoku_curated`
 * (migration 0033: RLS on, no grants, server only) and win over a seed for the
 * same date. Without the table (before the migration, or no database) the
 * seeds still work and any other day just uses the generated grid.
 *
 * A date that has already begun (today UTC or earlier) can't be scheduled, so
 * a grid that has been played never changes.
 */

const SEEDS = (seedFile as MasterGrid[]).filter((g) => MASTER_DATE_RE.test(g.date) && checkMaster(g.rows, g.cols).ok);

export interface MasterStore {
  list(): Promise<MasterGrid[] | null>;
  save(g: MasterGrid): Promise<boolean>;
  remove(date: string): Promise<boolean>;
}

const g = globalThis as unknown as { __pokeiqMaster?: Map<string, MasterGrid> };
export function memoryMasterStore(): MasterStore {
  const m = (g.__pokeiqMaster ??= new Map());
  return {
    async list() {
      return [...m.values()];
    },
    async save(x) {
      m.set(x.date, x);
      return true;
    },
    async remove(date) {
      return m.delete(date);
    },
  };
}
export function clearMemoryMaster() {
  g.__pokeiqMaster = undefined;
  loaded = { at: 0, byDate: new Map() };
}

const MISSING = new Set(["42P01", "PGRST205"]);
export function supabaseMasterStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): MasterStore {
  return {
    async list() {
      const { data, error } = await sb.from("pikadoku_curated").select("puzzle_date, rows, cols, author").limit(1000);
      if (error) {
        if (MISSING.has(error.code ?? "")) return null;
        throw new Error(error.message);
      }
      return (data as { puzzle_date: string; rows: string[]; cols: string[]; author: string }[]).map((r) => ({ date: r.puzzle_date, rows: r.rows, cols: r.cols, by: r.author }));
    },
    async save(x) {
      const { error } = await sb.from("pikadoku_curated").upsert({ puzzle_date: x.date, rows: x.rows, cols: x.cols, author: x.by });
      if (error) {
        if (MISSING.has(error.code ?? "")) return false;
        throw new Error(error.message);
      }
      return true;
    },
    async remove(date) {
      const { error } = await sb.from("pikadoku_curated").delete().eq("puzzle_date", date);
      if (error && !MISSING.has(error.code ?? "")) throw new Error(error.message);
      return !error;
    },
  };
}

export function masterStore(): MasterStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryMasterStore();
  const sb = getServiceSupabase();
  return sb ? supabaseMasterStore(sb) : null;
}

const TTL_MS = 60_000;
let loaded: { at: number; byDate: Map<string, MasterGrid> } = { at: 0, byDate: new Map() };

/** Loads the scheduled grids (at most once a minute). Call before reading a day's grid; never throws. */
export async function ensureMaster(now = Date.now()): Promise<void> {
  if (now - loaded.at < TTL_MS) return;
  const store = masterStore();
  let rows: MasterGrid[] | null = null;
  try {
    rows = (await store?.list()) ?? null;
  } catch (err) {
    console.error("[pikadoku] curated grids unavailable:", err);
  }
  loaded = { at: now, byDate: new Map((rows ?? []).filter((r) => checkMaster(r.rows, r.cols).ok).map((r) => [r.date, r])) };
}

/** Forces the next read to reload the scheduled grids. */
export function refreshMaster() {
  loaded.at = 0;
}

/** The curated grid for a date (an admin's, else a seed), or null. */
export function masterFor(date: string): MasterGrid | null {
  return loaded.byDate.get(date) ?? SEEDS.find((s) => s.date === date) ?? null;
}

/** Every curated grid we know of, soonest first (admin entries replace seeds of the same date). */
export function allMasters(): { grid: MasterGrid; seed: boolean }[] {
  const out = new Map<string, { grid: MasterGrid; seed: boolean }>();
  for (const s of SEEDS) out.set(s.date, { grid: s, seed: true });
  for (const [d, grid] of loaded.byDate) out.set(d, { grid, seed: false });
  return [...out.values()].sort((a, b) => a.grid.date.localeCompare(b.grid.date));
}

/** Schedules a grid for a future UTC date; a day that has begun can't change. */
export async function scheduleMaster(grid: MasterGrid, now = Date.now()): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!MASTER_DATE_RE.test(grid.date) || Number.isNaN(Date.parse(grid.date))) return { ok: false, error: "Pick a date.", status: 400 };
  if (grid.date <= new Date(now).toISOString().slice(0, 10)) return { ok: false, error: "That day has already begun: pick a later date.", status: 409 };
  const check = checkMaster(grid.rows, grid.cols);
  if (!check.ok) return { ok: false, error: check.errors[0], status: 400 };
  const store = masterStore();
  if (!store || !(await store.save(grid))) return { ok: false, error: "Curated grids need migration 0033: run it in Supabase first.", status: 503 };
  loaded.at = 0;
  return { ok: true };
}

export async function unscheduleMaster(date: string, now = Date.now()): Promise<boolean> {
  if (date <= new Date(now).toISOString().slice(0, 10)) return false;
  const ok = (await masterStore()?.remove(date)) ?? false;
  loaded.at = 0;
  return ok;
}
