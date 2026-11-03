import { CHAPTER_IDS } from "./data";

/** /lab/world-history and each chapter's own page (/lab/world-history/<chapter>). */
export const HISTORY_PATH = "/lab/world-history";

export function chapterPath(id: string | null | undefined): string {
  return id && CHAPTER_IDS.includes(id) ? `${HISTORY_PATH}/${id}` : HISTORY_PATH;
}

/** The chapter a path names, or null for the hub (and anything unknown). */
export function chapterFromPath(pathname: string): string | null {
  const m = pathname.replace(/\/+$/, "").match(/^\/lab\/world-history\/([a-z-]+)$/);
  return m && CHAPTER_IDS.includes(m[1]) ? m[1] : null;
}
