"use client";

import { useEffect } from "react";
import { useLocale } from "@/i18n/locale-context";
import { translator, type Tree } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";
import PATTERNS from "@/i18n/api-error-patterns.json";

/**
 * A page in another language: the error messages the API sends (`{ error: "…" }` from /api/…, written in English on the
 * server) are shown in the page's language. One wrapper around fetch, installed by the language layout only (English
 * pages never have it), translates a JSON response's `error` on the way in, from the "api-errors" namespace
 * (scripts/i18n/api-errors.mjs collects the messages). A message with no translation stays as the server wrote it.
 */
export function ApiErrors() {
  const locale = useLocale();
  useEffect(() => install(locale), [locale]);
  return null;
}

/** The slug a message is keyed by (as scripts/i18n/api-errors.mjs makes it). */
export const errorSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);

let installed: Locale | null = null;
let table: Promise<Tree> | null = null;

/** The language's translations, fetched the first time an error comes in. */
const load = (locale: Locale): Promise<Tree> =>
  (table ??= import(`@/messages/${locale}/api-errors.json`).then((m) => m.default as Tree).catch(() => ({})));

export async function translateApiError(message: string, locale: Locale): Promise<string> {
  const own = await load(locale);
  const t = translator({ name: "api-errors", en: {} }, locale, own);
  const key = errorSlug(message);
  if (key in own) return t(key as never);
  for (const [k, source] of PATTERNS as [string, string][]) {
    const m = new RegExp(source).exec(message);
    if (m && k in own) return t(k as never, Object.fromEntries(m.slice(1).map((v, i) => [`a${i + 1}`, v])));
  }
  return message;
}

/** Small JSON bodies only: an error is a short object, and a big success response is never read twice. */
const MAX = 4096;

function install(locale: Locale) {
  if (locale === "en" || installed) return;
  installed = locale;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    try {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return res;
      if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;
      const length = Number(res.headers.get("content-length") ?? NaN);
      if (!(length <= MAX)) return res;
      const text = await res.clone().text();
      if (!text.includes('"error"')) return res;
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body?.error !== "string") return res;
      const error = await translateApiError(body.error, locale);
      if (error === body.error) return res;
      return new Response(JSON.stringify({ ...body, error }), { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch {
      return res;
    }
  };
}
