"use client";

import Link from "@/components/ui/Link";
import { Mail } from "lucide-react";
import { useAccount } from "@/lib/account";
import { cn } from "@/lib/utils";

/**
 * The end of a daily: "Sign up to get the daily in your inbox" for guests,
 * "Get the daily in your inbox" (to Settings) for a trainer who hasn't
 * turned the emails on. Hidden for trainers who get them, and while daily
 * emails are switched off.
 */
export function DailyEmailNudge({ className }: { className?: string }) {
  const account = useAccount();
  return (
    <DailyEmailNudgeView
      className={className}
      emailEnabled={account.status === "ready" && account.enabled && account.emailEnabled}
      signedIn={!!account.user}
      subscribed={account.dailyEmail}
    />
  );
}

export function DailyEmailNudgeView({
  emailEnabled,
  signedIn,
  subscribed,
  className,
}: {
  emailEnabled: boolean;
  signedIn: boolean;
  subscribed: boolean;
  className?: string;
}) {
  if (!emailEnabled || (signedIn && subscribed)) return null;
  return (
    <Link
      href={signedIn ? "/trainer#email" : "/login?signup=1"}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border border-dashed border-screen/40 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-screen/70 hover:text-foreground",
        className
      )}
      data-testid="daily-email-nudge"
    >
      <Mail className="h-4 w-4 shrink-0 text-screen" aria-hidden />
      <span>{signedIn ? "Get the daily in your inbox" : "Sign up to get the daily in your inbox"}</span>
    </Link>
  );
}
