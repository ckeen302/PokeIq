import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { CRY_CONTENT_TYPE, cryFormat, encodeWav, vorbisToWav } from "@/lib/server/cry-audio";
import { mediaToken } from "@/lib/server/media-url";
import { GET } from "@/app/api/media/[token]/route";

/** A quarter second of a 440 Hz tone, Ogg Vorbis at 16 kHz mono (as PokeAPI's cries are Ogg Vorbis). */
const OGG = new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, "fixtures/cry-tone.ogg")));
/** The start of an MP3 (an ID3 tag), as PokeAPI's Pikachu, Meltan and Melmetal "ogg" files really are. */
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

describe("cry audio", () => {
  it("names a cry by what the file holds", () => {
    expect(cryFormat(OGG)).toBe("ogg");
    expect(cryFormat(MP3)).toBe("mp3");
    expect(CRY_CONTENT_TYPE[cryFormat(MP3)]).toBe("audio/mpeg");
  });

  it("writes 16-bit PCM WAV", () => {
    const wav = encodeWav([new Float32Array([0, 1, -1, 0.5])], 8000);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(8000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect([0, 1, 2, 3].map((i) => wav.readInt16LE(44 + i * 2))).toEqual([0, 32767, -32768, 16384]);
  });

  it("decodes an Ogg Vorbis cry to a WAV of the same length", async () => {
    const wav = await vorbisToWav(OGG);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    const rate = wav.readUInt32LE(24);
    expect(rate).toBe(16000);
    const seconds = wav.readUInt32LE(40) / 2 / rate;
    expect(seconds).toBeGreaterThan(0.2);
    expect(seconds).toBeLessThan(0.3);
  });

  it("serves the cry as it is, and a WAV for ?format=wav (Safari)", async () => {
    const real = globalThis.fetch;
    let upstream = 0;
    globalThis.fetch = (async () => {
      upstream++;
      return new Response(OGG, { status: 200, headers: { "content-type": "audio/ogg" } });
    }) as typeof fetch;
    try {
      // A Pokémon no other test asks for, so neither answer comes from the route's memory.
      const token = mediaToken({ kind: "cry", pokemonId: 151 });
      const ask = (query = "") => GET(new NextRequest(`http://localhost:3000/api/media/${token}${query}`), { params: Promise.resolve({ token }) });
      const ogg = await ask();
      expect(ogg.status).toBe(200);
      expect(ogg.headers.get("content-type")).toBe("audio/ogg");
      const wav = await ask("?format=wav");
      expect(wav.status).toBe(200);
      expect(wav.headers.get("content-type")).toBe("audio/wav");
      expect(Buffer.from(await wav.arrayBuffer()).subarray(0, 4).toString()).toBe("RIFF");
      expect(upstream).toBe(2);
    } finally {
      globalThis.fetch = real;
    }
  });
});
