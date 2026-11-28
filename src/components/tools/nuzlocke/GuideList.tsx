"use client";

import { useMemo } from "react";
import { artSrc } from "@/lib/nuzlocke/view";

/**
 * An area's Pokémon on a game's page, by way of meeting them: the server works out every line, this writes them as plain
 * markup. A game's page lists thousands (Sword & Shield's Wild Area alone, hundreds), and the page's React data carries
 * what it renders: as rows of data that's a fraction of the markup, where markup (or a React tree) would be twice it.
 * The same string is built on the server and when the page hydrates, so React keeps the server's markup.
 */

/**
 * A row: its Pokédex link, picture, name, line ("45% · Lv 2–5"), the version it's only in with that version's colour
 * ("" for none), and its post-game line ("After the Hall of Fame: Lv 60"), shown muted under the story's.
 */
export type GuideRow = [href: string, art: number, name: string, text: string, only?: string, color?: string, post?: string];
/** A way of meeting: its icon (in the page's icon sheet), its heading, its kind when the heading doesn't say it ("Gift"), its rows. */
export type GuideGroup = [icon: string, label: string, kind: string | null, rows: GuideRow[]];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function row([href, art, name, text, only, color, post]: GuideRow): string {
  const tag = only ? `<i class="nzg-only" style="--v:${esc(color ?? "")}">${esc(only)}</i>` : "";
  const later = post ? `<small class="nzg-post">${esc(post)}</small>` : "";
  return `<li><a href="${esc(href)}"><img src="${artSrc(art)}" alt="" loading="lazy"><span><b>${esc(name)}</b>${tag}${text ? `<small>${esc(text)}</small>` : ""}${later}</span></a></li>`;
}

export function GuideList({ groups }: { groups: GuideGroup[] }) {
  const html = useMemo(
    () =>
      groups
        .map(([icon, label, kind, rows]) => `<p class="nzg-h"><svg aria-hidden="true"><use href="#nzi-${esc(icon)}"/></svg>${esc(label)}${kind ? `<i>${esc(kind)}</i>` : ""}</p><ul class="nzg-l">${rows.map(row).join("")}</ul>`)
        .join(""),
    [groups]
  );
  return <div className="nzg mt-3" dangerouslySetInnerHTML={{ __html: html }} />;
}
