"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, RotateCcw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEEDBACK_CATEGORIES, FEEDBACK_MODES, MUTE_DURATIONS, PERMANENT, type AuditEntry, type ReportRow, type Sanction } from "@/lib/moderation";
import { ROOMS, SLOW_MODES, type RoomMessage } from "@/lib/rooms";
import type { TournamentSummary } from "@/lib/tournaments";
import { cn } from "@/lib/utils";
import { pictureSrc, type PendingPicture } from "@/lib/avatar";
import { GEO_HIDE_THRESHOLD, GEO_REPORT_REASONS, type GeoReportReason, type GeoShotReview } from "@/lib/geo-reports";

const TABS = ["reports", "shots", "users", "rooms", "tournaments", "avatars", "audit"] as const;
type Tab = (typeof TABS)[number];
const FIELD = "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const when = (at: number) => new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

async function api<T>(query: string | null, body?: unknown): Promise<T> {
  const res = await fetch(query === null ? "/api/admin" : `/api/admin?${query}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** The moderation desk: reports, users, rooms, tournaments and the audit log. */
export function AdminPanel() {
  const [tab, setTab] = useState<Tab>("reports");
  // Pictures waiting for review, counted on the tab from the start.
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    api<{ count: number }>("tab=avatars")
      .then((d) => setPending(d.count))
      .catch(() => undefined);
  }, []);
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-2 border-b pb-2">
        {TABS.map((t) => (
          <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "default" : "ghost"} onClick={() => setTab(t)} data-testid={`admin-tab-${t}`}>
            {t[0].toUpperCase() + t.slice(1)}
            {t === "avatars" && !!pending && (
              <span className="rounded-full bg-warning px-1.5 font-pixel text-[9px] text-black" data-testid="admin-avatars-count">
                {pending}
              </span>
            )}
          </Button>
        ))}
      </div>
      {tab === "reports" && <Reports />}
      {tab === "shots" && <Shots />}
      {tab === "users" && <Users />}
      {tab === "rooms" && <Rooms />}
      {tab === "tournaments" && <Tournaments />}
      {tab === "avatars" && <Avatars onCount={setPending} />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const latest = useRef(0);
  const reload = useCallback(() => {
    setError(null);
    // Only the latest request counts: an older answer arriving late is dropped.
    const n = ++latest.current;
    run()
      .then((d) => n === latest.current && setData(d))
      .catch((err: Error) => n === latest.current && setError(err.message));
  }, [run]);
  useEffect(reload, [reload]);
  return { data, error, reload, setError };
}

function Reports() {
  const [kind, setKind] = useState("");
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState("open");
  const q = new URLSearchParams({ tab: "reports", kind, category, mode, status }).toString();
  const { data, error, reload, setError } = useLoad(() => api<{ reports: ReportRow[]; stored: boolean }>(q), [q]);
  // Filters changed: don't show the old list while the new one loads.
  const [shownQ, setShownQ] = useState(q);
  useEffect(() => {
    if (data) setShownQ(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const fresh = shownQ === q;

  async function resolve(id: number, resolved: boolean) {
    try {
      await api(null, { action: "resolve", id, resolved });
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">All kinds</option>
          <option value="chat">Chat reports</option>
          <option value="feedback">Feedback</option>
          <option value="error">Errors</option>
        </select>
        <select className={FIELD} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">Any category</option>
          {FEEDBACK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className={FIELD} value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode">
          <option value="">Any mode</option>
          {Object.entries(FEEDBACK_MODES).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select className={FIELD} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && !data.stored && <p className="text-sm text-muted-foreground">Reports aren&apos;t stored on this server (no database).</p>}
      {data?.reports.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
      <ul className={cn("space-y-2", !fresh && "opacity-50")} data-testid="admin-reports" aria-busy={!fresh}>
        {data?.reports.map((r) => (
          <li key={r.id} className={cn("hud space-y-1 rounded-lg border bg-card p-3 text-sm", r.resolvedAt && "opacity-60")} data-testid="admin-report">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn("rounded px-1.5 py-0.5 font-semibold uppercase", r.kind === "chat" ? "bg-destructive/20 text-destructive" : r.kind === "error" ? "bg-warning/20 text-warning" : "bg-primary/20 text-primary")}>{r.kind}</span>
              {r.category && <span className="rounded border px-1.5 py-0.5">{r.category}</span>}
              {r.mode && <span className="rounded border px-1.5 py-0.5">{FEEDBACK_MODES[r.mode as keyof typeof FEEDBACK_MODES] ?? r.mode}</span>}
              <span className="text-muted-foreground">#{r.id} · {when(r.createdAt)}</span>
              {r.reporter && <span className="text-muted-foreground">from {r.reporter}</span>}
              {r.page && <span className="font-mono text-muted-foreground">{r.page}</span>}
              <span className="ml-auto">
                {r.resolvedAt ? (
                  <Button size="sm" variant="ghost" onClick={() => void resolve(r.id, false)}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reopen
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void resolve(r.id, true)} data-testid="admin-resolve">
                    <Check className="h-3.5 w-3.5" aria-hidden /> Resolve
                  </Button>
                )}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words">{r.message}</p>
            {r.contact && <p className="text-xs text-muted-foreground">Contact: {r.contact}</p>}
            <Extra extra={r.extra} />
            {r.resolvedBy && <p className="text-xs text-muted-foreground">Resolved by {r.resolvedBy}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A report's details: a chat report's context, a bug's recent errors, an error's stack. */
function Extra({ extra }: { extra: Record<string, unknown> | null }) {
  if (!extra) return null;
  const context = Array.isArray(extra.context) ? (extra.context as { id: number; name: string; text: string }[]) : null;
  const errors = Array.isArray(extra.recentErrors) ? (extra.recentErrors as { message: string }[]) : null;
  const chat = extra.chat as { name?: string; code?: string; game?: string } | undefined;
  return (
    <div className="space-y-1 text-xs">
      {chat && (
        <p className="text-muted-foreground">
          Reported trainer: <span className="font-semibold text-foreground">{chat.name}</span> in {chat.game} {chat.code}
        </p>
      )}
      {context && (
        <div className="rounded border bg-background p-2 font-mono">
          {context.map((l) => (
            <p key={l.id} className={cn(chat && l.name === chat.name && "text-destructive")}>
              {l.name}: {l.text}
            </p>
          ))}
        </div>
      )}
      {errors && errors.length > 0 && (
        <div className="rounded border bg-background p-2 font-mono">
          {errors.map((e, i) => (
            <p key={i}>{e.message}</p>
          ))}
        </div>
      )}
      {typeof extra.stack === "string" && <pre className="max-h-40 overflow-auto rounded border bg-background p-2">{extra.stack}</pre>}
    </div>
  );
}

function sanctionText(s: Sanction | null): string {
  if (!s) return "No sanctions.";
  const parts: string[] = [];
  if (s.banned) parts.push(`Banned${s.banReason ? ` (${s.banReason})` : ""}`);
  if (s.mutedUntil && s.mutedUntil > Date.now()) parts.push(s.mutedUntil >= PERMANENT ? "Muted permanently" : `Muted until ${when(s.mutedUntil)}`);
  return parts.length ? `${parts.join(". ")}. Last change by ${s.updatedBy}, ${when(s.updatedAt)}.` : "No sanctions.";
}

function Users() {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ user: { username: string; createdAt: string }; sanction: Sanction | null } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(name = query) {
    setError(null);
    try {
      setFound(await api(`tab=user&name=${encodeURIComponent(name.trim())}`));
    } catch (err) {
      setFound(null);
      setError((err as Error).message);
    }
  }

  async function act(body: Record<string, unknown>) {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      await api(null, { name: found.user.username, ...body });
      await lookup(found.user.username);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <input className={cn(FIELD, "flex-1")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Trainer name" aria-label="Trainer name" data-testid="admin-user-query" />
        <Button type="submit" size="sm">
          <Search className="h-4 w-4" aria-hidden /> Look up
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {found && (
        <div className="hud space-y-3 rounded-lg border bg-card p-4 text-sm" data-testid="admin-user">
          <p>
            <Link href={`/u/${found.user.username}`} className="font-display text-xl font-bold hover:underline">
              {found.user.username}
            </Link>{" "}
            <span className="text-xs text-muted-foreground">joined {new Date(found.user.createdAt).toLocaleDateString()}</span>
          </p>
          <p data-testid="admin-sanction">{sanctionText(found.sanction)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hud-label">Mute</span>
            {Object.keys(MUTE_DURATIONS).map((d) => (
              <Button key={d} size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "mute", duration: d })} data-testid={`admin-mute-${d}`}>
                {d}
              </Button>
            ))}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: "unmute" })}>
              Unmute
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className={cn(FIELD, "flex-1")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the ban" aria-label="Ban reason" maxLength={200} />
            <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => void act({ action: "ban", reason })}>
              Ban
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: "unban" })}>
              Unban
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">A mute stops chat and room posting. A ban also stops PvP battles, duels, tournaments and friend requests.</p>
        </div>
      )}
    </div>
  );
}

function Rooms() {
  const [room, setRoom] = useState(ROOMS[0].id);
  const { data, error, reload, setError } = useLoad(() => api<{ slow: number; messages: RoomMessage[] }>(`tab=rooms&room=${room}`), [room]);

  async function act(body: Record<string, unknown>) {
    try {
      await api(null, { room, ...body });
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={FIELD} value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Room">
          {ROOMS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          Slow mode
          <select className={FIELD} value={data?.slow ?? 0} onChange={(e) => void act({ action: "slow", seconds: Number(e.target.value) })} aria-label="Slow mode">
            {SLOW_MODES.map((s) => (
              <option key={s} value={s}>
                {s ? `${s}s` : "Off"}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="destructive" className="ml-auto" onClick={() => window.confirm("Delete every message in this room?") && void act({ action: "clearRoom" })}>
          Clear room
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="divide-y rounded-lg border bg-card text-sm" data-testid="admin-room-messages">
        {data?.messages.length === 0 && <li className="p-3 text-muted-foreground">No messages.</li>}
        {data?.messages.map((m) => (
          <li key={m.id} className="flex items-baseline gap-2 px-3 py-1.5">
            <span className="text-[10px] tabular-nums text-muted-foreground">{when(m.at)}</span>
            <span className="min-w-0 flex-1 break-words">
              <span className="font-semibold">{m.name}</span>: {m.text}
            </span>
            <button type="button" aria-label="Delete message" title="Delete message" className="text-muted-foreground hover:text-destructive" onClick={() => void act({ action: "deleteMessage", id: m.id })}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tournaments() {
  const { data, error, reload, setError } = useLoad(() => api<{ active: TournamentSummary[] }>("tab=tournaments"), []);
  const [dq, setDq] = useState<Record<string, string>>({});

  async function act(body: Record<string, unknown>) {
    try {
      await api(null, body);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="max-w-3xl space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.active.length === 0 && <p className="text-sm text-muted-foreground">No open or running tournaments.</p>}
      <ul className="space-y-2">
        {data?.active.map((t) => (
          <li key={t.id} className="hud flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm">
            <Link href={`/battle/tournaments/${t.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
              {t.title}
            </Link>
            <span className="text-xs text-muted-foreground">
              {t.status} · {t.players}/{t.maxPlayers}
            </span>
            <input className={cn(FIELD, "w-36")} placeholder="Trainer to DQ" aria-label="Trainer to disqualify" value={dq[t.id] ?? ""} onChange={(e) => setDq({ ...dq, [t.id]: e.target.value })} />
            <Button size="sm" variant="outline" disabled={!dq[t.id]?.trim()} onClick={() => void act({ action: "dq", id: t.id, name: dq[t.id].trim() })}>
              Disqualify
            </Button>
            <Button size="sm" variant="destructive" onClick={() => window.confirm("Cancel this tournament?") && void act({ action: "cancelTournament", id: t.id })}>
              Cancel
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Avatars({ onCount }: { onCount: (n: number) => void }) {
  const { data, error, reload, setError } = useLoad(() => api<{ open: boolean; pending: PendingPicture[]; count: number }>("tab=avatars"), []);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (data) onCount(data.count);
  }, [data, onCount]);

  async function decide(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      await api(null, { id, ...body });
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />;
  if (!data.open) return <p className="text-sm text-muted-foreground">Picture uploads are off until migration 0021 and the avatars bucket are in place.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {data.count} picture{data.count === 1 ? "" : "s"} waiting for review. Nobody else sees a picture until it&apos;s approved. Three strikes stop a trainer uploading.
      </p>
      {data.pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to review.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="admin-avatars">
          {data.pending.map((p) => (
            <li key={p.id} className="space-y-2 rounded-lg border bg-card p-3 text-sm" data-testid="admin-avatar">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pictureSrc(p.id, true)} alt={`Picture from ${p.username}`} width={256} height={256} loading="lazy" className="aspect-square w-full rounded-md bg-muted object-cover" />
              <p className="truncate font-semibold">{p.username}</p>
              <p className="text-xs text-muted-foreground">{when(p.at)}</p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="success" disabled={busy === p.id} onClick={() => void decide(p.id, { action: "approvePicture" })} data-testid="admin-avatar-approve">
                  <Check className="h-3.5 w-3.5" aria-hidden /> Approve
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => void decide(p.id, { action: "rejectPicture", strike: false })}>
                  Reject
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === p.id} onClick={() => void decide(p.id, { action: "rejectPicture", strike: true })}>
                  Reject + strike
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** PokéGuessr screenshots players reported: keep one (its reports are cleared) or remove it from rotation. */
function Shots() {
  const [status, setStatus] = useState("open");
  const { data, error, reload, setError } = useLoad(() => api<{ shots: GeoShotReview[]; stored: boolean }>(`tab=shots&status=${status}`), [status]);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(shot: string, action: "keepShot" | "removeShot") {
    setBusy(shot);
    try {
      await api(null, { action, shot });
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={FIELD} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="open">Waiting for review</option>
          <option value="kept">Kept</option>
          <option value="removed">Removed</option>
          <option value="all">All</option>
        </select>
        <p className="text-xs text-muted-foreground">
          {GEO_HIDE_THRESHOLD} distinct reporters take a screenshot out of rotation until it&apos;s reviewed. Keep clears its reports; Remove keeps it out (drop it from the data in the next import).
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && !data.stored && <p className="text-sm text-muted-foreground">Screenshot reports aren&apos;t stored on this server (no database).</p>}
      {data?.shots.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
      <ul className="grid gap-3 lg:grid-cols-2" data-testid="admin-shots">
        {data?.shots.map((s) => (
          <li key={s.shot} className="hud space-y-2 rounded-lg border bg-card p-3 text-sm" data-testid="admin-shot">
            {/* eslint-disable-next-line @next/next/no-img-element -- the game's own CDN-cached screenshot */}
            <img src={s.src} alt={s.place ?? s.shot} loading="lazy" className="aspect-video w-full rounded-md bg-black object-contain" />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-foreground">{s.place ?? "Not in the data any more"}</span>
              {s.game && <span className="rounded border px-1.5 py-0.5">{s.game}</span>}
              {s.hidden && <span className="rounded bg-destructive/20 px-1.5 py-0.5 font-semibold uppercase text-destructive">Out of rotation</span>}
              <span className="text-muted-foreground">
                {s.reporters} reporter{s.reporters === 1 ? "" : "s"} · {s.modes.join(", ")} · {when(s.last)}
              </span>
              <span className="font-mono text-muted-foreground">{s.shot}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {Object.entries(s.reasons).map(([reason, n]) => (
                <span key={reason} className="rounded bg-primary/15 px-1.5 py-0.5">
                  {GEO_REPORT_REASONS[reason as GeoReportReason]} ×{n}
                </span>
              ))}
            </div>
            {s.notes.length > 0 && (
              <ul className="space-y-0.5 rounded border bg-background p-2 text-xs">
                {s.notes.map((n, i) => (
                  <li key={i} className="break-words">
                    “{n}”
                  </li>
                ))}
              </ul>
            )}
            {s.status === "open" ? (
              <div className="flex gap-2">
                <Button size="sm" variant="success" disabled={busy === s.shot} onClick={() => void decide(s.shot, "keepShot")} data-testid="admin-shot-keep">
                  <Check className="h-3.5 w-3.5" aria-hidden /> Keep
                </Button>
                <Button size="sm" variant="destructive" disabled={busy === s.shot} onClick={() => void decide(s.shot, "removeShot")} data-testid="admin-shot-remove">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{s.status === "kept" ? "Kept" : "Removed"}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Audit() {
  const { data, error } = useLoad(() => api<{ entries: AuditEntry[] }>("tab=audit"), []);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />;
  return (
    <table className="w-full rounded-lg border bg-card text-sm" data-testid="admin-audit">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="px-3 py-2">When</th>
          <th className="px-3 py-2">Moderator</th>
          <th className="px-3 py-2">Action</th>
          <th className="px-3 py-2">Target</th>
          <th className="px-3 py-2">Detail</th>
        </tr>
      </thead>
      <tbody>
        {data.entries.map((e) => (
          <tr key={e.id} className="border-t">
            <td className="px-3 py-1.5 tabular-nums">{when(e.at)}</td>
            <td className="px-3 py-1.5">{e.admin}</td>
            <td className="px-3 py-1.5">{e.action}</td>
            <td className="px-3 py-1.5">{e.target}</td>
            <td className="px-3 py-1.5 text-muted-foreground">{e.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
