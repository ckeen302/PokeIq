/**
 * Polite, cached downloads for the Nuzlocke build (PokéAPI, Serebii, Bulbapedia).
 *
 * Every response is cached gzipped under $DEX_RAW/nuzlocke (default <repo>/.cache/dex-raw/nuzlocke, gitignored), so a
 * rerun is offline. Each host gets at most 4 requests in flight with a minimum gap between starts; failures retry with
 * exponential backoff. Requests go through curl, which honours HTTPS_PROXY and CURL_CA_BUNDLE (Bulbapedia's edge
 * answers Node's fetch with 403 but serves curl).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

export const RAW = path.join(process.env.DEX_RAW ?? path.join(process.cwd(), ".cache/dex-raw"), "nuzlocke");
const UA = "Mozilla/5.0 (compatible; nuzlocke-data-build/1.0)";

type Host = "pokeapi" | "serebii" | "bulbapedia";
const GAP: Record<Host, number> = { pokeapi: 30, serebii: 250, bulbapedia: 1100 };
const MAX_IN_FLIGHT = 4;
const state: Record<Host, { next: number; inFlight: number; waiters: (() => void)[] }> = {
  pokeapi: { next: 0, inFlight: 0, waiters: [] },
  serebii: { next: 0, inFlight: 0, waiters: [] },
  bulbapedia: { next: 0, inFlight: 0, waiters: [] },
};
export const STATS = { fetched: 0, cached: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function slot(host: Host): Promise<() => void> {
  const s = state[host];
  while (s.inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => s.waiters.push(r));
  s.inFlight++;
  const at = Math.max(Date.now(), s.next);
  s.next = at + GAP[host];
  if (at > Date.now()) await sleep(at - Date.now());
  return () => {
    s.inFlight--;
    s.waiters.shift()?.();
  };
}

function curl(url: string, accept?: string): Promise<{ status: number; body: Buffer; url: string }> {
  return new Promise((resolve) => {
    const args = ["-sS", "-L", "--compressed", "-m", "120", "-A", UA, "-w", "\n%{http_code} %{url_effective}", ...(accept ? ["-H", `Accept: ${accept}`] : []), url];
    execFile("curl", args, { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout?.length) return resolve({ status: 0, body: Buffer.alloc(0), url });
      const nl = stdout.lastIndexOf(10);
      const tail = stdout.subarray(nl + 1).toString("utf8");
      const [code, eff] = tail.split(" ");
      resolve({ status: Number(code) || 0, body: stdout.subarray(0, nl), url: eff || url });
    });
  });
}

const fileFor = (rel: string) => {
  const safe = rel.replace(/[^A-Za-z0-9._/-]+/g, "_");
  const long = safe.length > 150 ? `${safe.slice(0, 120)}-${crypto.createHash("sha1").update(rel).digest("hex").slice(0, 10)}` : safe;
  return path.join(RAW, `${long}.gz`);
};

export interface Got {
  /** Response body; null for a 404. */
  body: Buffer | null;
  /** Final URL after redirects. */
  url: string;
}

/** Uncached polite GET with retries: 200 and 404 are answers, anything else is retried with backoff. */
export async function fetchOnce(url: string, host: Host, accept?: string): Promise<{ status: number; body: Buffer; url: string }> {
  for (let attempt = 0; ; attempt++) {
    const release = await slot(host);
    let res: { status: number; body: Buffer; url: string };
    try {
      res = await curl(url, accept);
    } finally {
      release();
    }
    if (res.status === 200 || res.status === 404) {
      STATS.fetched++;
      return res;
    }
    if (attempt >= 6) throw new Error(`GET ${url}: HTTP ${res.status} after ${attempt + 1} attempts`);
    await sleep(2000 * 2 ** attempt);
  }
}

/** Cached GET. `rel` is the cache key (a relative path). 404s are cached as such. */
export async function get(rel: string, url: string, host: Host, accept?: string): Promise<Got> {
  const file = fileFor(rel);
  if (fs.existsSync(file)) {
    STATS.cached++;
    const raw = zlib.gunzipSync(fs.readFileSync(file));
    const nl = raw.indexOf(10);
    const head = JSON.parse(raw.subarray(0, nl).toString("utf8")) as { url: string; status: number };
    return { body: head.status === 404 ? null : raw.subarray(nl + 1), url: head.url };
  }
  const res = await fetchOnce(url, host, accept);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = Buffer.from(JSON.stringify({ url: res.url, status: res.status }) + "\n");
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([head, res.status === 404 ? Buffer.alloc(0) : res.body])));
  return { body: res.status === 404 ? null : res.body, url: res.url };
}

export async function getText(rel: string, url: string, host: Host, encoding: BufferEncoding = "utf8"): Promise<{ text: string | null; url: string }> {
  const g = await get(rel, url, host);
  return { text: g.body ? g.body.toString(encoding) : null, url: g.url };
}

export async function getJson<T>(rel: string, url: string, host: Host = "pokeapi"): Promise<T | null> {
  const g = await get(rel, url, host, "application/json");
  return g.body && g.body.length ? (JSON.parse(g.body.toString("utf8")) as T) : null;
}

/** Run `fn` over `items` with at most `n` in flight (the per-host limiter still applies). */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
