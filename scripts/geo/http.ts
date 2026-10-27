/**
 * Polite HTTP for the PokéGuessr ingest scripts, through curl.
 *
 * Bulbapedia's edge answers Node's fetch (undici) with 403 but serves curl
 * with the same contact User-Agent (as scripts/trainers/wiki-fetch.ts found),
 * so every wiki request goes through curl: at least GAP_MS between requests to
 * one host, and 403 / 429 / 5xx back off and retry before giving up.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const UA = "PokeIQ-ingest/1.0 (+https://pokeiq.vercel.app; contact via site)";
/** At least this long between two requests to one host. */
const GAP_MS = 1100;
const RETRIES = 5;

const nextSlot = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for the host's next free slot (requests to different hosts don't wait on each other). */
async function slot(host: string) {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + GAP_MS);
  if (at > now) await sleep(at - now);
}

const scratch = mkdtempSync(path.join(tmpdir(), "geo-http-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
let n = 0;

function curl(url: string): Promise<{ status: number; body: Buffer }> {
  const out = path.join(scratch, `${process.pid}-${n++}`);
  return new Promise((resolve) => {
    execFile("curl", ["-sS", "-L", "--compressed", "-m", "120", "-A", UA, "-o", out, "-w", "%{http_code}", url], { encoding: "utf8" }, (err, stdout) => {
      const status = Number(stdout.trim()) || 0;
      let body = Buffer.alloc(0);
      try {
        body = readFileSync(out);
      } catch {
        // Nothing written.
      }
      rmSync(out, { force: true });
      resolve({ status: err && !status ? 0 : status, body });
    });
  });
}

/** GETs a URL (politely, retrying refusals and server errors); throws on a final failure. */
export async function httpGet(url: string): Promise<Buffer> {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    await slot(host);
    const { status, body } = await curl(url);
    if (status === 200) return body;
    const retry = status === 0 || status === 403 || status === 429 || status >= 500;
    if (!retry || attempt >= RETRIES) throw new Error(`${status} ${url}`);
    // Back off: 3 s, 6 s, 12 s … and keep the host quiet meanwhile.
    const wait = 3000 * 2 ** attempt;
    nextSlot.set(host, Date.now() + wait);
    await sleep(wait);
  }
}

/** A MediaWiki API call (formatversion 2) through curl. */
export async function wikiApi<T>(base: string, params: Record<string, string>): Promise<T> {
  const body = await httpGet(`${base}?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`);
  return JSON.parse(body.toString("utf8")) as T;
}
