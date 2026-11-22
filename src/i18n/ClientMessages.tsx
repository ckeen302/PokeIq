import type { ReactNode } from "react";
import { DEFAULT_LOCALE } from "./config";
import type { Namespace, Tree } from "./catalog";
import { MessagesProvider } from "./client";
import { getLocale, loadMessages } from "./server";

/**
 * Hands the client components below the messages of the namespaces they use, in the render's language: only those
 * namespaces travel with the page. On an English page it renders its children alone (nothing is added).
 */
export async function ClientMessages({ namespaces, children }: { namespaces: Namespace[]; children: ReactNode }) {
  const locale = getLocale();
  if (locale === DEFAULT_LOCALE) return children;
  const entries = await Promise.all(namespaces.map(async (ns) => [ns.name, await loadMessages(locale, ns.name)] as const));
  const messages: Record<string, Tree> = {};
  for (const [name, tree] of entries) if (tree) messages[name] = tree;
  return <MessagesProvider messages={messages}>{children}</MessagesProvider>;
}
