import { CHAPTER_IDS } from "./data";

/** /lab/pokemon-story and each chapter's own page (/lab/pokemon-story/<chapter>). */
export const STORY_PATH = "/lab/pokemon-story";

export function chapterPath(id: string | null | undefined): string {
  return id && CHAPTER_IDS.includes(id) ? `${STORY_PATH}/${id}` : STORY_PATH;
}

export function chapterFromPath(pathname: string): string | null {
  const m = pathname.replace(/\/+$/, "").match(/^\/lab\/pokemon-story\/([a-z0-9-]+)$/);
  return m && CHAPTER_IDS.includes(m[1]) ? m[1] : null;
}
