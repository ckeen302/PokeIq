import { Fragment, createElement, type ReactNode } from "react";
import type { Locale } from "./config";
import type { Namespace, RichValues, Translator, Tree, Values } from "./catalog";

// i18n/catalog as an English-only build has it (next.config swaps this file in while no other language is live):
// every message is English, compiled to a string or a small function at build time (scripts/i18n/icu-loader.cjs),
// so there is no formatter and no other language's lookup. tests/i18n-foundation.test.ts keeps the exports equal.

export type { Keys, Namespace, RichValues, Translator, Tree, Values } from "./catalog";

export function defineNamespace<T extends Tree>(name: string, en: T): Namespace<T> {
  return { name, en };
}

export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", ja: "ja-JP", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT" };

type Message = string | ((values: Record<string, unknown>) => unknown);

function lookup(tree: Tree, key: string): Message | undefined {
  let node: unknown = tree;
  for (const part of key.split(".")) node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  return typeof node === "string" || typeof node === "function" ? (node as Message) : undefined;
}

export function translator<T extends Tree>(ns: Namespace<T>, _locale?: Locale, _messages?: Tree): Translator<T> {
  const find = (key: string): Message => {
    const m = lookup(ns.en, key);
    if (m === undefined) throw new Error(`Missing message ${ns.name}.${key}`);
    return m;
  };
  const t = ((key: string, values?: Values) => {
    const m = find(key);
    return typeof m === "string" ? m : String(m(values ?? {}));
  }) as unknown as Translator<T>;
  t.rich = (key: string, values: RichValues) => {
    const m = find(key);
    const out = (typeof m === "string" ? m : m(values)) as ReactNode;
    return Array.isArray(out) ? createElement(Fragment, null, ...out) : out;
  };
  t.has = (key: string) => lookup(ns.en, key) !== undefined;
  Object.defineProperty(t, "locale", { value: "en" });
  return t;
}

export function formatNumber(n: number, _locale?: Locale, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString("en-US", opts);
}
