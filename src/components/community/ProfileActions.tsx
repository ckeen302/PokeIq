"use client";

import { useState } from "react";
import Link from "@/components/ui/Link";
import { Eye, Swords } from "lucide-react";
import { useAccount } from "@/lib/account";
import { useCommunity } from "@/lib/friends-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { AddFriendButton } from "./AddFriend";
import { ChallengeOptions } from "./ChallengeOptions";
import { useT } from "@/i18n/client";
import friendsNs from "@/messages/friends";
import { friendStatus } from "./friend-status";

/**
 * A profile's actions: Add friend, and for friends, Challenge and Watch
 * (when they're in a public battle). Whether someone is online or battling
 * is only ever shown to their friends.
 */
export function ProfileActions({ username }: { username: string }) {
  const t = useT(friendsNs);
  const account = useAccount();
  const { list } = useCommunity();
  const [challenging, setChallenging] = useState(false);
  const me = account.user?.username;
  const friend = list?.friends.find((f) => f.username.toLowerCase() === username.toLowerCase());
  return (
    <div className="space-y-2" data-testid="profile-actions">
      <div className="flex flex-wrap items-center gap-2">
        <AddFriendButton username={username} />
        {friend && me && (
          <Button size="sm" variant={challenging ? "default" : "outline"} onClick={() => setChallenging(!challenging)} aria-expanded={challenging}>
            <Swords className="h-4 w-4" aria-hidden /> {t("challenge")}
          </Button>
        )}
        {friend?.activity?.watch && (
          <Link href={`/battle/live/${friend.activity.watch}`} className={buttonVariants({ size: "sm", variant: "outline" })} data-testid="profile-watch">
            <Eye className="h-4 w-4" aria-hidden /> {t("watch")}
          </Link>
        )}
        {friend && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={friend.online ? "h-2 w-2 rounded-full bg-success" : "h-2 w-2 rounded-full bg-foreground/25"} aria-hidden />
            {friendStatus(t, friend)}
          </span>
        )}
      </div>
      {challenging && friend && me && (
        <div className="max-w-sm rounded-lg border bg-card p-2">
          <ChallengeOptions friend={friend.username} me={me} className="mt-0 border-t-0 pt-0" />
        </div>
      )}
    </div>
  );
}
