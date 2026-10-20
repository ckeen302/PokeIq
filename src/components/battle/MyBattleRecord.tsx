"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { BattleProfileResponse } from "@/lib/battle/profile";
import { battleIdHeaders, ensureBattleId } from "@/lib/battle/replay-client";
import { useAccount } from "@/lib/account";
import { BattleProfileView, BattleRecordCard } from "./BattleProfileView";

/** Your battle record on the trainer card (and, signed in, the link to your public battle profile). */
export function MyBattleRecord() {
  const account = useAccount();
  const [data, setData] = useState<BattleProfileResponse | null>(null);
  const [now, setNow] = useState(0);
  const user = account.user?.username;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await ensureBattleId();
        const res = await fetch("/api/battle/profile", { headers: battleIdHeaders(), cache: "no-store" });
        const body = (await res.json().catch(() => null)) as BattleProfileResponse | null;
        if (!live) return;
        setNow(Date.now());
        setData(res.ok && body ? body : { available: false });
      } catch {
        if (live) setData({ available: false });
      }
    })();
    return () => {
      live = false;
    };
  }, [user]);

  if (data && !data.available) return null;
  return (
    <BattleRecordCard title="Battle record">
      {!data ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-screen" aria-label="Loading your battle record" />
      ) : (
        <BattleProfileView
          profile={data}
          now={now}
          empty={
            <>
              No live battles yet.{" "}
              <Link href="/battle/play?vs=anyone" className="font-semibold text-foreground underline-offset-2 hover:underline">
                Find an opponent
              </Link>
            </>
          }
        />
      )}
      {user && (
        <Link href={`/battle/player/${encodeURIComponent(user)}`} className="hud-label block hover:text-foreground">
          Your public battle profile →
        </Link>
      )}
    </BattleRecordCard>
  );
}
