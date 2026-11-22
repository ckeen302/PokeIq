"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CaseSource, Verdict } from "@/lib/theories/types";
import { VERDICTS, filterCases, filterQuery, parseFilter, type CaseFilter } from "@/lib/theories/logic";
import { CaseFolder, type FolderCase } from "./CaseFolder";
import { useT } from "@/i18n/client";
import dexTheoriesList from "@/messages/dex-theories-list";

/**
 * The verdict filter, source chips and search over the case folders. The
 * filter lives in the URL (?v=fan&src=games&q=gengar), so a filtered view can
 * be shared; the page is static, so it's read once the page is in the browser.
 */

const DOT: Record<Verdict, string> = { confirmed: "bg-success", fan: "bg-screen", debunked: "bg-primary" };
const NONE: CaseFilter = { verdict: null, sources: [], q: "" };

export function CaseExplorer({ cases, sources }: { cases: FolderCase[]; sources: CaseSource[] }) {
  const t = useT(dexTheoriesList);
  const [f, setF] = useState<CaseFilter>(NONE);

  useEffect(() => {
    const read = () => setF(parseFilter(new URLSearchParams(window.location.search)));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const update = (next: CaseFilter) => {
    setF(next);
    try {
      history.replaceState(history.state, "", `${window.location.pathname}${filterQuery(next)}`);
    } catch {
      /* ignore */
    }
  };

  const shown = useMemo(() => filterCases(cases, f), [cases, f]);
  const toggleSource = (x: CaseSource) => update({ ...f, sources: f.sources.includes(x) ? f.sources.filter((y) => y !== x) : [...f.sources, x] });

  return (
    <section aria-label={t("label")} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t("verdictGroup")} className="flex flex-wrap gap-0.5 rounded-[10px] border bg-card p-1 max-sm:grid max-sm:w-full max-sm:grid-cols-2" data-testid="case-verdicts">
          {[null, ...VERDICTS].map((v) => (
            <button
              key={v ?? "all"}
              type="button"
              aria-pressed={f.verdict === v}
              onClick={() => update({ ...f, verdict: v })}
              data-testid={`case-verdict-${v ?? "all"}`}
              className={cn(
                "flex items-center gap-[7px] rounded-[7px] px-3.5 py-2 text-[13px] font-semibold transition-colors max-md:min-h-10 max-sm:flex-1 max-sm:justify-center max-sm:px-2",
                f.verdict === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v && <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[v])} />}
              {v ? t(`verdict.${v}`) : t("allCases")}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5 max-sm:w-full">
          <div role="group" aria-label={t("sourceGroup")} className="flex flex-wrap gap-[7px]">
            {sources.map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={f.sources.includes(x)}
                onClick={() => toggleSource(x)}
                data-testid={`case-source-${x}`}
                className={cn(
                  "rounded-full border px-[13px] py-[7px] text-[13px] transition-colors max-md:min-h-10",
                  f.sources.includes(x) ? "border-screen/70 bg-screen/15 text-foreground" : "text-muted-foreground hover:border-screen/50 hover:text-foreground"
                )}
              >
                {t(`source.${x}`)}
              </button>
            ))}
          </div>
          <label className="flex w-[220px] items-center gap-2 rounded-[10px] border bg-card px-3 py-[9px] text-muted-foreground focus-within:border-screen/60 max-sm:w-full">
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <input
              type="search"
              value={f.q}
              onChange={(e) => update({ ...f, q: e.target.value })}
              placeholder={t("search")}
              aria-label={t("search")}
              data-testid="case-search"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground max-md:text-base"
            />
          </label>
        </div>
      </div>
      {shown.length ? (
        <ul className="grid grid-cols-1 gap-x-[18px] gap-y-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="case-grid">
          {shown.map((c) => (
            <li key={c.slug}>
              <CaseFolder c={c} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-12 text-center text-muted-foreground" data-testid="case-none">
          {t("none")}
        </p>
      )}
    </section>
  );
}
