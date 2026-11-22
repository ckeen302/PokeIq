import type { ReactNode } from "react";
import { translator, type Namespace, type Translator, type Tree } from "./catalog";

// i18n/client as an English-only build has it (next.config swaps this file in while no other language is live):
// every page is English, so a namespace's translator is made once and there is no messages context.

const made = new WeakMap<Namespace, Translator<Tree>>();

export function MessagesProvider({ children }: { messages: Record<string, Tree>; children: ReactNode }) {
  return children;
}

export function useT<T extends Tree>(ns: Namespace<T>): Translator<T> {
  let t = made.get(ns as Namespace);
  if (!t) made.set(ns as Namespace, (t = translator(ns as Namespace, "en", undefined)));
  return t as unknown as Translator<T>;
}
