"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Flag, Loader2, MessageSquareOff, Send, Timer, Users, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { subscribeRoom } from "@/lib/rooms-client";
import { CHAT_MAX } from "@/lib/chat";
import { ROOM_KEPT, ROOM_POLL_MS, ROOM_USERS_MS, type RoomEvent, type RoomMessage, type RoomState } from "@/lib/rooms";
import { cn } from "@/lib/utils";

/**
 * A chat room: the last 100 messages (plain text, every one checked on the
 * server), who's here (from presence), and the box to post in for
 * signed-in trainers. New messages arrive over Supabase Realtime when it's
 * set up (signed by the server, see rooms-client), otherwise by polling
 * every 5 s while the tab is visible. Each trainer can mute others (on this
 * device), turn chat off and report a message.
 */

const OFF_KEY = "pokeiq:chat-off";
const MUTED_KEY = "pokeiq:room-muted";

function readList(key: string): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function RoomChat({ room }: { room: string }) {
  const account = useAccount();
  const me = account.user?.username ?? null;
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [slow, setSlow] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "off">("loading");
  const [realtime, setRealtime] = useState<RoomState["realtime"]>(null);
  const [polling, setPolling] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState<string[]>([]);
  const [chatOff, setChatOff] = useState(false);
  const [reported, setReported] = useState<Set<number>>(() => new Set());
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMuted(readList(MUTED_KEY));
    try {
      setChatOff(window.localStorage.getItem(OFF_KEY) === "1");
    } catch {
      // on
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${room}`, { cache: "no-store" });
      const body = (await res.json()) as RoomState;
      if (!body.available) return setState("off");
      setMessages(body.messages);
      setSlow(body.slow);
      setRealtime((was) => was ?? body.realtime);
      setState("ready");
    } catch {
      // the next poll
    }
  }, [room]);

  // The first load decides how new messages come: Realtime, else polling.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (state === "ready" && !realtime) setPolling(true);
  }, [state, realtime]);

  const apply = useCallback((e: RoomEvent) => {
    if (e.type === "msg") setMessages((m) => (m.some((x) => x.id === e.msg.id) ? m : [...m, e.msg].slice(-ROOM_KEPT)));
    else if (e.type === "del") setMessages((m) => m.filter((x) => x.id !== e.id));
    else if (e.type === "clear") setMessages([]);
    else if (e.type === "slow") setSlow(e.slow);
  }, []);

  useEffect(() => {
    if (!realtime || polling) return;
    let stop: (() => void) | null = null;
    let gone = false;
    void subscribeRoom(realtime, room, apply, () => setPolling(true))
      .then((s) => (gone ? s() : (stop = s)))
      .catch(() => setPolling(true));
    // Back on the tab: catch up on anything missed while it slept.
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      stop?.();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [realtime, polling, room, apply, load]);

  useVisiblePoll(load, polling ? ROOM_POLL_MS : null);
  useVisiblePoll(async () => {
    try {
      const res = await fetch(`/api/rooms/${room}/users`);
      if (res.ok) setUsers(((await res.json()) as { users: string[] }).users);
    } catch {
      // next time
    }
  }, ROOM_USERS_MS);

  const shown = messages.filter((m) => !muted.includes(m.name.toLowerCase()));
  const lastId = shown[shown.length - 1]?.id ?? 0;
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, chatOff]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${room}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "post", text }) });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "That wasn't sent.");
      else {
        setDraft("");
        apply({ type: "msg", room, msg: body.message });
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function report(m: RoomMessage) {
    setReported((s) => new Set(s).add(m.id));
    await fetch(`/api/rooms/${room}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "report", id: m.id }) }).catch(() => undefined);
  }

  function toggleMute(name: string) {
    const key = name.toLowerCase();
    const next = muted.includes(key) ? muted.filter((n) => n !== key) : [...muted, key];
    setMuted(next);
    try {
      window.localStorage.setItem(MUTED_KEY, JSON.stringify(next));
    } catch {
      // not remembered
    }
  }

  function toggleOff() {
    setChatOff((was) => {
      try {
        if (was) window.localStorage.removeItem(OFF_KEY);
        else window.localStorage.setItem(OFF_KEY, "1");
      } catch {
        // not remembered
      }
      return !was;
    });
  }

  if (state === "off") return <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">Chat rooms open soon.</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_14rem]">
      <div className="hud flex min-h-[28rem] flex-col rounded-lg border bg-card" data-testid="room-chat">
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          {slow > 0 && (
            <span className="flex items-center gap-1 text-warning" data-testid="slow-mode">
              <Timer className="h-3.5 w-3.5" aria-hidden /> Slow mode: {slow}s
            </span>
          )}
          <span className="ml-auto">{realtime && !polling ? "Live" : "Updates every few seconds"}</span>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={toggleOff} aria-pressed={chatOff}>
            <MessageSquareOff className="h-3.5 w-3.5" aria-hidden /> {chatOff ? "Turn on" : "Chat off"}
          </Button>
        </div>
        {chatOff ? (
          <p className="flex-1 px-3 py-8 text-center text-sm text-muted-foreground">Chat is off. You won&apos;t see messages, and can&apos;t send any.</p>
        ) : (
          <>
            <div ref={list} className="h-[26rem] flex-1 space-y-1 overflow-y-auto px-3 py-2 text-sm" aria-live="polite" data-testid="room-messages">
              {state === "loading" && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-hidden />}
              {state === "ready" && shown.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">No messages yet. Say hi!</p>}
              {shown.map((m) => (
                <div key={m.id} className="group flex items-baseline gap-1.5 break-words" data-testid="room-line">
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{time(m.at)}</span>
                  <p className="min-w-0 flex-1">
                    <Link href={`/u/${m.name}`} className={cn("font-semibold hover:underline", m.name === me ? "text-primary" : "text-screen")}>
                      {m.name}
                    </Link>
                    <span className="text-muted-foreground">: </span>
                    <span data-testid="room-text">{m.text}</span>
                  </p>
                  {me && m.name !== me && (
                    <span className="flex shrink-0 gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => toggleMute(m.name)} title={`Mute ${m.name}`} aria-label={`Mute ${m.name}`}>
                        <VolumeX className="h-3 w-3" aria-hidden />
                      </button>
                      {reported.has(m.id) ? (
                        <span className="text-[10px] text-muted-foreground">Reported</span>
                      ) : (
                        <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => void report(m)} title="Report this message" aria-label={`Report ${m.name}'s message`} data-testid="room-report">
                          <Flag className="h-3 w-3" aria-hidden />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {!me ? (
              <p className="border-t px-3 py-3 text-center text-xs text-muted-foreground">
                <Link href="/login" className="font-semibold text-primary hover:underline">
                  Sign in
                </Link>{" "}
                to chat. Anyone can read along.
              </p>
            ) : (
              <form className="flex gap-2 border-t p-2" onSubmit={send}>
                <input
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setError(null);
                  }}
                  maxLength={CHAT_MAX}
                  placeholder="Say something nice…"
                  aria-label="Room message"
                  autoComplete="off"
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" size="sm" className="h-9" disabled={sending || !draft.trim()} aria-label="Send">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                </Button>
              </form>
            )}
            {error && (
              <p role="alert" className="px-3 pb-2 text-xs text-destructive" data-testid="room-error">
                {error}
              </p>
            )}
          </>
        )}
      </div>
      <aside className="hud space-y-2 rounded-lg border bg-card p-3 text-sm">
        <p className="hud-label flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" aria-hidden /> Here now ({users.length})
        </p>
        <ul className="max-h-80 space-y-1 overflow-y-auto" data-testid="room-users">
          {users.map((u) => (
            <li key={u} className="flex items-center gap-1">
              <Link href={`/u/${u}`} className="min-w-0 flex-1 truncate hover:underline">
                {u}
              </Link>
              {muted.includes(u.toLowerCase()) && (
                <button type="button" onClick={() => toggleMute(u)} title={`Unmute ${u}`} aria-label={`Unmute ${u}`} className="text-muted-foreground hover:text-foreground">
                  <Volume2 className="h-3 w-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
        {muted.length > 0 && <p className="text-xs text-muted-foreground">Muted: {muted.join(", ")}</p>}
      </aside>
    </div>
  );
}
