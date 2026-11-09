"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

/**
 * The rest of a long ranking, after the rows in the page's HTML: fetched (as
 * the list's /rows file) when the reader nears the end of those rows, on the
 * button, or at once when the page opens on a row further down (#slug).
 * Crawlers that render the page see the whole list too: their tall viewport
 * reaches the end of the first rows straight away.
 */
export function RankingRest({ src, columns }: { src: string; columns: number }) {
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const busy = useRef(false);
  const foot = useRef<HTMLTableSectionElement>(null);

  const load = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setState("loading");
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => setHtml(text))
      .catch(() => {
        busy.current = false;
        setState("error");
      });
  }, [src]);

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id && !document.getElementById(id)) {
      load();
      return;
    }
    const el = foot.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(), { rootMargin: "1500px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  // A link to a row in the rest: there once it's in.
  useEffect(() => {
    if (html === null) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "center" });
  }, [html]);

  if (html !== null) return <tbody className="divide-y divide-foreground/10 border-t border-foreground/10" dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <tfoot ref={foot}>
      <tr className="border-t border-foreground/10">
        <td colSpan={columns} style={{ textAlign: "center", padding: "12px 8px" }}>
          <button
            type="button"
            onClick={load}
            disabled={state === "loading"}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-foreground/15 bg-shade/30 px-3 font-display text-xs font-semibold uppercase tracking-wider text-foreground hover:border-screen/60 disabled:opacity-60 max-sm:h-11"
            data-testid="ranking-more"
          >
            {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            {state === "error" ? "Couldn't load the rest: try again" : "Show the full list"}
          </button>
        </td>
      </tr>
    </tfoot>
  );
}
