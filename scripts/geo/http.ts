/**
 * Polite HTTP for the PokéGuessr ingest scripts, through curl.
 *
 * Bulbapedia's edge answers Node's fetch (undici) with 403 but serves curl
 * with the same contact User-Agent (as scripts/trainers/wiki-fetch.ts found),
 * so every wiki request goes through curl: at least GAP_MS between requests to
 * one host, and 403 / 429 / 5xx back off and retry before giving up.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const UA = "PokeIQ-ingest/1.0 (+https://pokeiq.vercel.app; contact via site)";
/** At least this long between two requests to one host. */
const GAP_MS = 1100;
const RETRIES = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Each host's next free slot, in a file shared by every ingest process on the
 * machine, so two scripts running side by side still ask a site at most once
 * per GAP_MS between them.
 */
const SLOTS = path.join(tmpdir(), "pokeiq-geo-http-slots");
mkdirSync(SLOTS, { recursive: true });

async function withHostLock<T>(host: string, fn: () => T): Promise<T> {
  const lock = path.join(SLOTS, `${host}.lock`);
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      // A lock left by a killed process is stale after a few seconds.
      if (i > 100) rmSync(lock, { recursive: true, force: true });
      await sleep(30);
    }
  }
  try {
    return fn();
  } finally {
    rmdirSync(lock);
  }
}

/** Reserves the host's next free slot and waits for it (requests to different hosts don't wait on each other). */
async function slot(host: string, holdMs = GAP_MS) {
  const file = path.join(SLOTS, host);
  const at = await withHostLock(host, () => {
    let next = 0;
    try {
      next = Number(readFileSync(file, "utf8")) || 0;
    } catch {
      // First request to this host.
    }
    const when = Math.max(Date.now(), next);
    writeFileSync(file, String(when + holdMs));
    return when;
  });
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
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
    // Back off: 3 s, 6 s, 12 s … and keep the host quiet meanwhile (for every process).
    await slot(host, 3000 * 2 ** attempt);
  }
}

/** A MediaWiki API call (formatversion 2) through curl. */
export async function wikiApi<T>(base: string, params: Record<string, string>): Promise<T> {
  const body = await httpGet(`${base}?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`);
  return JSON.parse(body.toString("utf8")) as T;
}
