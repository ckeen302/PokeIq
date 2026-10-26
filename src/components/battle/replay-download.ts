import { logLineHtml, replayFileHtml, replayFileName, replayLogData } from "@/lib/battle/replay-file";

/**
 * Saves a battle as a file: Showdown's replay HTML (it plays in Showdown's
 * replay player, and its text log reads offline) or the raw protocol log.
 * The text log comes from the battle screen's own model (@pkmn/view's
 * Showdown strings), loaded only when a download is asked for.
 */

export interface DownloadableBattle {
  id: string;
  format: string;
  formatName: string;
  players: [string, string];
  log: readonly string[];
}

function save(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadReplay(battle: DownloadableBattle, kind: "html" | "log" = "html") {
  const lines = replayLogData(battle.log);
  if (kind === "log") {
    save(replayFileName(battle.format, battle.players, battle.id, "log"), "text/plain;charset=utf-8", lines.join("\n") + "\n");
    return;
  }
  const { BattleModel } = await import("./play/model");
  const model = new BattleModel("p1");
  const html: string[] = [];
  for (const line of lines) {
    const step = model.feed(line);
    if (!step) continue;
    if (step.cmd === "turn") html.push(logLineHtml("", Number(step.args[1])));
    else if (step.text.trim()) html.push(logLineHtml(step.text.trim()));
  }
  save(
    replayFileName(battle.format, battle.players, battle.id),
    "text/html;charset=utf-8",
    replayFileHtml({ id: battle.id, format: battle.formatName, players: battle.players, log: battle.log, logHtml: html.join("\n") })
  );
}
