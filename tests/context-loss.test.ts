import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT_REBUILD_MS, watchContext } from "@/lib/gl/context-loss";

const canvas = () => new EventTarget() as unknown as HTMLCanvasElement;
const lose = (c: HTMLCanvasElement) => {
  const e = new Event("webglcontextlost", { cancelable: true });
  c.dispatchEvent(e);
  return e;
};

describe("a lost WebGL context", () => {
  afterEach(() => vi.useRealTimers());

  it("stops drawing, asks for the context back, and rebuilds if it doesn't come", () => {
    vi.useFakeTimers();
    const c = canvas(), gone = vi.fn();
    const w = watchContext(c, gone);
    expect(w.lost).toBe(false);
    expect(lose(c).defaultPrevented).toBe(true);
    expect(w.lost).toBe(true);
    vi.advanceTimersByTime(CONTEXT_REBUILD_MS - 1);
    expect(gone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(gone).toHaveBeenCalledTimes(1);
    c.dispatchEvent(new Event("webglcontextrestored"));
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("rebuilds as soon as the context is restored", () => {
    vi.useFakeTimers();
    const c = canvas(), gone = vi.fn();
    watchContext(c, gone);
    lose(c);
    c.dispatchEvent(new Event("webglcontextrestored"));
    expect(gone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CONTEXT_REBUILD_MS * 2);
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("does nothing once the scene is disposed", () => {
    vi.useFakeTimers();
    const c = canvas(), gone = vi.fn();
    const w = watchContext(c, gone);
    lose(c);
    w.dispose();
    vi.advanceTimersByTime(CONTEXT_REBUILD_MS * 2);
    c.dispatchEvent(new Event("webglcontextrestored"));
    expect(gone).not.toHaveBeenCalled();
  });

  it("is handled by every 3D page", () => {
    const dir = join(process.cwd(), "src/components");
    for (const f of ["sizes/scene/index.ts", "race/scene/index.ts", "timeline/scene.ts", "globe/scene.ts"]) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).toContain("watchContext(canvas, opts.onContextGone)");
      expect(src, f).toContain("ctxWatch.lost");
      expect(src, f).toContain("ctxWatch.dispose()");
    }
    for (const f of ["sizes/SizesExperience.tsx", "race/RaceExperience.tsx", "timeline/TimelineExperience.tsx", "globe/WorldGlobe.tsx"]) {
      expect(readFileSync(join(dir, f), "utf8"), f).toMatch(/onContextGone: \(\) => alive && setSceneGen/);
    }
    // The battle arena falls back to the 2D stage instead.
    expect(readFileSync(join(dir, "battle/play/arena/ArenaScene.ts"), "utf8")).toContain('addEventListener("webglcontextlost"');
  });
});
