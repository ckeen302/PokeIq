/// <reference lib="webworker" />
import { encodeGif } from "./gif";

/** Encodes a GIF off the main thread: { width, height, frames: [{ rgba, delay }] } → Uint8Array. */
self.onmessage = (e: MessageEvent<{ width: number; height: number; frames: { rgba: Uint8ClampedArray; delay: number }[] }>) => {
  const { width, height, frames } = e.data;
  try {
    const out = encodeGif(width, height, frames);
    (self as unknown as Worker).postMessage({ ok: true, bytes: out }, [out.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
