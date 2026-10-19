"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flag, Loader2, RotateCcw, Settings2, WifiOff } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { lastCpuSetup, startBattle } from "./BattleSetup";
import { useBattle } from "./use-battle";

/**
 * A battle's page: keeps the battle fresh (useBattle) and draws it. The
 * battle screen and the simulator's client libraries load only here, on
 * demand, so the rest of the site stays light.
 */

const BattleScreen = dynamic(() => import("./play/BattleScreen"), {
  ssr: false,
  loading: () => <ScreenLoading />,
});

function ScreenLoading() {
  return (
    <div className="flex aspect-[16/9] w-full items-center justify-center rounded-lg border bg-card">
      <Loader2 className="h-6 w-6 animate-spin text-screen" aria-label="Loading the battle" />
    </div>
  );
}

export function BattleGone({ message }: { message: string }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-4 p-6 text-center">
        <p className="font-display text-xl font-bold uppercase">Battle not found</p>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link href="/battle/play" className={buttonVariants()}>
          Start a battle
        </Link>
      </CardContent>
    </Card>
  );
}

/** Forfeit, after a second press. */
function ForfeitButton({ busy, onForfeit }: { busy: boolean; onForfeit: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="flex items-center justify-end gap-2">
      {sure ? (
        <>
          <span className="text-sm text-muted-foreground">Forfeit this battle?</span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={onForfeit}>
            Forfeit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
            Keep battling
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setSure(true)}>
          <Flag className="h-3.5 w-3.5" aria-hidden /> Forfeit
        </Button>
      )}
    </div>
  );
}

/** After a battle against the computer: the same battle again, or new settings. */
function CpuAgain() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = typeof window !== "undefined" ? lastCpuSetup() : null;
  async function again() {
    if (!setup) return router.push("/battle/play");
    setBusy(true);
    setError(null);
    try {
      router.push(await startBattle({ mode: "cpu", ...setup }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a battle.");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => void again()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />} Play again
        </Button>
        <Link href="/battle/play" className={buttonVariants({ variant: "outline" })}>
          <Settings2 className="h-4 w-4" aria-hidden /> New battle
        </Link>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function BattleRoom({ code }: { code: string }) {
  const battle = useBattle(code);
  const { view, gone, offline } = battle;

  if (gone) return <BattleGone message={gone} />;
  if (!view) return <ScreenLoading />;

  if (view.you === null) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-3 p-6 text-center">
          <p className="hud-label text-screen">Battle in progress</p>
          <p className="font-display text-2xl font-bold uppercase">{view.players.map((p) => p.name).join(" vs ")}</p>
          <p className="text-sm text-muted-foreground">This battle is between two other trainers.</p>
          <Link href="/battle/play" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            Start your own
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {offline && (
        <p role="alert" className="flex items-center justify-center gap-1.5 text-sm text-destructive">
          <WifiOff className="h-4 w-4" aria-hidden /> Connection lost. Reconnecting…
        </p>
      )}
      <BattleScreen
        view={view}
        log={battle.log}
        offset={battle.offset}
        busy={battle.busy}
        error={battle.error}
        onChoose={(rqid, choice) => void battle.choose(rqid, choice)}
        endActions={view.kind === "cpu" ? <CpuAgain /> : null}
      />
      {view.status === "playing" && <ForfeitButton busy={battle.busy} onForfeit={() => void battle.act({ action: "forfeit" })} />}
    </div>
  );
}
