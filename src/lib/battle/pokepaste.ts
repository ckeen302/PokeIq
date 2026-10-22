/**
 * Pokepaste links (https://pokepast.es/<id>): the only host and path the
 * import route will fetch. The id is the paste's 16 hexadecimal characters;
 * the route always fetches https://pokepast.es/<id>/raw itself, never the
 * URL it was given.
 */

export const POKEPASTE_HOST = "pokepast.es";
const ID = /^[0-9a-f]{16}$/;
const PATH = /^\/([0-9a-f]{16})(?:\/raw)?\/?$/;

/** The paste id from a pokepast.es link ("pokepast.es/abc…", with or without https:// and /raw); null for anything else. */
export function pokepasteId(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 200) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  if (url.hostname.toLowerCase() !== POKEPASTE_HOST) return null;
  if (url.search || url.hash) return null;
  const m = PATH.exec(url.pathname.toLowerCase());
  return m ? m[1] : null;
}

/** The one URL the server fetches for a paste id. */
export function pokepasteRawUrl(id: string): string {
  if (!ID.test(id)) throw new Error("Not a pokepaste id.");
  return `https://${POKEPASTE_HOST}/${id}/raw`;
}

/** Pastes bigger than this are refused (a full six-Pokémon team is ~2 KB). */
export const POKEPASTE_MAX_BYTES = 32 * 1024;
export const POKEPASTE_TIMEOUT_MS = 5_000;
