"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Languages, X } from "lucide-react";
import { DEFAULT_LOCALE, LIVE_LOCALES, LOCALE_NAMES, isLiveLocale, type Locale } from "@/i18n/config";
import { useLocale, usePathname } from "@/i18n/navigation";
import { localizePath } from "@/i18n/paths";
import { isPageLive } from "@/i18n/routes";
import { cn } from "@/lib/utils";
import { Row } from "@/components/settings/SiteSettings";

/** The visitor's own choice of language, kept on this device only (never a cookie: pages never vary by it). */
const CHOICE_KEY = "pokeiq-locale";
const DISMISS_KEY = "pokeiq-locale-suggest";

/** "Language", in each language (the picker's row is labelled in the page's language). */
export const LANGUAGE_LABEL: Record<Locale, string> = {
  en: "Language",
  ja: "言語",
  es: "Idioma",
  fr: "Langue",
  de: "Sprache",
  it: "Lingua",
};

/** The suggestion banner, in the language it suggests. */
const SUGGEST: Record<Locale, { ask: string; yes: string; no: string }> = {
  en: { ask: "View this page in English?", yes: "English", no: "No thanks" },
  ja: { ask: "日本語で表示しますか？", yes: "日本語で見る", no: "閉じる" },
  es: { ask: "¿Ver en español?", yes: "Ver en español", no: "No, gracias" },
  fr: { ask: "Afficher en français ?", yes: "Voir en français", no: "Non merci" },
  de: { ask: "Auf Deutsch ansehen?", yes: "Auf Deutsch", no: "Nein, danke" },
  it: { ask: "Vedere in italiano?", yes: "Vedi in italiano", no: "No, grazie" },
};

/** The same page in another language, or that language's home page when the page isn't translated into it. */
export function pageIn(path: string, locale: Locale): string {
  return localizePath(isPageLive(path, locale) ? path : "/", locale);
}

function remember(locale: Locale) {
  try {
    localStorage.setItem(CHOICE_KEY, locale);
  } catch {
    // Storage blocked: the choice just isn't remembered.
  }
}

/** The Settings block's Language row, under Sound, in the Theme and Sound rows' style. */
export function LanguageRow({ size, testIdPrefix }: { size: "sm" | "md"; testIdPrefix: string }) {
  const locale = useLocale();
  return (
    <Row title={LANGUAGE_LABEL[locale]} size={size}>
      <LanguageSelect size={size} testId={`${testIdPrefix}-language`} />
    </Row>
  );
}

/** The Settings block's Language row control: a compact dropdown of the live languages, each in its own name. */
export function LanguageSelect({ size, testId }: { size: "sm" | "md"; testId: string }) {
  const locale = useLocale();
  const path = usePathname();
  return (
    <label
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border border-foreground/10 bg-foreground/[0.04] p-0.5 text-primary",
        size === "md" && "p-1"
      )}
    >
      <span className="sr-only">{LANGUAGE_LABEL[locale]}</span>
      <Languages className={cn("pointer-events-none absolute", size === "sm" ? "left-3 h-3.5 w-3.5" : "left-4 h-4 w-4")} aria-hidden />
      <select
        value={locale}
        data-testid={testId}
        onChange={(e) => {
          const next = e.target.value;
          if (!isLiveLocale(next) || next === locale) return;
          remember(next);
          window.location.assign(pageIn(path, next));
        }}
        className={cn(
          "appearance-none rounded-full bg-primary/15 font-display font-semibold shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          size === "sm" ? "h-7 pl-8 pr-7 text-[11px]" : "h-9 pl-10 pr-9 text-xs"
        )}
      >
        {LIVE_LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
      <ChevronDown className={cn("pointer-events-none absolute", size === "sm" ? "right-2.5 h-3.5 w-3.5" : "right-3.5 h-4 w-4")} aria-hidden />
    </label>
  );
}

/**
 * The phone's More sheet's language switch: a square like its theme and sound buttons, with the live languages in
 * a native picker over it (the phone's own list, each language in its own name).
 */
export function LanguageSquare({ className }: { className?: string }) {
  const locale = useLocale();
  const path = usePathname();
  return (
    <label className={cn("relative flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-2xl bg-foreground/[0.04] text-foreground transition-colors active:bg-foreground/[0.09]", className)}>
      <Languages className="h-5 w-5" aria-hidden />
      <span className="sr-only">{LANGUAGE_LABEL[locale]}</span>
      <select
        value={locale}
        data-testid="more-language"
        onChange={(e) => {
          const next = e.target.value;
          if (!isLiveLocale(next) || next === locale) return;
          remember(next);
          window.location.assign(pageIn(path, next));
        }}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-2xl opacity-0"
      >
        {LIVE_LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The footer's row of this page in every live language it is served in (real links: crawlers follow them). */
export function LanguageLinks() {
  const locale = useLocale();
  const path = usePathname();
  const locales = LIVE_LOCALES.filter((l) => isPageLive(path, l));
  if (locales.length < 2) return null;
  return (
    <nav aria-label={LANGUAGE_LABEL[locale]} className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px]" data-testid="footer-languages">
      {locales.map((l) => (
        <a
          key={l}
          href={localizePath(path, l)}
          hrefLang={l}
          lang={l}
          aria-current={l === locale ? "true" : undefined}
          onClick={() => remember(l)}
          className={cn("hover:text-foreground", l === locale && "text-foreground")}
        >
          {LOCALE_NAMES[l]}
        </a>
      ))}
    </nav>
  );
}

/**
 * A one-time, dismissible offer of the page in the visitor's browser language, when that language is live and
 * isn't the one shown. Never a redirect, and never shown again once answered (or once a language was chosen).
 */
export function LanguageSuggestion() {
  const locale = useLocale();
  const path = usePathname();
  const [offer, setOffer] = useState<Locale | null>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) || localStorage.getItem(CHOICE_KEY)) return;
    } catch {
      return;
    }
    const wanted = navigator.languages.map((l) => l.toLowerCase().split("-")[0]).find((l) => isLiveLocale(l));
    if (wanted && wanted !== locale && isPageLive(path, wanted as Locale)) setOffer(wanted as Locale);
  }, [locale, path]);
  if (!offer) return null;
  const done = (chosen?: Locale) => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
      if (chosen) localStorage.setItem(CHOICE_KEY, chosen);
    } catch {
      // Storage blocked: it may be offered again on the next page.
    }
    setOffer(null);
  };
  const text = SUGGEST[offer];
  return (
    <div
      lang={offer}
      role="region"
      aria-label={LANGUAGE_LABEL[offer]}
      data-testid="language-suggestion"
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-lg border bg-card/95 px-4 py-3 text-sm shadow-lg backdrop-blur lg:bottom-4"
    >
      <Languages className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">{text.ask}</span>
      <a href={pageIn(path, offer)} onClick={() => done(offer)} className="shrink-0 rounded-full bg-primary/15 px-3 py-1 font-semibold text-primary hover:bg-primary/25">
        {offer === DEFAULT_LOCALE ? LOCALE_NAMES.en : text.yes}
      </a>
      <button type="button" onClick={() => done()} aria-label={text.no} title={text.no} className="shrink-0 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
