import format, { type CompiledMessage, type FormatOptions } from "icu-minify/format";
import { Fragment, createElement, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";

/**
 * Translations: src/messages/<locale>/<namespace>.json, ICU message strings ("{n, plural, one {# win} other {# wins}}").
 * English is the source. Each namespace has one definition (src/messages/<namespace>.ts) that pairs its name with the
 * English file, so a component imports exactly the English text it shows (as it carried it inline before) and the
 * keys it may ask for are typed from that file: a key missing in English fails `tsc`.
 *
 * The JSON is compiled at build time (scripts/i18n/icu-loader.cjs): English messages to small functions (English pages
 * need no formatter), other languages to icu-minify's arrays (read by its ~1 KB formatter). The browser never carries
 * an ICU parser. In an English-only build this module is catalog.english.ts (next.config), with no formatter at all.
 */

/** A namespace's messages as written: nested objects of strings. */
export interface Tree {
  [key: string]: string | Tree;
}

/** Every dotted key of a message tree that leads to a message: "result.win" | "share". */
export type Keys<T> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends Tree ? `${K}.${Keys<T[K]>}` : never;
}[keyof T & string];

export interface Namespace<T extends Tree = Tree> {
  /** The file name under src/messages/<locale>/. */
  readonly name: string;
  /** The English messages (compiled), always bundled with the code that uses them. */
  readonly en: T;
}

export function defineNamespace<T extends Tree>(name: string, en: T): Namespace<T> {
  return { name, en };
}

export type Values = Record<string, string | number | boolean | Date>;
export type RichValues = Record<string, string | number | boolean | Date | ((chunks: ReactNode[]) => ReactNode)>;

export interface Translator<T extends Tree> {
  (key: Keys<T>, values?: Values): string;
  /** A message with <tags>, each rendered by the function of the same name. */
  rich(key: Keys<T>, values: RichValues): ReactNode;
  /** Whether the key exists (in this language or in English). */
  has(key: string): boolean;
  readonly locale: Locale;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();
const memo = <V,>(map: Map<string, V>, make: () => V, ...key: unknown[]): V => {
  const k = JSON.stringify(key);
  let v = map.get(k);
  if (!v) map.set(k, (v = make()));
  return v;
};

const OPTIONS: FormatOptions = {
  formatters: {
    getNumberFormat: (locale, opts) => memo(numberFormats, () => new Intl.NumberFormat(locale, opts), locale, opts),
    getDateTimeFormat: (locale, opts) => memo(dateFormats, () => new Intl.DateTimeFormat(locale, opts), locale, opts),
    getPluralRules: (locale, opts) => memo(pluralRules, () => new Intl.PluralRules(locale, opts), locale, opts),
  },
  // Dates in messages read the same on the server and in the browser (a page's HTML never depends on the server's zone).
  timeZone: "UTC",
};

/** Intl's code for a language: "en-US" for English, as the site always formatted numbers. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", ja: "ja-JP", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT" };

/** A compiled English message (scripts/i18n/icu-loader.cjs): the values in, the text (or its parts with <tags>) out. */
type EnglishMessage = (values: Record<string, unknown>) => unknown;
type Message = CompiledMessage | EnglishMessage;

function lookup(tree: Tree | undefined, key: string): Message | undefined {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  // A compiled message is a string, an array or (English) a function; an object is a group of messages, not one.
  return typeof node === "string" || typeof node === "function" || Array.isArray(node) ? (node as Message) : undefined;
}

/**
 * A translator for one namespace in one language: `messages` is that language's file (undefined for English),
 * and a key it lacks falls back to English (the message parity check keeps that from reaching a live page).
 */
export function translator<T extends Tree>(ns: Namespace<T>, locale: Locale, messages: Tree | undefined): Translator<T> {
  const own = locale === DEFAULT_LOCALE ? undefined : messages;
  const intl = INTL_LOCALE[locale];
  // `english`: the key's English, inlined at the call by the build (scripts/i18n/inline-loader.cjs) so a page needn't
  // carry its whole namespace; the namespace's own English otherwise.
  const find = (key: string, english?: Message): { message: Message; locale: string } => {
    const m = own && lookup(own, key);
    if (m !== undefined) return { message: m, locale: intl };
    const e = english ?? lookup(ns.en, key);
    if (e === undefined) throw new Error(`Missing message ${ns.name}.${key}`);
    return { message: e, locale: INTL_LOCALE.en };
  };
  const t = ((key: string, values?: Values, english?: Message) => {
    const { message, locale: l } = find(key, english);
    if (typeof message === "string") return message;
    return String(typeof message === "function" ? message(values ?? {}) : format(message, l, values, OPTIONS));
  }) as unknown as Translator<T>;
  t.rich = ((key: string, values: RichValues, english?: Message) => {
    const { message, locale: l } = find(key, english);
    if (typeof message === "string") return message;
    const out = (typeof message === "function" ? message(values) : format<ReactNode>(message, l, values, OPTIONS)) as ReactNode;
    // Several parts render as one fragment's children (no keys needed).
    return Array.isArray(out) ? createElement(Fragment, null, ...out) : out;
  }) as Translator<T>["rich"];
  t.has = (key) => (own !== undefined && lookup(own, key) !== undefined) || lookup(ns.en, key) !== undefined;
  Object.defineProperty(t, "locale", { value: locale });
  return t;
}

/** A number as the language writes it ("1,234" / "1.234" / "1 234"). English keeps the site's en-US. */
export function formatNumber(n: number, locale: Locale, opts?: Intl.NumberFormatOptions): string {
  return OPTIONS.formatters.getNumberFormat(INTL_LOCALE[locale], opts).format(n);
}
