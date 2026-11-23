/**
 * How much 3D this device can draw, decided once per page before a Lab scene
 * is built, so a weak phone starts on a light render instead of stuttering
 * for the seconds it takes a scene's own frame-time monitor to step down.
 *
 * Three signals:
 * - the GPU's name (WEBGL_debug_renderer_info, where the browser gives it):
 *   software renderers and old mobile GPUs are weak, discrete and Apple M
 *   chips strong;
 * - memory and cores (navigator.deviceMemory, hardwareConcurrency);
 * - a quick timing probe: a fixed piece of arithmetic, about a millisecond on
 *   a current laptop, timed on the main thread. A slow or busy CPU (an old
 *   phone, a throttled one) takes many times longer.
 *
 * Tiers: 0 weak (lightest everything), 1 a typical phone or tablet, 2 a
 * small laptop or an unknown desktop, 3 a strong computer. Each scene maps
 * the tier onto its own quality ladder and keeps adapting from frame times.
 */

export type DeviceTier = 0 | 1 | 2 | 3;

export type GpuClass = "software" | "weak" | "strong" | "unknown";

export interface DeviceSignals {
  /** A phone or tablet (coarse pointer, or a small screen). */
  phone: boolean;
  gpu: string | null;
  memoryGb?: number;
  cores: number;
  /** The timing probe (ms), or null when it couldn't run. */
  probeMs: number | null;
}

export interface DeviceInfo extends DeviceSignals {
  tier: DeviceTier;
  gpuClass: GpuClass;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen|lavapipe/i;
/** Mobile GPUs from before about 2018, and old integrated graphics. */
const WEAK = /adreno[^0-9]*([1-4]\d\d|5[0-3]\d)\b|mali-(4\d\d|t\d+|g(31|51|52|57|71|72))\b|powervr|sgx|videocore|intel.*(hd graphics [2-5]\d{3}|gma)|apple a(7|8|9|10)\b/i;
const STRONG = /nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro)|apple m\d|adreno[^0-9]*(7\d\d|8\d\d)\b|mali-g(7[1-9]\d|9\d\d)|immortalis/i;

export function classifyGpu(name: string | null): GpuClass {
  if (!name) return "unknown";
  if (SOFTWARE.test(name)) return "software";
  if (STRONG.test(name)) return "strong";
  if (WEAK.test(name)) return "weak";
  return "unknown";
}

/** The probe's time (ms) above which the CPU counts as slow: several times a current phone's. */
export const SLOW_PROBE_MS = 6;
/** ...and as very slow. */
export const VERY_SLOW_PROBE_MS = 14;

/** The tier from the signals (pure, for tests). */
export function tierFrom(s: DeviceSignals): DeviceTier {
  const gpu = classifyGpu(s.gpu);
  const mem = s.memoryGb;
  const probe = s.probeMs ?? 0;
  if (gpu === "software") return 0;
  if (mem !== undefined && mem <= 2) return 0;
  if (probe >= VERY_SLOW_PROBE_MS) return 0;
  if (s.phone) {
    if (gpu === "weak" || (mem !== undefined && mem <= 3) || probe >= SLOW_PROBE_MS) return 0;
    return 1;
  }
  if (gpu === "weak" || probe >= SLOW_PROBE_MS) return 1;
  if (gpu === "strong") return 3;
  if (s.cores <= 4 || (mem !== undefined && mem <= 4)) return 2;
  return 3;
}

/** The GPU's name, from one throwaway context that is given straight back (browsers cap live contexts). */
function gpuName(): string | null {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    // Firefox and newer Chrome give the unmasked name as RENDERER itself.
    const name = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name || null;
  } catch {
    return null;
  }
}

/** A fixed piece of arithmetic, timed: the best of three short runs, so one interruption doesn't count. */
export function timingProbe(): number | null {
  if (typeof performance === "undefined") return null;
  let best = Infinity;
  let sink = 0;
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    let x = 1.0001;
    for (let i = 0; i < 60_000; i++) x = Math.sqrt(x * 1.0001 + i) * 0.5 + Math.sin(i);
    sink += x;
    best = Math.min(best, performance.now() - t0);
  }
  // (Keeps the loop from being optimised away.)
  if (sink === 42) return null;
  return Math.round(best * 100) / 100;
}

let cached: DeviceInfo | null = null;

/** This device's tier and the signals behind it (measured once per page). `?gpu=0..3` pins it, for checks. */
export function deviceInfo(): DeviceInfo {
  if (cached) return cached;
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as Navigator & { deviceMemory?: number };
  const phone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(pointer: coarse)").matches || Math.min(window.screen?.width ?? 1e4, window.screen?.height ?? 1e4) < 600);
  const signals: DeviceSignals = {
    phone,
    gpu: typeof document !== "undefined" ? gpuName() : null,
    memoryGb: nav.deviceMemory,
    cores: nav.hardwareConcurrency || 8,
    probeMs: timingProbe(),
  };
  let tier = tierFrom(signals);
  try {
    const pin = new URLSearchParams(window.location.search).get("gpu");
    if (pin !== null && /^[0-3]$/.test(pin)) tier = Number(pin) as DeviceTier;
  } catch {
    // no address: keep the measured tier
  }
  cached = { ...signals, tier, gpuClass: classifyGpu(signals.gpu) };
  return cached;
}

/** For tests. */
export function resetDeviceInfo() {
  cached = null;
}

/** The tier on a ladder of the usual live qualities. Weak devices start on the lightest; others where each scene used to. */
export function ladderStart<Q extends string>(tier: DeviceTier, ladder: { weak: Q; phone: Q; laptop: Q; desktop: Q }): Q {
  return tier === 0 ? ladder.weak : tier === 1 ? ladder.phone : tier === 2 ? ladder.laptop : ladder.desktop;
}

/**
 * Whether a scene should start on its light render: a weak device, or a computer with a weak GPU or a slow CPU
 * (phones are already started light by each scene's own rules).
 */
export function lightStart(): boolean {
  const d = deviceInfo();
  return d.tier === 0 || (d.tier === 1 && !d.phone);
}

/** Mass Battle's most units drawn on a weak device (the rest of an army is represented, as above any quality's cap). */
export const WEAK_CROWD_CAP = 800;
