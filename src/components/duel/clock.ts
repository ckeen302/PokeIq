/**
 * A duel's countdowns: whole seconds left, and m:ss. On their own (DuelParts re-exports them), so a page that only
 * shows a countdown (the battle hub, a new-duel card) doesn't take the duel screens' animation library with it.
 */
export const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

export const clock = (ms: number) => {
  const s = seconds(ms);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
