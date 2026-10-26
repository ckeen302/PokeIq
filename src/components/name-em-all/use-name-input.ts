"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closestName, couldGrow, normalizeName, type NeaMatcher } from "@/lib/name-em-all/match";
import type { NeaTarget } from "@/lib/name-em-all/types";

/**
 * The name box. A name counts the moment it's spelled right, no Enter
 * needed, and the box clears for the next one. When a name is the start of
 * another one still open (Mew, Mewtwo), the text stays so the longer name
 * can be finished; typing on past it keeps just the new letters.
 */

export interface NeaFeedback {
  kind: "dup" | "out" | "wrong";
  text: string;
  n: number;
}

interface Options {
  matcher: NeaMatcher;
  targets: readonly NeaTarget[];
  /** Species outside the category: normalized name -> name. */
  outsiders: ReadonlyMap<string, string>;
  label: string;
  isNamed: (slot: number) => boolean;
  /** Chaos and Dex order only accept the slot they ask for. */
  allowed: (slot: number) => boolean;
  spelling: boolean;
  onAccept: (slot: number, viaHelper: boolean) => void;
}

/** What's left of `raw` after its first `n` normalized characters. */
function dropNormalized(raw: string, n: number): string {
  let used = 0;
  for (let i = 0; i < raw.length; i++) {
    if (used >= n) return raw.slice(i).replace(/^\s+/, "");
    used += normalizeName(raw[i]).length;
  }
  return "";
}

export function useNameInput({ matcher, targets, outsiders, label, isNamed, allowed, spelling, onAccept }: Options) {
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<NeaFeedback | null>(null);
  const [suggestion, setSuggestion] = useState<number | null>(null);
  const carry = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const opts = useRef({ isNamed, allowed, onAccept, spelling });
  opts.current = { isNamed, allowed, onAccept, spelling };

  const flash = useCallback((kind: NeaFeedback["kind"], msg: string) => {
    window.clearTimeout(timer.current);
    setFeedback((f) => ({ kind, text: msg, n: (f?.n ?? 0) + 1 }));
    timer.current = window.setTimeout(() => setFeedback(null), 2200);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = useCallback((s: number) => !opts.current.isNamed(s), []);

  const process = useCallback(
    (raw: string): void => {
      const { isNamed: named, allowed: ok, onAccept: accept, spelling: helper } = opts.current;
      const key = normalizeName(raw);
      if (carry.current && !key.startsWith(carry.current)) carry.current = null;
      const slot = key ? matcher.keys.get(key) : undefined;
      if (slot !== undefined && !named(slot)) {
        if (ok(slot)) {
          accept(slot, false);
          const grows = couldGrow(matcher, raw, (s) => s !== slot && !named(s));
          carry.current = grows ? key : null;
          setText(grows ? raw : "");
          setSuggestion(null);
          return;
        }
        setText(raw);
        setSuggestion(null);
        if (!couldGrow(matcher, raw, open)) flash("wrong", `Not this one: that's ${targets[slot].name}.`);
        return;
      }
      // Typed on past a name kept for a longer one that it isn't becoming: keep only the new letters.
      if (carry.current && key.length > carry.current.length && !couldGrow(matcher, raw, open)) {
        const rest = dropNormalized(raw, carry.current.length);
        carry.current = null;
        return process(rest);
      }
      setText(raw);
      const growing = couldGrow(matcher, raw, open);
      if (!growing && slot !== undefined && named(slot) && carry.current !== key) flash("dup", `${targets[slot].name} is already named.`);
      else if (!growing && outsiders.has(key)) flash("out", `${outsiders.get(key)} isn't in ${label}.`);
      const near = helper ? closestName(matcher, raw, (s) => !named(s) && ok(s)) : undefined;
      setSuggestion(near ?? null);
    },
    [matcher, targets, outsiders, label, flash, open]
  );

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => process(e.target.value), [process]);

  const acceptSuggestion = useCallback(() => {
    if (suggestion === null || opts.current.isNamed(suggestion)) return;
    opts.current.onAccept(suggestion, true);
    carry.current = null;
    setText("");
    setSuggestion(null);
  }, [suggestion]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        acceptSuggestion();
      } else if (e.key === "Escape") {
        carry.current = null;
        setText("");
        setSuggestion(null);
      }
    },
    [acceptSuggestion]
  );

  const reset = useCallback(() => {
    carry.current = null;
    setText("");
    setSuggestion(null);
    setFeedback(null);
  }, []);

  return useMemo(() => ({ text, onChange, onKeyDown, feedback, suggestion, acceptSuggestion, reset }), [text, onChange, onKeyDown, feedback, suggestion, acceptSuggestion, reset]);
}

/** Outsider names keyed by their normalized spelling. */
export function outsiderMap(names: readonly string[]): Map<string, string> {
  return new Map(names.map((n) => [normalizeName(n), n]));
}
