import { battleHref, type BattleSeatResponse, type CpuLevel, type PlayFormatId } from "@/lib/battle/play";
import { saveBattleSeat, saveBattleSeed } from "@/lib/battle/seat";
import { ensureBattleId } from "@/lib/battle/replay-client";
import { rememberCustomRules, type CustomRules } from "@/lib/battle/custom-rules";

/**
 * Starting a battle against the computer or a friend, and the last battle
 * against the computer (for "Play again"). Kept apart from the setup screen
 * (BattleSetup) so the battle hub can start one without loading the screen.
 */

/** The last battle against the computer, so "Play again" can start the same one. */
const LAST_KEY = "pokeiq:battle:last-cpu";

export interface CpuSetup {
  name: string;
  format: PlayFormatId;
  level: CpuLevel;
  team?: string;
  /** Custom rules (format "custom"). */
  rules?: CustomRules;
}

export function rememberCpuSetup(setup: CpuSetup) {
  try {
    window.sessionStorage.setItem(LAST_KEY, JSON.stringify(setup));
  } catch {
    // "Play again" then goes back to the setup page
  }
}

export function lastCpuSetup(): CpuSetup | null {
  try {
    const raw = window.sessionStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as CpuSetup) : null;
  } catch {
    return null;
  }
}

/** Starts a battle; returns its page, or throws with the server's reason. */
export async function startBattle(
  body: { mode: "cpu" | "pvp" } & Omit<CpuSetup, "level"> & { level?: CpuLevel; public?: boolean; hidden?: boolean; timer?: boolean; timeoutLoses?: boolean }
): Promise<string> {
  const rankedId = (await ensureBattleId()) ?? undefined;
  const sentAt = Date.now();
  const res = await fetch("/api/battle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, rankedId }) });
  const data = (await res.json().catch(() => ({}))) as Partial<BattleSeatResponse> & { error?: string };
  if (!res.ok || !data.code || !data.token) throw new Error(data.error ?? `Request failed (${res.status})`);
  saveBattleSeat(data.code, data.token);
  if (data.view) saveBattleSeed(data.code, data.view, sentAt);
  if (body.rules) rememberCustomRules(body.rules);
  if (body.mode === "cpu") rememberCpuSetup({ name: body.name, format: body.format, level: body.level ?? "normal", team: body.team, rules: body.rules });
  return battleHref(body.mode, data.code);
}
