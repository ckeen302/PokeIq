import "server-only";

/**
 * Pokémon cries for every browser. PokeAPI's cries are Ogg Vorbis, which
 * Safari (macOS and every iOS browser) can't play, and three of them
 * (Pikachu, Meltan, Melmetal) are really MP3s under an .ogg name. So the
 * media route names each file by what it really holds, and for a browser
 * without Ogg Vorbis it decodes the cry here and sends it as a WAV, which
 * plays everywhere. A cry is a second or two of mono sound, so the WAV stays
 * around 100 KB.
 */

export type CryFormat = "ogg" | "mp3";

/** What a cry file really holds, from its first bytes. */
export function cryFormat(body: Uint8Array): CryFormat {
  // "OggS" starts every Ogg page; anything else PokeAPI serves is MP3 (an ID3 tag or a frame sync).
  return body[0] === 0x4f && body[1] === 0x67 && body[2] === 0x67 && body[3] === 0x53 ? "ogg" : "mp3";
}

export const CRY_CONTENT_TYPE: Record<CryFormat | "wav", string> = { ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav" };

/** 16-bit PCM WAV of the given channels (all the same length). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Buffer {
  const count = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * count * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16); // fmt chunk size
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(count, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * count * 2, 28); // byte rate
  out.writeUInt16LE(count * 2, 32); // block align
  out.writeUInt16LE(16, 34); // bits per sample
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataBytes, 40);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), at);
      at += 2;
    }
  }
  return out;
}

/** An Ogg Vorbis cry as a WAV. The decoder (WebAssembly) loads on the first call only. */
export async function vorbisToWav(ogg: Uint8Array): Promise<Buffer> {
  const { OggVorbisDecoder } = await import("@wasm-audio-decoders/ogg-vorbis");
  const decoder = new OggVorbisDecoder();
  try {
    await decoder.ready;
    const { channelData, samplesDecoded, sampleRate } = await decoder.decodeFile(ogg);
    if (!samplesDecoded || !sampleRate) throw new Error("cry decoded to no samples");
    return encodeWav(channelData.map((c) => c.subarray(0, samplesDecoded)), sampleRate);
  } finally {
    decoder.free();
  }
}
