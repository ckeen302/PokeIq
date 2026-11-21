"use client";

import dynamic from "next/dynamic";

/**
 * The language controls, only in builds with a language besides English live. `process.env.LIVE_LOCALES` is inlined
 * at build time (next.config `env`), so in an English-only build each of these is a component that renders nothing
 * and the controls' code is never bundled (a dead import() is dropped when the build reads this file).
 */
const Nothing = () => null;

export const LanguageLinks = process.env.LIVE_LOCALES ? dynamic(() => import("./LanguageControls").then((m) => m.LanguageLinks)) : Nothing;
export const LanguageSuggestion = process.env.LIVE_LOCALES ? dynamic(() => import("./LanguageControls").then((m) => m.LanguageSuggestion)) : Nothing;
export const LanguageSelect = process.env.LIVE_LOCALES ? dynamic(() => import("./LanguageControls").then((m) => m.LanguageSelect)) : Nothing;
export const LanguageSquare = process.env.LIVE_LOCALES ? dynamic(() => import("./LanguageControls").then((m) => m.LanguageSquare)) : Nothing;
export const LanguageRow = process.env.LIVE_LOCALES ? dynamic(() => import("./LanguageControls").then((m) => m.LanguageRow)) : Nothing;
