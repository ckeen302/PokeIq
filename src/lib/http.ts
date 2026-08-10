/**
 * Unified HTTP layer for all upstream (PokéAPI) traffic.
 *
 * - Per-request timeout (AbortController)
 * - Exponential backoff + full jitter on 429/5xx, honoring Retry-After
 * - TTL cache (default 1 hour) with soft size cap
 * - Request coalescing: N concurrent callers for the same URL → 1 fetch
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 3;
const MAX_CACHE_ENTRIES = 4_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export interface FetchOptions {
  ttlMs?: number;
  timeoutMs?: number;
  retries?: number;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full-jitter exponential backoff: random(0, base * 2^attempt), capped. */
function backoffMs(attempt: number): number {
  const base = 400;
  const cap = 8_000;
  return Math.random() * Math.min(cap, base * 2 ** attempt);
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function evictIfNeeded(): void {
  if (cache.size < MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  // Still over cap after pruning expired entries → drop oldest-inserted.
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
        // We manage caching ourselves; keep Next's fetch cache out of the way.
        cache: "no-store",
      });
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        lastError = new UpstreamError(
          `Upstream responded ${res.status}`,
          res.status,
          url,
        );
        if (attempt < retries) {
          const wait = retryAfterMs(res) ?? backoffMs(attempt);
          await sleep(wait);
          continue;
        }
        throw lastError;
      }
      // 4xx other than 429 will not improve on retry.
      throw new UpstreamError(
        `Upstream responded ${res.status}`,
        res.status,
        url,
      );
    } catch (error) {
      if (error instanceof UpstreamError) {
        if (error.status !== undefined && error.status !== 429 && error.status < 500) {
          throw error;
        }
        lastError = error;
      } else {
        // Network failure or timeout abort — retryable.
        lastError = error;
      }
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new UpstreamError("Request failed", undefined, url);
}

/**
 * Fetch JSON with caching + coalescing. The cache key is the URL, so any
 * concurrent callers share one network request and one parsed result.
 */
export async function fetchJson<T>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const {
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
  } = options;

  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const request = (async () => {
    try {
      const res = await fetchWithRetry(url, timeoutMs, retries);
      const value = (await res.json()) as T;
      evictIfNeeded();
      cache.set(url, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, request);
  return request;
}

const urlOkCache = new Map<string, CacheEntry>();
const urlOkInflight = new Map<string, Promise<boolean>>();

/**
 * Cheap existence check for an image URL (HEAD, falling back to GET on 405).
 * Cached so validation never re-hits the CDN for known-good sprites.
 */
export async function urlOk(url: string): Promise<boolean> {
  const cached = urlOkCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value as boolean;

  const pending = urlOkInflight.get(url);
  if (pending) return pending;

  const request = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        let res = await fetch(url, { method: "HEAD", signal: controller.signal });
        if (res.status === 405) {
          res = await fetch(url, { method: "GET", signal: controller.signal });
        }
        const ok = res.ok;
        urlOkCache.set(url, {
          value: ok,
          // Cache misses briefly — a sprite may appear after a CDN hiccup.
          expiresAt: Date.now() + (ok ? DEFAULT_TTL_MS : 60_000),
        });
        return ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    } finally {
      urlOkInflight.delete(url);
    }
  })();

  urlOkInflight.set(url, request);
  return request;
}
