import { artUrl, boardArtUrl } from "@/lib/pokemon/art";
import type { StatKey } from "@/lib/pokemon/constants";
import { TYPES, capitalize } from "@/lib/pokemon/type-matrix";
import { formatValue, isBuiltPage, ranking, rankingPath, type Metric, type Ranked, type Scope } from "@/lib/dex/rankings";

/** Rows whose picture loads straight away (the first screen); the rest load as they scroll in. */
const EAGER_ROWS = 8;
/**
 * Rows in the page's own HTML. The rest of a long list (every Pokémon is over
 * a thousand rows) comes from the list's /rows file as the reader nears the
 * end of these, or at once for a link to a row further down.
 */
export const FIRST_ROWS = 100;
export const STATS: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** The table's column count for a list (the rank, the Pokémon, its types, the value, the context columns and the generation). */
export function columnCount(m: Metric): number {
  return 5 + (m.key === "bst" ? STATS.length : 1);
}

/** Where the rest of a list's rows are served. */
export const restRowsPath = (m: Metric, s: Scope) => `${rankingPath(m.slug, s)}/rows`;

/** Where a type badge in the table goes: this list for that type, if it has a page, else the type's page. */
function typeHref(m: Metric, type: string): string {
  const s: Scope = { kind: "type", type: type as (typeof TYPES)[number] };
  return isBuiltPage(m.slug, s) ? rankingPath(m.slug, s) : `/pokedex/types/${type}`;
}

const esc = (x: string | number) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function valueHtml(key: Metric["key"], v: number): string {
  const f = formatValue(key, v);
  return `<b>${esc(f.main)}</b>${f.alt ? `<small>${esc(f.alt)}</small>` : ""}`;
}

/**
 * Rows of the table as HTML: rank, Pokémon, types, the value, and the
 * context columns. Ids, slugs and paths are [a-z0-9-/] only (asserted in
 * tests), so their attributes go unquoted: the markup is also carried,
 * escaped, in the page's RSC payload, and every quote counts twice there.
 * `offset` is the index of the first row in the whole list.
 */
export function rowsHtml(m: Metric, rows: Ranked[], offset = 0): string {
  const size = m.key === "weight" || m.key === "height";
  const typeLinks = new Map(TYPES.map((t) => [t as string, `<a class=t-${t} href=${typeHref(m, t)}>${esc(capitalize(t))}</a>`]));
  // Phones: the types sit under the name instead of in a column of their own.
  const typeTags = new Map(TYPES.map((t) => [t as string, `<i class=t-${t}>${esc(capitalize(t))}</i>`]));
  return rows
    .map((r, j) => {
      const i = offset + j;
      const e = r.entry;
      const pic = e.form ? artUrl(e.art, 96) : boardArtUrl(e.art);
      const sub = `#${String(e.species).padStart(4, "0")}${e.speciesName ? ` · ${esc(e.speciesName)}` : ""}`;
      let extra = "";
      if (size) extra += `<td class=vm>${valueHtml(m.key === "weight" ? "height" : "weight", m.key === "weight" ? e.height : e.weight)}</td>`;
      else if (m.key === "bst") extra += STATS.map((k) => `<td class=vl>${e.stats[k]}</td>`).join("");
      else extra += `<td class=vc>${e.bst}</td>`;
      return (
        `<tr id=${e.key}><td>${r.rank}${r.tied ? "<span class=sr-only> (tied)</span>" : ""}</td>` +
        `<td><a class=n href=/pokemon/${e.slug}><img src="${pic}" alt="${esc(e.name)}" width=40 height=40${i < EAGER_ROWS ? "" : " loading=lazy"}><span><b>${esc(e.name)}</b><small>${sub}</small></span></a><span class=tm>${e.types.map((t) => typeTags.get(t) ?? "").join("")}</span></td>` +
        `<td class=tc><span class=ty>${e.types.map((t) => typeLinks.get(t) ?? "").join("")}</span></td>` +
        `<td class=v>${valueHtml(m.key, r.value)}</td>${extra}<td class=vc>${e.gen}</td></tr>`
      );
    })
    .join("");
}

/** The /rows file: the list's rows after the first FIRST_ROWS, as plain HTML for the table to append. Never a page of its own in search. */
export function restRowsResponse(m: Metric, s: Scope): Response {
  const rows = ranking(m, s);
  return new Response(rowsHtml(m, rows.slice(FIRST_ROWS), FIRST_ROWS), {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}
