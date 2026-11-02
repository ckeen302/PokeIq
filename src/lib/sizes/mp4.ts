/**
 * A small MP4 (ISO BMFF) muxer for the videos /pokedex/sizes makes: one
 * H.264 video track and an optional AAC or Opus audio track, written as a
 * single "fast start" file (ftyp, moov, then mdat) so it plays and uploads
 * anywhere, including TikTok, Reels and Shorts. Samples are the encoded
 * chunks WebCodecs hands back (avcC / AudioSpecificConfig / OpusHead as
 * the decoder descriptions). Pure TypeScript, no DOM: unit-tested in Node.
 */

export interface Mp4VideoConfig {
  width: number;
  height: number;
  /** The avcC record (VideoEncoder's decoderConfig.description). */
  description: Uint8Array;
}

export interface Mp4AudioConfig {
  codec: "aac" | "opus";
  sampleRate: number;
  channels: number;
  /** AAC: the AudioSpecificConfig; Opus: the OpusHead (both optional). */
  description?: Uint8Array;
}

interface Sample {
  track: 0 | 1;
  data: Uint8Array;
  /** Presentation time and duration in the track's timescale. */
  pts: number;
  dur: number;
  key: boolean;
}

const VIDEO_TS = 90_000;

class Writer {
  private chunks: Uint8Array[] = [];
  size = 0;
  bytes(b: Uint8Array) { this.chunks.push(b); this.size += b.length; }
  u8(v: number) { this.bytes(new Uint8Array([v & 255])); }
  u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); this.bytes(b); }
  i16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); this.bytes(b); }
  u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); this.bytes(b); }
  i32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); this.bytes(b); }
  str(s: string) { this.bytes(new TextEncoder().encode(s)); }
  zeros(n: number) { this.bytes(new Uint8Array(n)); }
  out(): Uint8Array {
    const o = new Uint8Array(this.size);
    let at = 0;
    for (const c of this.chunks) { o.set(c, at); at += c.length; }
    return o;
  }
}

/** A box: 4-byte size, 4-byte type, then the body `fill` writes. */
function box(type: string, fill: (w: Writer) => void): Uint8Array {
  const body = new Writer();
  fill(body);
  const w = new Writer();
  w.u32(8 + body.size);
  w.str(type);
  w.bytes(body.out());
  return w.out();
}
const full = (type: string, version: number, flags: number, fill: (w: Writer) => void) =>
  box(type, (w) => { w.u8(version); w.u8(flags >> 16); w.u8(flags >> 8); w.u8(flags); fill(w); });

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

/** MPEG-4 descriptor with a 4-byte length. */
function descr(tag: number, body: Uint8Array): Uint8Array {
  const w = new Writer();
  w.u8(tag);
  const n = body.length;
  w.u8(0x80 | ((n >> 21) & 0x7f)); w.u8(0x80 | ((n >> 14) & 0x7f)); w.u8(0x80 | ((n >> 7) & 0x7f)); w.u8(n & 0x7f);
  w.bytes(body);
  return w.out();
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** AAC-LC AudioSpecificConfig for a sample rate and channel count. */
export function aacConfig(sampleRate: number, channels: number): Uint8Array {
  const fi = Math.max(0, AAC_RATES.indexOf(sampleRate));
  return new Uint8Array([(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (channels << 3)]);
}

export class Mp4Muxer {
  private samples: Sample[] = [];
  private vCount = 0;

  constructor(private video: Mp4VideoConfig, private audio?: Mp4AudioConfig) {}

  /** An encoded video frame, in decode order (times in microseconds). */
  addVideo(data: Uint8Array, timestampUs: number, durationUs: number, key: boolean) {
    if (!this.vCount && !key) throw new Error("mp4: the first video frame must be a key frame");
    this.vCount++;
    this.samples.push({ track: 0, data, pts: Math.round((timestampUs * VIDEO_TS) / 1e6), dur: Math.max(1, Math.round((durationUs * VIDEO_TS) / 1e6)), key });
  }

  /** An encoded audio packet (times in microseconds). */
  addAudio(data: Uint8Array, timestampUs: number, durationUs: number) {
    if (!this.audio) return;
    const ts = this.audioTimescale();
    this.samples.push({ track: 1, data, pts: Math.round((timestampUs * ts) / 1e6), dur: Math.max(1, Math.round((durationUs * ts) / 1e6)), key: true });
  }

  private audioTimescale() {
    return this.audio?.codec === "opus" ? 48_000 : this.audio?.sampleRate ?? 48_000;
  }

  /** The finished file. */
  finalize(): Uint8Array {
    const vs = this.samples.filter((s) => s.track === 0);
    if (!vs.length) throw new Error("mp4: no video frames");
    const as = this.samples.filter((s) => s.track === 1);

    // Decode times: the presentation times in order, shifted so no frame is shown before it is decoded.
    const sorted = vs.map((s) => s.pts).sort((a, b) => a - b);
    let shift = 0;
    vs.forEach((s, i) => { shift = Math.max(shift, sorted[i] - s.pts); });
    const vDts = sorted.map((p) => p - shift);
    const vOff = vs.map((s, i) => s.pts - vDts[i]);
    const vStart = Math.min(...vs.map((s) => s.pts));
    const vEnd = Math.max(...vs.map((s) => s.pts + s.dur));

    // mdat: video and audio interleaved by time.
    const order = [...vs.map((s, i) => ({ s, t: vDts[i] / VIDEO_TS })), ...as.map((s) => ({ s, t: s.pts / this.audioTimescale() }))].sort((a, b) => a.t - b.t || a.s.track - b.s.track);
    const offsets = new Map<Sample, number>();
    let mdatSize = 8;
    for (const o of order) { offsets.set(o.s, mdatSize); mdatSize += o.s.data.length; }

    const ftyp = box("ftyp", (w) => { w.str("isom"); w.u32(0x200); w.str("isom"); w.str("iso2"); w.str("avc1"); w.str("mp41"); });
    // The moov's size does not depend on the offsets' values, so build it once to measure, then for real.
    const build = (base: number) => this.moov(vs, vDts, vOff, vStart, vEnd, shift, as, (s) => base + offsets.get(s)!);
    const moovSize = build(0).length;
    const moov = build(ftyp.length + moovSize);
    const w = new Writer();
    w.bytes(ftyp);
    w.bytes(moov);
    w.u32(mdatSize);
    w.str("mdat");
    for (const o of order) w.bytes(o.s.data);
    return w.out();
  }

  private moov(vs: Sample[], vDts: number[], vOff: number[], vStart: number, vEnd: number, shift: number, as: Sample[], off: (s: Sample) => number): Uint8Array {
    const movieTs = 1000;
    const vDur = vEnd - vStart;
    const aTs = this.audioTimescale();
    const aDur = as.length ? as[as.length - 1].pts + as[as.length - 1].dur - as[0].pts : 0;
    const movieDur = Math.max(Math.round((vDur * movieTs) / VIDEO_TS), Math.round((aDur * movieTs) / aTs));
    const tracks = [this.videoTrak(vs, vDts, vOff, vStart, vDur, shift, off, movieTs)];
    if (this.audio && as.length) tracks.push(this.audioTrak(as, aDur, off, movieTs));
    return box("moov", (w) => {
      w.bytes(full("mvhd", 0, 0, (b) => {
        b.u32(0); b.u32(0); b.u32(movieTs); b.u32(movieDur);
        b.u32(0x00010000); b.u16(0x0100); b.zeros(10);
        MATRIX.forEach((m) => b.u32(m));
        b.zeros(24); b.u32(tracks.length + 1);
      }));
      tracks.forEach((t) => w.bytes(t));
    });
  }

  private tkhd(id: number, dur: number, audio: boolean) {
    return full("tkhd", 0, 3, (b) => {
      b.u32(0); b.u32(0); b.u32(id); b.u32(0); b.u32(dur); b.zeros(8);
      b.u16(0); b.u16(0); b.u16(audio ? 0x0100 : 0); b.u16(0);
      MATRIX.forEach((m) => b.u32(m));
      b.u32(audio ? 0 : this.video.width << 16); b.u32(audio ? 0 : this.video.height << 16);
    });
  }

  private mdhd(ts: number, dur: number) {
    return full("mdhd", 0, 0, (b) => { b.u32(0); b.u32(0); b.u32(ts); b.u32(dur); b.u16(0x55c4); b.u16(0); });
  }

  private hdlr(type: string, name: string) {
    return full("hdlr", 0, 0, (b) => { b.u32(0); b.str(type); b.zeros(12); b.str(name); b.u8(0); });
  }

  private dinf() {
    return box("dinf", (w) => w.bytes(full("dref", 0, 0, (b) => { b.u32(1); b.bytes(full("url ", 0, 1, () => {})); })));
  }

  /** Run-length (count, delta) pairs. */
  private runs(values: number[]): [number, number][] {
    const out: [number, number][] = [];
    for (const v of values) {
      const last = out[out.length - 1];
      if (last && last[1] === v) last[0]++; else out.push([1, v]);
    }
    return out;
  }

  private stblCommon(samples: Sample[], deltas: number[], off: (s: Sample) => number): Uint8Array[] {
    const stts = full("stts", 0, 0, (b) => { const r = this.runs(deltas); b.u32(r.length); r.forEach(([n, d]) => { b.u32(n); b.u32(d); }); });
    const stsc = full("stsc", 0, 0, (b) => { b.u32(1); b.u32(1); b.u32(1); b.u32(1); });
    const stsz = full("stsz", 0, 0, (b) => { b.u32(0); b.u32(samples.length); samples.forEach((s) => b.u32(s.data.length)); });
    const stco = full("stco", 0, 0, (b) => { b.u32(samples.length); samples.forEach((s) => b.u32(off(s))); });
    return [stts, stsc, stsz, stco];
  }

  private videoTrak(vs: Sample[], vDts: number[], vOff: number[], vStart: number, vDur: number, shift: number, off: (s: Sample) => number, movieTs: number) {
    const { width, height, description } = this.video;
    const deltas = vDts.map((d, i) => (i + 1 < vDts.length ? vDts[i + 1] - d : vs[i].dur));
    const avc1 = box("avc1", (w) => {
      w.zeros(6); w.u16(1); w.zeros(16);
      w.u16(width); w.u16(height); w.u32(0x00480000); w.u32(0x00480000); w.u32(0); w.u16(1);
      const name = new Uint8Array(32); w.bytes(name);
      w.u16(0x18); w.i16(-1);
      w.bytes(box("avcC", (b) => b.bytes(description)));
    });
    const stsd = full("stsd", 0, 0, (b) => { b.u32(1); b.bytes(avc1); });
    const keys = vs.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
    const stss = full("stss", 0, 0, (b) => { b.u32(keys.length); keys.forEach((k) => b.u32(k)); });
    const anyOff = vOff.some((o) => o !== 0);
    const ctts = anyOff ? full("ctts", 0, 0, (b) => { const r = this.runs(vOff); b.u32(r.length); r.forEach(([n, o]) => { b.u32(n); b.u32(o); }); }) : null;
    const [stts, stsc, stsz, stco] = this.stblCommon(vs, deltas, off);
    const tkDur = Math.round((vDur * movieTs) / VIDEO_TS);
    // With reordered frames the first decode time is earlier than the first shown frame: an edit list starts playback there.
    const mediaStart = vStart - (vDts[0] ?? 0);
    const edts = mediaStart > 0 || shift > 0
      ? box("edts", (w) => w.bytes(full("elst", 0, 0, (b) => { b.u32(1); b.u32(tkDur); b.i32(mediaStart); b.u16(1); b.u16(0); })))
      : null;
    return box("trak", (w) => {
      w.bytes(this.tkhd(1, tkDur, false));
      if (edts) w.bytes(edts);
      w.bytes(box("mdia", (m) => {
        m.bytes(this.mdhd(VIDEO_TS, (vDts[vDts.length - 1] ?? 0) + deltas[deltas.length - 1] - (vDts[0] ?? 0)));
        m.bytes(this.hdlr("vide", "PokeIQ video"));
        m.bytes(box("minf", (n) => {
          n.bytes(full("vmhd", 0, 1, (b) => b.zeros(8)));
          n.bytes(this.dinf());
          n.bytes(box("stbl", (s) => { s.bytes(stsd); s.bytes(stts); if (ctts) s.bytes(ctts); s.bytes(stss); s.bytes(stsc); s.bytes(stsz); s.bytes(stco); }));
        }));
      }));
    });
  }

  private audioTrak(as: Sample[], aDur: number, off: (s: Sample) => number, movieTs: number) {
    const a = this.audio!;
    const ts = this.audioTimescale();
    const deltas = as.map((s, i) => (i + 1 < as.length ? as[i + 1].pts - s.pts : s.dur));
    const entry = a.codec === "aac" ? this.mp4a(a) : this.opus(a);
    const stsd = full("stsd", 0, 0, (b) => { b.u32(1); b.bytes(entry); });
    const [stts, stsc, stsz, stco] = this.stblCommon(as, deltas, off);
    return box("trak", (w) => {
      w.bytes(this.tkhd(2, Math.round((aDur * movieTs) / ts), true));
      w.bytes(box("mdia", (m) => {
        m.bytes(this.mdhd(ts, aDur));
        m.bytes(this.hdlr("soun", "PokeIQ audio"));
        m.bytes(box("minf", (n) => {
          n.bytes(full("smhd", 0, 0, (b) => { b.u16(0); b.u16(0); }));
          n.bytes(this.dinf());
          n.bytes(box("stbl", (s) => { s.bytes(stsd); s.bytes(stts); s.bytes(stsc); s.bytes(stsz); s.bytes(stco); }));
        }));
      }));
    });
  }

  private audioEntryHead(w: Writer, channels: number, rate: number) {
    w.zeros(6); w.u16(1); w.zeros(8);
    w.u16(channels); w.u16(16); w.u16(0); w.u16(0);
    w.u32(Math.min(rate, 65535) << 16);
  }

  private mp4a(a: Mp4AudioConfig) {
    const asc = a.description?.length ? a.description : aacConfig(a.sampleRate, a.channels);
    const dcd = new Writer();
    dcd.u8(0x40); dcd.u8(0x15); dcd.u8(0); dcd.u16(0); dcd.u32(0); dcd.u32(0);
    dcd.bytes(descr(0x05, asc));
    const es = new Writer();
    es.u16(1); es.u8(0);
    es.bytes(descr(0x04, dcd.out()));
    es.bytes(descr(0x06, new Uint8Array([0x02])));
    return box("mp4a", (w) => {
      this.audioEntryHead(w, a.channels, a.sampleRate);
      w.bytes(full("esds", 0, 0, (b) => b.bytes(descr(0x03, es.out()))));
    });
  }

  private opus(a: Mp4AudioConfig) {
    // OpusHead (little-endian): "OpusHead", version, channels, pre-skip, input rate, gain, mapping family.
    let preSkip = 312, inputRate = a.sampleRate, gain = 0;
    const d = a.description;
    if (d && d.length >= 19 && new TextDecoder().decode(d.subarray(0, 8)) === "OpusHead") {
      const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
      preSkip = v.getUint16(10, true);
      inputRate = v.getUint32(12, true);
      gain = v.getInt16(16, true);
    }
    return box("Opus", (w) => {
      this.audioEntryHead(w, a.channels, 48_000);
      w.bytes(box("dOps", (b) => { b.u8(0); b.u8(a.channels); b.u16(preSkip); b.u32(inputRate); b.i16(gain); b.u8(0); }));
    });
  }
}

/** Top-level and nested boxes of an MP4, for checks: [{ type, size, children }]. */
export interface BoxInfo { type: string; start: number; size: number; children?: BoxInfo[] }
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]);
export function readBoxes(buf: Uint8Array, start = 0, end = buf.length): BoxInfo[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: BoxInfo[] = [];
  let at = start;
  while (at + 8 <= end) {
    const size = v.getUint32(at);
    const type = String.fromCharCode(buf[at + 4], buf[at + 5], buf[at + 6], buf[at + 7]);
    if (size < 8 || at + size > end) break;
    const info: BoxInfo = { type, start: at, size };
    if (CONTAINERS.has(type)) info.children = readBoxes(buf, at + 8, at + size);
    out.push(info);
    at += size;
  }
  return out;
}
