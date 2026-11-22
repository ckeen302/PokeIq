"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { Loader2 } from "lucide-react";
import type { BattleProfileResponse } from "@/lib/battle/profile";
import { battleIdHeaders, ensureBattleId } from "@/lib/battle/replay-client";
import { useAccount } from "@/lib/account";
import { battleRecordCard, battleRecordView } from "./BattleRecordView";
import { useT } from "@/i18n/client";
import battleRecord from "@/messages/battle-record";
import battleGlicko from "@/messages/battle-glicko";

/** Your battle record on the trainer card (and, signed in, the link to your public battle profile). */
export function MyBattleRecord() {
  const account = useAccount();
  const [data, setData] = useState<BattleProfileResponse | null>(null);
  const [now, setNow] = useState(0);
  const user = account.user?.username;
  const t = useT(battleRecord);
  const tg = useT(battleGlicko);

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
  return battleRecordCard(
    {
      title: t("title"),
      children: (
        <>
          {!data ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-screen" aria-label={t("loading")} />
          ) : (
            battleRecordView(
              {
                profile: data,
                now,
                empty: (
                  <>
                    {t("none")}{" "}
                    <Link href="/battle/play?vs=anyone" className="font-semibold text-foreground underline-offset-2 hover:underline">
                      {t("find")}
                    </Link>
                  </>
                ),
              },
              t,
              tg
            )
          )}
          {user && (
            <Link href={`/u/${encodeURIComponent(user)}`} className="hud-label block hover:text-foreground">
              {t("profile")}
            </Link>
          )}
        </>
      ),
    },
    t
  );
}
