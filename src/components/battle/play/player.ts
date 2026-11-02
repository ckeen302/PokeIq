import { BattleScene, PokemonSprite, type SpriteData } from "./scene";
import { moveInfo } from "./moves";
import type { SideId, SlotRef, Snap, Step } from "./model";
import { ballBackground, STANDARD_BALL, type BallLook } from "./PokeBall";

/**
 * Plays one step of the battle on the stage: the move's animation (ported
 * from Showdown, or a stand-in by type and category), hits, switches,
 * faints, status, stat changes, effectiveness, then commits the step's
 * snapshot so HP bars drain when the hit lands. Every wait scales with the
 * playback speed and ends at once when skipped.
 */

type AnimTables = typeof import("./anims/moves") & typeof import("./anims/other");

let tables: Promise<AnimTables> | null = null;
/** The animation tables are big: loaded once, after the screen is up. */
export function loadAnims(): Promise<AnimTables> {
  tables ??= Promise.all([import("./anims/moves"), import("./anims/other")]).then(([moves, other]) => ({ ...moves, ...other }));
  return tables;
}

export interface StageSprite {
  el: HTMLElement;
  sp: SpriteData;
  pos: { x: number; y: number; z: number };
  near: boolean;
  key: string;
}

export interface StageHandle {
  stage: HTMLElement;
  backdrop: HTMLElement;
  bgfx: HTMLElement;
  fx: HTMLElement;
  sprite(ref: SlotRef): StageSprite | null;
  /** Puts every sprite back at its resting box. */
  repaint(): void;
  /** The near side (yours). */
  me: "p1" | "p2";
  /** The 3D arena's crowd reacts (camera flashes); nothing on the CSS backdrop. */
  cheer?(power?: number): void;
  /** A side's Poké Ball (their 3D trainer's), for the send-out. */
  ball?(side: SideId): BallLook | undefined;
}

export type PopupTone = "good" | "bad" | "info" | "crit" | "super" | "weak";

export interface PlayDeps {
  stage: StageHandle;
  commit(snap: Snap): void;
  popup(ref: SlotRef | undefined, text: string, tone: PopupTone): void;
  speed: number;
  signal: AbortSignal;
  reducedMotion: boolean;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const id = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(id);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function animateEl(el: HTMLElement | undefined | null, keyframes: Keyframe[], ms: number, deps: PlayDeps, fill: FillMode = "none", extra: KeyframeAnimationOptions = {}) {
  if (!el || deps.reducedMotion || deps.signal.aborted || typeof el.animate !== "function") return Promise.resolve();
  const anim = el.animate(keyframes, { duration: Math.max(1, ms / deps.speed), easing: "ease-out", fill, ...extra });
  const abort = () => anim.finish();
  deps.signal.addEventListener("abort", abort);
  return anim.finished.then(
    () => deps.signal.removeEventListener("abort", abort),
    () => deps.signal.removeEventListener("abort", abort)
  );
}

/** Stand-in animations by type and category for the few moves Showdown has none for. */
const PHYSICAL: Record<string, string> = {
  Normal: "bodyslam", Fire: "flareblitz", Water: "waterfall", Electric: "thunderpunch", Grass: "leafblade", Ice: "iciclecrash",
  Fighting: "closecombat", Poison: "poisonjab", Ground: "earthquake", Flying: "bravebird", Psychic: "zenheadbutt", Bug: "xscissor",
  Rock: "stoneedge", Ghost: "shadowclaw", Dragon: "dragonclaw", Dark: "crunch", Steel: "ironhead", Fairy: "playrough",
};
const SPECIAL: Record<string, string> = {
  Normal: "hypervoice", Fire: "flamethrower", Water: "surf", Electric: "thunderbolt", Grass: "energyball", Ice: "icebeam",
  Fighting: "aurasphere", Poison: "sludgebomb", Ground: "earthpower", Flying: "airslash", Psychic: "psychic", Bug: "bugbuzz",
  Rock: "powergem", Ghost: "shadowball", Dragon: "dragonpulse", Dark: "darkpulse", Steel: "flashcannon", Fairy: "moonblast",
};

function moveAnim(t: AnimTables, moveId: string, selfTarget: boolean) {
  const anim = t.BattleMoveAnims[moveId];
  if (anim) return anim.anim;
  const info = moveInfo(moveId);
  if (info.category === "Status") return (selfTarget ? t.BattleOtherAnims.selfstatus : t.BattleOtherAnims.lightstatus).anim;
  const table = info.category === "Physical" ? PHYSICAL : SPECIAL;
  return (t.BattleMoveAnims[table[info.type] ?? "tackle"] ?? t.BattleMoveAnims.tackle).anim;
}

function proxy(scene: BattleScene, s: StageSprite) {
  return new PokemonSprite(scene, s.el, s.sp, s.pos, !s.near);
}

/** Showdown aims a missed move at an empty spot beside the target. */
function missed(scene: BattleScene, near: boolean) {
  const sprite = new PokemonSprite(scene, null, { w: 0, h: 0 }, { x: (near ? -1 : 1) * -100, y: 0, z: near ? 0 : 200 }, !near);
  sprite.isMissedPokemon = true;
  return sprite;
}

async function runScene(deps: PlayDeps, build: (scene: BattleScene, t: AnimTables) => void) {
  if (deps.reducedMotion || deps.signal.aborted) return;
  let t: AnimTables;
  try {
    t = await loadAnims();
  } catch {
    return;
  }
  const { stage } = deps;
  const scene = new BattleScene({ fx: stage.fx, bgfx: stage.bgfx, backdrop: stage.backdrop }, t.BattleEffects);
  try {
    build(scene, t);
  } catch (err) {
    console.error("[battle] animation failed:", err);
  }
  await scene.play(deps.speed, deps.signal);
  // A sprite that finished loading mid-animation has a new size: put every sprite where it now belongs.
  stage.repaint();
}

function statusAnim(deps: PlayDeps, who: SlotRef | undefined, id: string) {
  const s = who ? deps.stage.sprite(who) : null;
  if (!s) return Promise.resolve();
  return runScene(deps, (scene, t) => t.BattleStatusAnims[id]?.anim(scene, [proxy(scene, s)]));
}

function otherAnim(deps: PlayDeps, who: SlotRef | undefined, id: string) {
  const s = who ? deps.stage.sprite(who) : null;
  if (!s) return Promise.resolve();
  return runScene(deps, (scene, t) => t.BattleOtherAnims[id]?.anim(scene, [proxy(scene, s), proxy(scene, s)]));
}

const STATUS_LABEL: Record<string, string> = { brn: "Burned", par: "Paralyzed", slp: "Asleep", frz: "Frozen", psn: "Poisoned", tox: "Badly poisoned" };
const STAT_LABEL: Record<string, string> = { atk: "Atk", def: "Def", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "Accuracy", evasion: "Evasion" };
const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-7px)" },
  { transform: "translateX(6px)" },
  { transform: "translateX(-4px)" },
  { transform: "translateX(0)" },
];
/** The hit flash, on the sprite image itself (so its shadow stays a shadow): a white silhouette, then a blink. */
const HIT_FLASH: Keyframe[] = [
  { filter: "brightness(1)" },
  { filter: "brightness(0) invert(1)", offset: 0.1 },
  { filter: "brightness(1.8)", offset: 0.32 },
  { filter: "brightness(0) invert(1)", offset: 0.52 },
  { filter: "brightness(1.3)", offset: 0.72 },
  { filter: "brightness(1)" },
];
/** Recoil and status damage: a blink, no white-out. */
const SOFT_FLASH: Keyframe[] = [{ filter: "brightness(1)" }, { filter: "brightness(2)", offset: 0.25 }, { filter: "brightness(1)", offset: 0.5 }, { filter: "brightness(2)", offset: 0.75 }, { filter: "brightness(1)" }];

const px = (v: string) => parseFloat(v) || 0;
/** A sprite's box on the stage (its inline style, in stage px). */
function boxOf(s: StageSprite) {
  const st = s.el.style;
  return { left: px(st.left), top: px(st.top), width: px(st.width), height: px(st.height) };
}

/** A throwaway element in the effects layer, removed when its animation ends (or the step is skipped). */
function spark(deps: PlayDeps, className: string, style: Partial<CSSStyleDeclaration>, keyframes: Keyframe[], ms: number, easing = "ease-out") {
  if (deps.reducedMotion || deps.signal.aborted) return Promise.resolve();
  const el = document.createElement("div");
  el.className = className;
  Object.assign(el.style, { position: "absolute", pointerEvents: "none", ...style });
  deps.stage.fx.appendChild(el);
  if (typeof el.animate !== "function") {
    el.remove();
    return Promise.resolve();
  }
  const anim = el.animate(keyframes, { duration: Math.max(1, ms / deps.speed), easing, fill: "forwards" });
  const done = () => el.remove();
  const abort = () => anim.finish();
  deps.signal.addEventListener("abort", abort, { once: true });
  return anim.finished.then(done, done).finally(() => deps.signal.removeEventListener("abort", abort));
}

/** An impact burst over a Pokémon that was hit. */
function impact(deps: PlayDeps, s: StageSprite, big = false) {
  const b = boxOf(s);
  const size = Math.max(40, Math.min(b.width, b.height) * (big ? 0.95 : 0.7));
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height * 0.52;
  void spark(deps, "battle-impact", { left: `${cx - size / 2}px`, top: `${cy - size / 2}px`, width: `${size}px`, height: `${size}px`, zIndex: "1" }, [
    { transform: "scale(0.3) rotate(0deg)", opacity: 1 },
    { transform: "scale(1) rotate(18deg)", opacity: 0.9, offset: 0.45 },
    { transform: "scale(1.25) rotate(30deg)", opacity: 0 },
  ], big ? 340 : 260);
}

/** Dust kicked up where a fainting Pokémon falls. */
function dust(deps: PlayDeps, s: StageSprite) {
  const b = boxOf(s);
  const foot = b.top + b.height * 0.92;
  const cx = b.left + b.width / 2;
  const spread = Math.max(36, b.width * 0.55);
  for (let i = 0; i < 9; i++) {
    const dir = (i / 8) * 2 - 1;
    const size = 10 + ((i * 7) % 5) * 4 + b.width * 0.06;
    void spark(deps, "battle-dust", { left: `${cx - size / 2}px`, top: `${foot - size / 2}px`, width: `${size}px`, height: `${size}px`, zIndex: s.near ? "4" : "3" }, [
      { transform: "translate(0, 0) scale(0.4)", opacity: 0 },
      { transform: `translate(${dir * spread * 0.5}px, ${-6 - (i % 3) * 3}px) scale(1)`, opacity: 0.75, offset: 0.3 },
      { transform: `translate(${dir * spread}px, ${-14 - (i % 3) * 6}px) scale(1.6)`, opacity: 0 },
    ], 620 + (i % 3) * 80);
  }
}

/**
 * The send-out: a Poké Ball arcs in from its trainer's side (yours from the
 * bottom left, the opponent's from the top right) and bursts open where the
 * Pokémon appears. Resolves as it bursts.
 */
async function ballIn(deps: PlayDeps, s: StageSprite, look: BallLook) {
  if (deps.reducedMotion || deps.signal.aborted) return;
  const b = boxOf(s);
  const tx = b.left + b.width / 2;
  const ty = b.top + b.height * 0.62;
  const from = s.near ? { x: tx - 230, y: 420 } : { x: tx + 250, y: -30 };
  const size = s.near ? 22 : 16;
  const steps = 8;
  const peak = s.near ? 110 : 60;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = from.x + (tx - from.x) * u;
    const y = from.y + (ty - from.y) * u - Math.sin(u * Math.PI) * peak;
    frames.push({ transform: `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${u * (s.near ? 720 : -720)}deg) scale(${s.near ? 1.4 - u * 0.4 : 0.9 + u * 0.1})`, offset: u });
  }
  await spark(deps, "battle-ball", { left: "0px", top: "0px", width: `${size}px`, height: `${size}px`, background: ballBackground(look), zIndex: "7" }, frames, 300, "linear");
  if (deps.signal.aborted) return;
  const burst = Math.max(70, b.width * 0.9);
  void spark(deps, "battle-ball-burst", { left: `${tx - burst / 2}px`, top: `${ty - burst / 2}px`, width: `${burst}px`, height: `${burst}px`, zIndex: "7" }, [
    { transform: "scale(0.15)", opacity: 1 },
    { transform: "scale(1)", opacity: 0.85, offset: 0.4 },
    { transform: "scale(1.35)", opacity: 0 },
  ], 380);
}

/** A spot of light and particles over a sprite (stat changes, Tera). */
function overlay(deps: PlayDeps, s: StageSprite | null, className: string, ms: number, color?: string) {
  if (!s || deps.reducedMotion || deps.signal.aborted) return Promise.resolve();
  const el = document.createElement("div");
  el.className = className;
  el.style.left = s.el.style.left;
  el.style.top = s.el.style.top;
  el.style.width = s.el.style.width;
  el.style.height = s.el.style.height;
  if (color) el.style.setProperty("--fx-color", color);
  deps.stage.fx.appendChild(el);
  return sleep(ms / deps.speed, deps.signal).then(() => el.remove());
}

export async function playStep(step: Step, deps: PlayDeps): Promise<void> {
  const { stage, commit, popup, signal } = deps;
  const wait = (ms: number) => sleep(ms / deps.speed, signal);
  const snap = step.snap!;
  const who = step.who;
  const sprite = who ? stage.sprite(who) : null;
  const from = typeof step.kw.from === "string" ? step.kw.from.replace(/^(item|ability|move): /, "") : "";

  switch (step.cmd) {
    // The battle's header (format and rules): straight into the log, no pause.
    case "tier":
    case "rule":
      commit(snap);
      return;
    case "-anim":
    case "move": {
      if (!step.kw.still && !step.kw.notarget && sprite && step.moveId) {
        const targets = step.targets ?? [];
        const selfTarget = targets.length === 1 && targets[0].side === who!.side && targets[0].slot === who!.slot;
        await runScene(deps, (scene, t) => {
          const attacker = proxy(scene, sprite);
          const at = (ref: SlotRef) => {
            const s = stage.sprite(ref);
            return s ? proxy(scene, s) : missed(scene, ref.side === stage.me);
          };
          // No target named: Showdown aims at the first opposing Pokémon. A miss aims beside the target.
          const aimed = targets.length ? targets : [{ side: who!.side === "p1" ? "p2" : "p1", slot: 0 } as SlotRef];
          const defenders = step.kw.miss ? [missed(scene, aimed[0].side === stage.me)] : aimed.map(at);
          scene.battle.mySide = { x: 0, y: 0, z: 0 };
          const id = typeof step.kw.anim === "string" ? step.kw.anim.toLowerCase().replace(/[^a-z0-9]/g, "") : step.moveId!;
          moveAnim(t, t.BattleMoveAnims[id] ? id : step.moveId!, selfTarget)(scene, [attacker, ...defenders]);
        });
      }
      commit(snap);
      await wait(step.kw.still ? 350 : 150);
      return;
    }
    case "-damage": {
      if (from === "brn" || from === "psn" || from === "tox") await statusAnim(deps, who, from === "tox" ? "psn" : from);
      commit(snap);
      // A direct hit flashes white with a burst; recoil, status and the like just blink.
      const direct = !from;
      if (sprite && direct) impact(deps, sprite);
      await Promise.all([animateEl(sprite?.el, SHAKE, 320, deps), animateEl(sprite?.el.querySelector("img"), direct ? HIT_FLASH : SOFT_FLASH, 320, deps)]);
      await wait(260);
      return;
    }
    case "-heal": {
      await otherAnim(deps, who, "heal");
      commit(snap);
      await wait(350);
      return;
    }
    case "switch":
    case "drag":
    case "replace": {
      // The Pokémon going back: a red flash as it shrinks into the ball.
      if (sprite && step.replaced && sprite.key === step.replaced) {
        await animateEl(sprite.el, [
          { transform: "scale(1)", opacity: 1, filter: "brightness(1)" },
          { transform: "scale(0.15)", opacity: 0, filter: "brightness(2) sepia(1) saturate(6) hue-rotate(-40deg)" },
        ], 300, deps, "forwards");
      }
      commit(snap);
      await frame();
      // Out of sight until its ball bursts.
      const entering = who ? stage.sprite(who) : null;
      const hide = !deps.reducedMotion && !signal.aborted;
      if (hide && entering) entering.el.style.opacity = "0";
      await frame();
      // Hold the entrance until the sprite has loaded (it was preloaded when the line arrived).
      const img = who ? stage.sprite(who)?.el.querySelector("img") : null;
      if (img && !img.complete) {
        await Promise.race([
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
          sleep(1500, signal),
        ]);
        await frame();
      }
      const next = who ? stage.sprite(who) : null;
      try {
        if (next && hide) next.el.style.opacity = "0";
        if (next && hide) await ballIn(deps, next, stage.ball?.(next.near ? stage.me : stage.me === "p1" ? "p2" : "p1") ?? STANDARD_BALL);
        if (next) next.el.style.opacity = "";
        await animateEl(next?.el, [
          { transform: "scale(0.1)", opacity: 0, filter: "brightness(6)" },
          { transform: "scale(1.06)", opacity: 1, filter: "brightness(2)", offset: 0.6 },
          { transform: "scale(1)", opacity: 1, filter: "brightness(1)" },
        ], 420, deps);
      } finally {
        if (next) next.el.style.opacity = "";
        if (entering && entering !== next) entering.el.style.opacity = "";
      }
      await wait(120);
      return;
    }
    case "faint": {
      // A last flash, a drop with a squash, a fade, and dust where it lands.
      if (sprite) {
        window.setTimeout(() => !signal.aborted && dust(deps, sprite), 230 / deps.speed);
        stage.cheer?.(0.9);
      }
      await animateEl(sprite?.el, [
        { transform: "translateY(0) scale(1, 1)", opacity: 1, filter: "brightness(1)" },
        { transform: "translateY(-4px) scale(0.96, 1.04)", opacity: 1, filter: "brightness(1.7)", offset: 0.14 },
        { transform: "translateY(26px) scale(1.06, 0.9)", opacity: 0.75, filter: "brightness(0.8)", offset: 0.62 },
        { transform: "translateY(40px) scale(1.1, 0.82)", opacity: 0, filter: "brightness(0.6)" },
      ], 560, deps, "forwards", { easing: "cubic-bezier(0.5, 0, 0.8, 0.6)" });
      commit(snap);
      await wait(250);
      return;
    }
    case "-crit": {
      // A freeze-frame: a white flash and a punch-in that holds, then the shake, the splash and the crowd.
      popup(who, "Critical hit!", "crit");
      stage.cheer?.(1);
      if (sprite) impact(deps, sprite, true);
      void spark(deps, "battle-crit-flash", { inset: "0", zIndex: "8" }, [{ opacity: 0.85 }, { opacity: 0.35, offset: 0.4 }, { opacity: 0 }], 240);
      // `add`: on top of the stage's own scale.
      const punch = (k: number) => ({ transform: `translate(320px, 180px) scale(${k}) translate(-320px, -180px)` });
      await animateEl(stage.stage, [punch(1), { ...punch(1.035), offset: 0.2 }, { ...punch(1.035), offset: 0.85 }, punch(1)], 110, deps, "none", { composite: "add", easing: "linear" });
      await animateEl(stage.stage, [
        { transform: "translate(0, 0)" },
        { transform: "translate(-7px, 4px)" },
        { transform: "translate(6px, -3px)" },
        { transform: "translate(-4px, 2px)" },
        { transform: "translate(2px, -1px)" },
        { transform: "translate(0, 0)" },
      ], 260, deps, "none", { composite: "add" });
      commit(snap);
      await wait(90);
      return;
    }
    case "-supereffective":
      popup(who, "Super effective!", "super");
      stage.cheer?.(0.45);
      commit(snap);
      await wait(450);
      return;
    case "-resisted":
      popup(who, "Not very effective…", "weak");
      commit(snap);
      await wait(400);
      return;
    case "-immune":
      popup(who, "No effect", "weak");
      commit(snap);
      await wait(450);
      return;
    case "-miss":
      popup(typeof step.args[2] === "string" ? undefined : who, "Missed!", "info");
      commit(snap);
      await wait(400);
      return;
    case "-status": {
      const status = step.args[2] ?? "";
      await statusAnim(deps, who, status === "tox" ? "psn" : status);
      commit(snap);
      popup(who, STATUS_LABEL[status] ?? status, "bad");
      await wait(450);
      return;
    }
    case "cant": {
      const reason = step.args[2] ?? "";
      if (["slp", "par", "frz"].includes(reason)) await statusAnim(deps, who, reason);
      commit(snap);
      await wait(500);
      return;
    }
    case "-boost":
    case "-unboost": {
      const up = step.cmd === "-boost";
      const amount = Number(step.args[3] ?? 1);
      commit(snap);
      if (amount) {
        popup(who, `${STAT_LABEL[step.args[2] ?? ""] ?? step.args[2]} ${up ? "↑" : "↓"}${amount > 1 ? (up ? "↑" : "↓") : ""}${amount > 2 ? (up ? "↑" : "↓") : ""}`, up ? "good" : "bad");
        await overlay(deps, sprite, `battle-boost ${up ? "battle-boost-up" : "battle-boost-down"}`, 600);
      }
      return;
    }
    case "-terastallize": {
      commit(snap);
      popup(who, `Tera ${step.args[2] ?? ""}!`, "super");
      await overlay(deps, sprite, "battle-tera", 900, teraColor(step.args[2] ?? ""));
      return;
    }
    case "-start": {
      const effect = (step.args[2] ?? "").replace(/^move: /, "").toLowerCase();
      if (effect === "confusion") await statusAnim(deps, who, "confused");
      commit(snap);
      await wait(step.text.trim() ? 450 : 0);
      return;
    }
    case "-activate": {
      const effect = (step.args[2] ?? "").replace(/^(move|ability|item): /, "").toLowerCase();
      if (effect === "confusion") await statusAnim(deps, who, "confused");
      commit(snap);
      await wait(step.text.trim() ? 450 : 0);
      return;
    }
    case "-enditem": {
      if (step.kw.eat) await otherAnim(deps, who, "consume");
      else if (from) await otherAnim(deps, who, "itemoff");
      commit(snap);
      await wait(450);
      return;
    }
    case "turn":
      commit(snap);
      await wait(350);
      return;
    case "-weather":
    case "-fieldstart":
    case "-fieldend":
    case "-sidestart":
    case "-sideend":
      commit(snap);
      await wait(step.kw.upkeep ? 250 : 550);
      return;
    default: {
      commit(snap);
      const text = step.text.trim();
      if (text) await wait(Math.min(900, 280 + text.length * 9));
    }
  }
}

const TERA: Record<string, string> = {
  Normal: "#c9c8a6", Fire: "#ff8c42", Water: "#5aa7ff", Electric: "#ffe14d", Grass: "#7be37b", Ice: "#9ff0ff", Fighting: "#ff6b5b",
  Poison: "#c77dff", Ground: "#e9c46a", Flying: "#b7a6ff", Psychic: "#ff7ab6", Bug: "#c3d93a", Rock: "#d9c27a", Ghost: "#9d7bd8",
  Dragon: "#8f6bff", Dark: "#9b8577", Steel: "#cfd6e6", Fairy: "#ffb3d9", Stellar: "#fff7c2",
};
export const teraColor = (type: string) => TERA[type] ?? "#ffffff";
