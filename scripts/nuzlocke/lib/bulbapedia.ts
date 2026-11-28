/**
 * Bulbapedia's wikitext through its MediaWiki API (https://bulbapedia.bulbagarden.net/w/api.php), cached through
 * ./fetch. Pages are read 50 titles per request (action=query, prop=revisions), redirects followed.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fetchOnce, RAW } from "./fetch";

const API = "https://bulbapedia.bulbagarden.net/w/api.php";
export const pageUrl = (title: string) => `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":")}`;

export interface WikiPage {
  /** The title asked for. */
  asked: string;
  /** The page's own title after redirects (null when missing). */
  title: string | null;
  text: string | null;
}

type RevQuery = {
  query?: {
    pages: { title: string; missing?: boolean; invalid?: boolean; revisions?: { slots: { main: { content: string } } }[] }[];
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string; tofragment?: string }[];
  };
};

const memo = new Map<string, WikiPage>();

/** Wikitext of many pages (cached per batch of titles, so reruns with the same titles are offline). */
export async function pages(titles: string[]): Promise<Map<string, WikiPage>> {
  const out = new Map<string, WikiPage>();
  const todo = [...new Set(titles)].filter((t) => {
    const m = memo.get(t);
    if (m) out.set(t, m);
    return !m;
  });
  // One cache entry per title, fetched in batches of 50.
  const fileOf = (t: string) => path.join(RAW, "bulbapedia/page", `${encodeURIComponent(t).replace(/%/g, "~").slice(0, 180)}.json.gz`);
  const missing: string[] = [];
  for (const t of todo) {
    const f = fileOf(t);
    if (fs.existsSync(f)) {
      const p = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")) as WikiPage;
      memo.set(t, p);
      out.set(t, p);
    } else missing.push(t);
  }
  // Batches of 50 titles; big pages (a Pokémon's) make a response the API may cut short, so a batch whose answer isn't
  // whole JSON is asked again in halves.
  const queue: string[][] = [];
  for (let i = 0; i < missing.length; i += 50) queue.push(missing.slice(i, i + 50));
  while (queue.length) {
    const batch = queue.shift()!;
    const q = new URLSearchParams({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: batch.join("|"), redirects: "1", format: "json", formatversion: "2" });
    const res = await fetchOnce(`${API}?${q}`, "bulbapedia", "application/json");
    if (res.status !== 200) throw new Error(`Bulbapedia query failed: HTTP ${res.status}`);
    let j: RevQuery;
    try {
      j = JSON.parse(res.body.toString("utf8")) as RevQuery;
    } catch (e) {
      if (batch.length === 1) throw e;
      queue.unshift(batch.slice(0, batch.length >> 1), batch.slice(batch.length >> 1));
      continue;
    }
    // A response cut at the size limit lists the rest without content ("continue"): ask for those again.
    const cut = (j?.query?.pages ?? []).some((p) => !p.missing && !p.invalid && !p.revisions);
    if (cut && batch.length > 1) {
      queue.unshift(batch.slice(0, batch.length >> 1), batch.slice(batch.length >> 1));
      continue;
    }
    const byTitle = new Map((j?.query?.pages ?? []).map((p) => [p.title, p]));
    const hop = (t: string, map?: { from: string; to: string }[]) => map?.find((x) => x.from === t)?.to ?? t;
    for (const t of batch) {
      let resolved = hop(t, j?.query?.normalized);
      for (let k = 0; k < 3; k++) resolved = hop(resolved, j?.query?.redirects);
      const p = byTitle.get(resolved);
      const ok = p && !p.missing && !p.invalid && p.revisions;
      const page: WikiPage = { asked: t, title: ok ? resolved : null, text: ok ? p!.revisions![0].slots.main.content : null };
      fs.mkdirSync(path.dirname(fileOf(t)), { recursive: true });
      fs.writeFileSync(fileOf(t), zlib.gzipSync(JSON.stringify(page)));
      memo.set(t, page);
      out.set(t, page);
    }
  }
  return out;
}

export async function page(title: string): Promise<WikiPage> {
  return (await pages([title])).get(title)!;
}

/* --------------------------------------------------------------- wikitext helpers -- */

/** Split a template body on top-level pipes (ignoring pipes inside nested {{ }} and [[ ]]). */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      cur += two;
      i++;
      continue;
    }
    if ((two === "}}" || two === "]]") && depth > 0) {
      depth--;
      cur += two;
      i++;
      continue;
    }
    if (s[i] === "|" && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

export interface Template {
  name: string;
  /** Positional params (1-based in wiki terms; index 0 here is param 1). */
  pos: string[];
  named: Record<string, string>;
  start: number;
  end: number;
}

/** Every template in `text` (top level and nested), in document order of their start. */
export function templates(text: string): Template[] {
  const out: Template[] = [];
  const stack: number[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") {
      if (text[i + 2] === "{") {
        // {{{param}}}: skip it whole
        const e = text.indexOf("}}}", i);
        if (e > 0) {
          i = e + 2;
          continue;
        }
      }
      stack.push(i);
      i++;
    } else if (text[i] === "}" && text[i + 1] === "}" && stack.length) {
      const s = stack.pop()!;
      const body = text.slice(s + 2, i);
      const parts = splitTop(body);
      const name = parts[0].trim();
      const pos: string[] = [];
      const named: Record<string, string> = {};
      for (const p of parts.slice(1)) {
        const eq = p.indexOf("=");
        const key = eq > 0 ? p.slice(0, eq).trim() : "";
        if (eq > 0 && /^[\w .-]+$/.test(key) && !/[{[]/.test(key)) named[key] = p.slice(eq + 1).trim();
        else pos.push(p.trim());
      }
      out.push({ name, pos, named, start: s, end: i + 2 });
      i++;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Plain text of wikitext: links to their labels, templates for colours/links kept as their text, markup dropped. */
export function plain(s: string): string {
  let t = s;
  for (let k = 0; k < 4; k++) {
    t = t
      .replace(/\{\{(?:color2|colorlink)\|[^|{}]*\|([^{}]*)\}\}/gi, (_, rest: string) => rest.split("|").pop()!)
      .replace(/\{\{tt\|([^|{}]*)(?:\|[^{}]*)?\}\}/gi, "$1")
      .replace(/\{\{PlayerChoice(?:\/\w+)?\|(?:\d+\|)?([^|{}]*)\}\}/gi, "Player choice: $1")
      .replace(/\{\{BlueEevee\|([^|{}]*)\}\}/gi, "Eevee evolved into: $1")
      .replace(/\{\{(?:rt)\|(\d+)\|([^|{}]*)(?:\|[^{}]*)?\}\}/gi, "Route $1")
      .replace(/\{\{(?:p|pkmn|m|t|type|i|a|ka|key|DL|badge|stat|tc|g|gen|ga)\|([^|{}]*)(?:\|([^{}]*))?\}\}/gi, (_, a: string, b?: string) => (b && !/=/.test(b) ? b : a))
      .replace(/\{\{[^{}]*\}\}/g, "")
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1");
  }
  return t
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
