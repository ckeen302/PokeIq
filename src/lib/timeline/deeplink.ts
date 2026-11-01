/**
 * Deep links into /pokedex/timeline. Every entry has its own page,
 * /pokedex/timeline/<id> (its own title and preview card), which opens the
 * 3D view at the entry with its panel open. Older links still work: ?e=<id>
 * and #<id> (the list's anchors) open the same entry. Client-safe.
 */

export const TIMELINE_PATH = "/pokedex/timeline";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Sub-routes of the timeline that are not entries. */
const RESERVED = new Set(["species"]);

export const isEntryId = (s: string) => ID_RE.test(s) && !RESERVED.has(s);

/** The shareable path of an entry. */
export const entryPath = (id: string) => `${TIMELINE_PATH}/${id}`;

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The entry a URL points at, if it is a known one: /pokedex/timeline/<id>
 * first, then ?e=<id>, then #<id>.
 */
export function parseDeepLink(loc: { pathname: string; search?: string; hash?: string }, known: (id: string) => boolean): string | null {
  const candidates: string[] = [];
  const path = loc.pathname.replace(/\/+$/, "");
  if (path.startsWith(`${TIMELINE_PATH}/`)) {
    const rest = path.slice(TIMELINE_PATH.length + 1);
    if (!rest.includes("/")) candidates.push(decode(rest));
  }
  if (loc.search) {
    const e = new URLSearchParams(loc.search).get("e");
    if (e) candidates.push(e);
  }
  if (loc.hash && loc.hash.length > 1) candidates.push(decode(loc.hash.slice(1)));
  for (const c of candidates) {
    const id = c.trim().toLowerCase();
    if (isEntryId(id) && known(id)) return id;
  }
  return null;
}

/**
 * The address bar for an open entry (its own path) or for none (the
 * timeline), keeping any other query (such as ?view=3d) and dropping the
 * older ?e= and # forms.
 */
export function urlFor(id: string | null, search = ""): string {
  const q = new URLSearchParams(search);
  q.delete("e");
  const s = q.toString();
  return `${id ? entryPath(id) : TIMELINE_PATH}${s ? `?${s}` : ""}`;
}
