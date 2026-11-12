import { describe, expect, it } from "vitest";
import { encryptJson } from "@/lib/server/crypto";
import { MEDIA_WINDOW_MS, mediaToken, mediaUrl, readMediaToken } from "@/lib/server/media-url";

const T = Date.UTC(2026, 10, 11, 13, 0, 0);

describe("media tokens", () => {
  it("round-trips kind, id, step and crop", () => {
    expect(readMediaToken(mediaToken({ kind: "silhouette", pokemonId: 25 }, T), T)).toEqual({ kind: "silhouette", id: 25, step: 1, crop: 0 });
    expect(readMediaToken(mediaToken({ kind: "zoom-reveal", pokemonId: 10091, step: 4, crop: 3 }, T), T)).toEqual({ kind: "zoom-reveal", id: 10091, step: 4, crop: 3 });
  });

  it("is the same URL for everyone within a window, so a CDN can cache it", () => {
    const a = mediaToken({ kind: "silhouette", pokemonId: 25 }, T);
    expect(mediaToken({ kind: "silhouette", pokemonId: 25 }, T + 60_000)).toBe(a);
    expect(mediaUrl({ kind: "silhouette", pokemonId: 25 })).toMatch(/^\/api\/media\/[\w-]{22}$/);
  });

  it("reveals nothing: no id or kind in the clear, unrelated tokens for neighbours and kinds", () => {
    const pika = mediaToken({ kind: "silhouette", pokemonId: 25 }, T);
    const raichu = mediaToken({ kind: "silhouette", pokemonId: 26 }, T);
    const pikaArt = mediaToken({ kind: "artwork", pokemonId: 25 }, T);
    expect(pika).not.toContain("25");
    const shared = (x: string, y: string) => [...x].filter((c, i) => y[i] === c).length;
    // Random-looking 22-char strings share about 0.3 characters by position.
    expect(shared(pika, raichu)).toBeLessThan(6);
    expect(shared(pika, pikaArt)).toBeLessThan(6);
  });

  it("changes every window and expires after the next one", () => {
    const now = mediaToken({ kind: "silhouette", pokemonId: 25 }, T);
    expect(mediaToken({ kind: "silhouette", pokemonId: 25 }, T + MEDIA_WINDOW_MS)).not.toBe(now);
    expect(readMediaToken(now, T + MEDIA_WINDOW_MS)).toMatchObject({ id: 25 });
    expect(readMediaToken(now, T + 2 * MEDIA_WINDOW_MS)).toBe("expired");
  });

  it("rejects forgeries and tampering", () => {
    const t = mediaToken({ kind: "cry", pokemonId: 1 }, T);
    const flipped = (t[0] === "A" ? "B" : "A") + t.slice(1);
    expect(readMediaToken(flipped, T)).toBeNull();
    expect(readMediaToken("A".repeat(22), T)).toBeNull();
    expect(readMediaToken("not-a-token", T)).toBeNull();
  });

  it("still accepts the older per-request tokens until they expire", () => {
    const legacy = encryptJson({ k: "zoom-reveal", id: 6, x: T + 1000, s: 2, c: 1 });
    expect(readMediaToken(legacy, T)).toEqual({ kind: "zoom-reveal", id: 6, step: 2, crop: 1 });
    expect(readMediaToken(legacy, T + 2000)).toBe("expired");
  });
});
