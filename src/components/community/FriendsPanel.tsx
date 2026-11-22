"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { Ban, Check, ChevronDown, Eye, Loader2, MoreHorizontal, Search, Swords, UserMinus, UserPlus, X } from "lucide-react";
import { useAccount } from "@/lib/account";
import { closeFriends, friendAction, refreshFriends, setFriendsTab, useCommunity, type FriendsTab } from "@/lib/friends-client";
import type { FriendView } from "@/lib/community";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChallengeOptions } from "./ChallengeOptions";
import { Avatar } from "@/components/avatar/Avatar";
import { MessagesProvider, useT } from "@/i18n/client";
import { useLocale } from "@/i18n/locale-context";
import type { Tree } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";
import friendsNs from "@/messages/friends";
import { friendStatus, type FriendsT } from "./friend-status";

// The panel is on every page but loads on its own (CommunityLayer): a page in another language fetches its words
// with it, instead of carrying them in every page.
const trees = new Map<Locale, Tree>();
const loading = new Map<Locale, Promise<void>>();
const listeners = new Set<() => void>();

/** Fetches the panel's words in a language other than English (once per language). */
export function loadFriendsMessages(locale: Locale): Promise<void> {
  if (!process.env.LIVE_LOCALES || locale === "en") return Promise.resolve();
  let p = loading.get(locale);
  if (!p) {
    p = import(`@/messages/${locale}/friends.json`)
      .then((m) => {
        trees.set(locale, m.default as Tree);
        listeners.forEach((l) => l());
      })
      .catch(() => void loading.delete(locale));
    loading.set(locale, p);
  }
  return p;
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** The friends panel, in the page's language. */
export function FriendsPanel() {
  const locale = useLocale();
  const own = useSyncExternalStore(subscribe, () => trees.get(locale) ?? null, () => null);
  useEffect(() => void loadFriendsMessages(locale), [locale]);
  if (locale === "en") return <Panel />;
  if (!own) return null;
  return (
    <MessagesProvider messages={{ friends: own }}>
      <Panel />
    </MessagesProvider>
  );
}

/** The friends panel: friends with their status, requests both ways, and adding a friend by name. */
function Panel() {
  const t = useT(friendsNs);
  const account = useAccount();
  const c = useCommunity();
  const user = account.user;

  // Keep the list fresh while the panel is open (it's closed most of the time).
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => document.visibilityState === "visible" && void refreshFriends(), 60_000);
    return () => window.clearInterval(id);
  }, [user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeFriends();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const list = c.list;
  const online = list?.friends.filter((f) => f.online).length ?? 0;
  const tabs: [FriendsTab, number][] = [
    ["friends", online],
    ["requests", list?.incoming.length ?? c.requests],
    ["add", 0],
  ];

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/30" aria-hidden onClick={closeFriends} />
      <aside
        role="dialog"
        aria-label={t("title")}
        className="fixed bottom-0 right-0 top-0 z-[56] flex w-full max-w-[400px] flex-col border-l bg-background shadow-2xl"
        data-testid="friends-panel"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-display text-lg font-bold uppercase tracking-wide">{t("title")}</p>
          <button type="button" onClick={closeFriends} aria-label={t("close")} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        {account.status !== "ready" ? (
          <Centered>
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          </Centered>
        ) : !user ? (
          <Centered>
            <UserPlus className="h-8 w-8 text-primary" aria-hidden />
            <p className="font-display text-lg font-bold uppercase">{t("guestTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("guestBody")}</p>
            <Link href="/login" onClick={closeFriends} className="font-display text-sm font-semibold uppercase tracking-wider text-primary hover:underline">
              {t("guestLink")}
            </Link>
          </Centered>
        ) : c.off ? (
          <Centered>
            <p className="font-display text-lg font-bold uppercase">{t("offTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("offBody")}</p>
          </Centered>
        ) : (
          <>
            <nav className="flex border-b" role="tablist">
              {tabs.map(([id, n]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={c.tab === id}
                  onClick={() => setFriendsTab(id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent py-2.5 font-display text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground",
                    c.tab === id && "border-primary text-foreground"
                  )}
                >
                  {t(`tabs.${id}`)}
                  {n > 0 && (
                    <span className={cn("rounded-full px-1.5 font-pixel text-[9px]", id === "friends" ? "bg-success/20 text-success" : "bg-primary text-primary-foreground")}>{n}</span>
                  )}
                </button>
              ))}
            </nav>
            <div className="flex-1 overflow-y-auto p-3">
              {!list ? (
                <Centered>{c.error ? <p className="text-sm text-destructive">{c.error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}</Centered>
              ) : c.tab === "friends" ? (
                <FriendsList friends={list.friends} me={user.username} t={t} />
              ) : c.tab === "requests" ? (
                <Requests t={t} />
              ) : (
                <AddFriend t={t} />
              )}
            </div>
            {list && (
              <footer className="border-t px-4 py-2.5">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={list.appearOffline}
                    onChange={(e) => void friendAction({ action: "appear-offline", on: e.target.checked }).catch(() => undefined)}
                    data-testid="appear-offline"
                  />
                  {t("appearOffline")}
                  <span className="text-xs text-muted-foreground">{t("appearOfflineNote")}</span>
                </label>
              </footer>
            )}
          </>
        )}
      </aside>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">{children}</div>;
}

function FriendsList({ friends, me, t }: { friends: FriendView[]; me: string; t: FriendsT }) {
  if (!friends.length) {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">{t("none")}</p>
        <Button size="sm" variant="outline" onClick={() => setFriendsTab("add")}>
          <UserPlus className="h-4 w-4" aria-hidden /> {t("addOne")}
        </Button>
      </Centered>
    );
  }
  return (
    <ul className="space-y-2" data-testid="friends-list">
      {friends.map((f) => (
        <FriendRow key={f.username} friend={f} me={me} t={t} />
      ))}
    </ul>
  );
}

function FriendRow({ friend, me, t }: { friend: FriendView; me: string; t: FriendsT }) {
  const router = useRouter();
  const [open, setOpen] = useState<"challenge" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = friend.daily;
  const act = async (action: "remove" | "block") => {
    if (!window.confirm(action === "block" ? t("confirmBlock", { name: friend.username }) : t("confirmRemove", { name: friend.username }))) return;
    await friendAction({ action, username: friend.username }).catch((err: Error) => setError(err.message));
  };
  return (
    <li className={cn("rounded-lg border bg-card p-3", !friend.online && "opacity-75")} data-testid="friend-row" data-online={friend.online}>
      <div className="flex items-start gap-2.5">
        <span className="relative shrink-0">
          <Avatar avatar={friend.avatar} size={32} />
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card", friend.online ? "bg-success shadow-[0_0_8px_hsl(var(--success))]" : "bg-foreground/40")} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/u/${encodeURIComponent(friend.username)}`} onClick={closeFriends} className="font-display font-bold hover:underline">
            {friend.username}
          </Link>
          <p className="truncate text-xs text-muted-foreground" data-testid="friend-status">
            {friendStatus(t, friend)}
          </p>
          {d && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {d.daily && (
                <span>
                  {t("daily", { correct: d.daily.correct, total: d.daily.total })}
                  {d.daily.streak > 1 ? t("dayStreak", { n: d.daily.streak }) : ""}
                </span>
              )}
              {d.daily && d.dle && <span> · </span>}
              {d.dle && <span>{d.dle.solved ? t("dleIn", { n: d.dle.guesses }) : t("dleMissed")}</span>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {friend.activity?.watch && (
            <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => (closeFriends(), router.push(`/battle/live/${friend.activity!.watch}`))} data-testid="friend-watch">
              <Eye className="h-3.5 w-3.5" aria-hidden /> {t("watch")}
            </Button>
          )}
          <Button size="sm" variant={open === "challenge" ? "default" : "outline"} className="h-8 px-2" onClick={() => setOpen(open === "challenge" ? null : "challenge")} aria-expanded={open === "challenge"}>
            <Swords className="h-3.5 w-3.5" aria-hidden /> {t("challenge")} <ChevronDown className="h-3 w-3" aria-hidden />
          </Button>
          <button type="button" aria-label={t("moreFor", { name: friend.username })} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setOpen(open === "more" ? null : "more")}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      {open === "challenge" && <ChallengeOptions friend={friend.username} me={me} onDone={closeFriends} />}
      {open === "more" && (
        <div className="mt-2 flex gap-2 border-t pt-2">
          <Button size="sm" variant="ghost" onClick={() => void act("remove")}>
            <UserMinus className="h-3.5 w-3.5" aria-hidden /> {t("remove")}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void act("block")}>
            <Ban className="h-3.5 w-3.5" aria-hidden /> {t("block")}
          </Button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}

function Requests({ t }: { t: FriendsT }) {
  const { list } = useCommunity();
  const [error, setError] = useState<string | null>(null);
  if (!list) return null;
  const run = (body: Record<string, unknown>) => void friendAction(body).catch((err: Error) => setError(err.message));
  const empty = !list.incoming.length && !list.outgoing.length && !list.blocked.length;
  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {empty && <p className="p-6 text-center text-sm text-muted-foreground">{t("noRequests")}</p>}
      {list.incoming.length > 0 && (
        <Section title={t("wants")}>
          {list.incoming.map((r) => (
            <li key={r.username} className="flex items-center gap-2 rounded-lg border bg-card p-2.5" data-testid="incoming-request">
              <Avatar avatar={r.avatar} size={24} />
              <Link href={`/u/${encodeURIComponent(r.username)}`} onClick={closeFriends} className="flex-1 truncate font-display font-bold hover:underline">
                {r.username}
              </Link>
              <Button size="sm" variant="success" className="h-8 px-2" onClick={() => run({ action: "accept", username: r.username })}>
                <Check className="h-3.5 w-3.5" aria-hidden /> {t("accept")}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => run({ action: "decline", username: r.username })}>
                {t("decline")}
              </Button>
              <button type="button" aria-label={t("blockName", { name: r.username })} className="p-1 text-muted-foreground hover:text-destructive" onClick={() => run({ action: "block", username: r.username })}>
                <Ban className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </Section>
      )}
      {list.outgoing.length > 0 && (
        <Section title={t("sent")}>
          {list.outgoing.map((r) => (
            <li key={r.username} className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
              <Avatar avatar={r.avatar} size={24} />
              <span className="flex-1 truncate font-display font-bold">{r.username}</span>
              <span className="hud-label">{t("waiting")}</span>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => run({ action: "remove", username: r.username })}>
                {t("cancel")}
              </Button>
            </li>
          ))}
        </Section>
      )}
      {list.blocked.length > 0 && (
        <Section title={t("blocked")}>
          {list.blocked.map((name) => (
            <li key={name} className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
              <span className="flex-1 truncate">{name}</span>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => run({ action: "unblock", username: name })}>
                {t("unblock")}
              </Button>
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="hud-label">{title}</h3>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function AddFriend({ t }: { t: FriendsT }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const username = name.trim();
    if (!username) return;
    setBusy(true);
    setNote(null);
    try {
      const out = await friendAction({ action: "request", username });
      setNote({ ok: true, text: out.status === "friends" ? t("nowFriends", { name: username }) : t("requestSent", { name: username }) });
      setName("");
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : t("sendFailed") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <form onSubmit={send} className="space-y-2">
        <label htmlFor="friend-name" className="hud-label">
          {t("name")}
        </label>
        <div className="flex gap-2">
          <input
            id="friend-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoComplete="off"
            placeholder={t("namePlaceholder")}
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />} {t("send")}
          </Button>
        </div>
        {note && (
          <p role={note.ok ? "status" : "alert"} className={cn("text-sm", note.ok ? "text-success" : "text-destructive")}>
            {note.text}
          </p>
        )}
      </form>
      <Link href="/users" onClick={closeFriends} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <Search className="h-4 w-4" aria-hidden /> {t("findUser")}
      </Link>
    </div>
  );
}
