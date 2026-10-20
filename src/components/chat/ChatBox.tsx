"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Flag, Loader2, MessageSquare, MessageSquareOff, Send, Volume2, VolumeX } from "lucide-react";
import { CHAT_MAX, chatReport, type ChatLine } from "@/lib/chat";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Chat between the two trainers of a live battle or a duel. Every message
 * was checked on the server (no links; swears and slurs masked) and shows
 * here as plain text with its sender and time. Each trainer can mute the
 * opponent (remembered for that opponent while the match lasts), turn chat
 * off altogether (remembered on this device) and report a message.
 * Visitors read along but can't post.
 */

const OFF_KEY = "pokeiq:chat-off";
const MUTED_KEY = "pokeiq:chat-muted";
/** A mute lasts as long as a match can (battles and duels are kept 3 h after their last change). */
const MUTE_MS = 3 * 60 * 60 * 1000;
const SEAT_TEXT = ["text-[#e2306f]", "text-[#38bdf8]"];

function readMuted(): Record<string, number> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(MUTED_KEY) ?? "{}") as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, until]) => typeof until === "number" && until > now));
  } catch {
    return {};
  }
}

/** Whether chat is on (the default) on this device, and who is muted, both remembered. */
function useChatPrefs(opponent: string | undefined) {
  const [off, setOff] = useState(false);
  const [muted, setMuted] = useState(false);
  const key = opponent?.toLowerCase();

  useEffect(() => {
    try {
      setOff(window.localStorage.getItem(OFF_KEY) === "1");
    } catch {
      // on
    }
  }, []);
  useEffect(() => {
    setMuted(!!key && key in readMuted());
  }, [key]);

  function toggleOff() {
    setOff((was) => {
      try {
        if (was) window.localStorage.removeItem(OFF_KEY);
        else window.localStorage.setItem(OFF_KEY, "1");
      } catch {
        // not remembered
      }
      return !was;
    });
  }

  function toggleMuted() {
    if (!key) return;
    const all = readMuted();
    if (muted) delete all[key];
    else all[key] = Date.now() + MUTE_MS;
    try {
      window.localStorage.setItem(MUTED_KEY, JSON.stringify(all));
    } catch {
      // not remembered
    }
    setMuted(!muted);
  }

  return { off, muted, toggleOff, toggleMuted };
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export interface ChatBoxProps {
  lines: ChatLine[] | undefined;
  /** Your seat, or null for a visitor (who reads but can't post). */
  you: number | null;
  players: { name: string }[];
  /** The battle or duel, for reports. */
  code: string;
  /** What it is, for reports: "Live battle", "Pokédle duel"... */
  game: string;
  /** Sends a message; the server's refusal comes back as its message. */
  onSend: (text: string) => Promise<string | null>;
  /** Why posting is closed right now (the input is replaced by this note). */
  closed?: string;
  /** A panel that folds away, with a count of unread messages (live battles). */
  collapsible?: boolean;
  className?: string;
}

export function ChatBox({ lines = [], you, players, code, game, onSend, closed, collapsible, className }: ChatBoxProps) {
  const opponentSeat = you === null ? null : 1 - you;
  const opponent = opponentSeat === null ? undefined : players[opponentSeat]?.name;
  const { off, muted, toggleOff, toggleMuted } = useChatPrefs(opponent);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState<Set<number>>(() => new Set());
  const [seenN, setSeenN] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const shown = lines.filter((l) => !(muted && l.seat !== null && l.seat === opponentSeat));
  const lastN = shown[shown.length - 1]?.n ?? 0;
  const visible = open && !off;
  const unread = visible ? 0 : shown.filter((l) => l.n > seenN && l.seat !== you).length;

  useEffect(() => {
    if (visible) setSeenN(lastN);
  }, [visible, lastN]);

  // Newest at the bottom, in view (scrolling the list only, never the page).
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastN, visible]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const refused = await onSend(text);
    setSending(false);
    if (refused) setError(refused);
    else setDraft("");
  }

  async function report(line: ChatLine) {
    setReported((s) => new Set(s).add(line.n));
    try {
      await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatReport(line, code, game, window.location.pathname)),
      });
    } catch {
      // Reported as far as the trainer is concerned; the endpoint logs what it can.
    }
  }

  return (
    <Card className={cn("text-left", className)} data-testid="chat">
      <CardContent className="p-0">
        <div className="flex items-center gap-1 border-b px-3 py-2">
          <button
            type="button"
            className={cn("hud-label flex flex-1 items-center gap-1.5 text-left", !collapsible && "cursor-default")}
            onClick={collapsible ? () => setOpen((o) => !o) : undefined}
            aria-expanded={collapsible ? open : undefined}
            disabled={!collapsible}
          >
            <MessageSquare className="h-3 w-3" aria-hidden /> Chat
            {unread > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground" data-testid="chat-unread">
                {unread}
              </span>
            )}
            {collapsible && (open ? <ChevronUp className="ml-auto h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="ml-auto h-3.5 w-3.5" aria-hidden />)}
          </button>
          {open && opponent && !off && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={toggleMuted} aria-pressed={muted} title={muted ? `Unmute ${opponent}` : `Mute ${opponent}`}>
              {muted ? <VolumeX className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
              {muted ? "Unmute" : "Mute"}
            </Button>
          )}
          {open && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={toggleOff} aria-pressed={off} title={off ? "Turn chat on" : "Turn chat off"}>
              <MessageSquareOff className="h-3.5 w-3.5" aria-hidden /> {off ? "Turn on" : "Chat off"}
            </Button>
          )}
        </div>

        {open &&
          (off ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">Chat is off. You won&apos;t see messages, and can&apos;t send any.</p>
          ) : (
            <>
              <div ref={list} className="max-h-56 min-h-[5rem] space-y-1 overflow-y-auto px-3 py-2 text-sm" data-testid="chat-lines" aria-live="polite">
                {shown.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">No messages yet. Say hi!</p>}
                {shown.map((line) =>
                  line.seat === null ? (
                    <p key={line.n} className="text-center text-xs italic text-muted-foreground">
                      {line.text}
                    </p>
                  ) : (
                    <div key={line.n} className="group flex items-baseline gap-1.5 break-words" data-testid="chat-line">
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{time(line.at)}</span>
                      <p className="min-w-0 flex-1">
                        <span className={cn("font-semibold", SEAT_TEXT[line.seat] ?? "")}>{line.name}</span>
                        <span className="text-muted-foreground">: </span>
                        <span data-testid="chat-text">{line.text}</span>
                      </p>
                      {line.seat !== you &&
                        (reported.has(line.n) ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground">Reported</span>
                        ) : (
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                            onClick={() => void report(line)}
                            title="Report this message"
                            aria-label={`Report ${line.name}'s message`}
                          >
                            <Flag className="h-3 w-3" aria-hidden />
                          </button>
                        ))}
                    </div>
                  )
                )}
                {muted && <p className="text-center text-[10px] text-muted-foreground">{opponent} is muted.</p>}
              </div>
              {you === null ? (
                <p className="border-t px-3 py-2 text-center text-xs text-muted-foreground">Only the trainers playing can chat.</p>
              ) : closed ? (
                <p className="border-t px-3 py-2 text-center text-xs text-muted-foreground">{closed}</p>
              ) : (
                <form
                  className="flex gap-2 border-t p-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <input
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setError(null);
                    }}
                    maxLength={CHAT_MAX}
                    placeholder="Say something nice…"
                    aria-label="Chat message"
                    autoComplete="off"
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button type="submit" size="sm" className="h-9" disabled={sending || !draft.trim()} aria-label="Send">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  </Button>
                </form>
              )}
              {error && (
                <p role="alert" className="px-3 pb-2 text-xs text-destructive" data-testid="chat-error">
                  {error}
                </p>
              )}
            </>
          ))}
      </CardContent>
    </Card>
  );
}
