"use client";

import { useEffect, useState } from "react";
import type { BattleView } from "@/lib/battle/play";
import { tauntOf, type TauntId } from "@/lib/trainer/taunts";
import { Avatar3D } from "@/components/trainer3d/Avatar3D";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";
import { webglAvailable } from "./arena/webgl";
import { cpuTrainer, FOE_ACCENT, standIn, YOU_ACCENT } from "./Versus";

/**
 * The victory screen over the result: the winner's 3D trainer on a lit
 * podium, playing a dance or emote on a loop (their own trainer if they
 * made one; the computer and trainers without one get a stand-in), with the
 * result itself. A draw has no winner and no podium.
 */

/** The celebrations it picks from (the free ones, so anyone's trainer can do them). */
const CELEBRATIONS: TauntId[] = ["dab", "robot", "ggwave", "salute"];

export function BattleVictory({ view, title, detail, tone }: { view: BattleView; title: string; detail: string; tone: "win" | "loss" | "draw" }) {
  const winner = view.end?.winner ?? null;
  const seat = winner === null ? null : winner;
  const player = seat === null ? null : view.players[seat];
  const isCpu = !!view.cpu && seat !== null && seat !== (view.you ?? 0) && view.you !== null;
  const mine = seat !== null && seat === view.you;
  const accent = view.you === null ? (seat === 0 ? YOU_ACCENT : FOE_ACCENT) : mine ? YOU_ACCENT : FOE_ACCENT;
  const config = isCpu ? cpuTrainer(view.cpu!.level) : (player?.avatar?.trainer ?? standIn(player?.name ?? "winner"));
  const move = CELEBRATIONS[(view.code.charCodeAt(0) + view.code.charCodeAt(view.code.length - 1)) % CELEBRATIONS.length];
  const [n, setN] = useState(1);
  const [gl] = useState(webglAvailable);
  useEffect(() => {
    if (seat === null) return;
    const secs = tauntOf(move)?.secs ?? 3;
    const id = window.setInterval(() => setN((k) => k + 1), (secs + 1.2) * 1000);
    return () => window.clearInterval(id);
  }, [seat, move]);

  const heading = (
    <>
      <p className={cn("font-display text-3xl font-bold uppercase sm:text-4xl", tone === "win" ? "text-success" : tone === "draw" ? "text-foreground" : "text-destructive")}>{title}</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </>
  );
  if (seat === null) return heading;
  return (
    <div className="battle-victory relative -mx-4 -mt-4 overflow-hidden rounded-t-lg px-4 pb-4 pt-3 sm:pt-4" style={{ ["--victory" as string]: accent }} data-testid="battle-victory" data-winner={seat}>
      <div className="battle-victory-rays pointer-events-none" aria-hidden />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-8">
        <div className="relative h-52 w-44 shrink-0 sm:h-64 sm:w-56">
          <div className="battle-victory-podium absolute inset-x-[6%] bottom-[2%] h-[16%]" aria-hidden />
          {gl ? (
            <Avatar3D config={config} pose="victory" taunt={{ id: move, n }} facing="front" label={`${player?.name ?? "The winner"}'s trainer celebrating`} className="absolute inset-0" />
          ) : (
            <span className="absolute inset-x-[18%] bottom-[14%] flex aspect-square items-center justify-center rounded-full border-4 border-[#ffd23c]/70 bg-[radial-gradient(circle_at_35%_30%,#fff3b0,#f5b82e_60%,#b7791f)] shadow-2xl" aria-hidden>
              <Trophy className="h-1/2 w-1/2 text-[#5a3a05]" />
            </span>
          )}
        </div>
        <div className="relative space-y-1.5 sm:text-left">
          <p className="hud-label text-white/70">Winner · {player?.name ?? "—"}</p>
          {heading}
        </div>
      </div>
    </div>
  );
}
