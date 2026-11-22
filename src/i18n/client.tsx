"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { translator, type Namespace, type Translator, type Tree } from "./catalog";
import { useLocale } from "./locale-context";

/**
 * Another language's messages for the client components of a page, by namespace. English pages never render a
 * provider: their components read the English text they import (exactly what they carried inline before).
 */
const MessagesContext = createContext<Record<string, Tree>>({});

export function MessagesProvider({ messages, children }: { messages: Record<string, Tree>; children: ReactNode }) {
  const parent = useContext(MessagesContext);
  const value = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}

/** A namespace's translator in the page's language. */
export function useT<T extends Tree>(ns: Namespace<T>): Translator<T> {
  const locale = useLocale();
  const messages = useContext(MessagesContext)[ns.name];
  return useMemo(() => translator(ns, locale, messages), [ns, locale, messages]);
}
