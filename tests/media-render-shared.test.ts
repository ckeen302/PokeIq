import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { mediaToken } from "@/lib/server/media-url";
import { GET } from "@/app/api/media/[token]/route";

describe("question pictures under load", () => {
  it("renders a picture once for players who ask for it at the same moment", async () => {
    const art = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } } }).png().toBuffer();
    const real = globalThis.fetch;
    let upstream = 0;
    globalThis.fetch = (async () => {
      upstream++;
      await new Promise((r) => setTimeout(r, 30));
      return new Response(new Uint8Array(art), { status: 200, headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    try {
      const token = mediaToken({ kind: "artwork", pokemonId: 133 });
      const ask = () => GET(new NextRequest(`http://localhost:3000/api/media/${token}`), { params: Promise.resolve({ token }) });
      const answers = await Promise.all(Array.from({ length: 25 }, ask));
      expect(answers.map((r) => r.status)).toEqual(Array(25).fill(200));
      expect(upstream).toBe(1);
      // Kept afterwards too.
      expect((await ask()).status).toBe(200);
      expect(upstream).toBe(1);
    } finally {
      globalThis.fetch = real;
    }
  });
});
