import type { ReactNode } from "react";
import { RouteSlot } from "./RouteSlot";

/**
 * RootChrome as an English-only build has it (next.config swaps this file in while no other language is live):
 * the <html> and <main> the root layout always rendered, from the server, with no code in the browser.
 */
export function HtmlRoot({ className, children }: { className: string; children: ReactNode }) {
  return (
    <html lang="en" className={className} suppressHydrationWarning>
      {children}
    </html>
  );
}

export function ChromeGate({ before, after, children }: { before: ReactNode; after: ReactNode; children: ReactNode }) {
  return (
    <>
      {before}
      <main className={MAIN_CLASS}>
        <RouteSlot>{children}</RouteSlot>
      </main>
      {after}
    </>
  );
}

export const MAIN_CLASS = "container flex-1 pb-28 pt-8 max-md:pb-12 max-md:pt-6 lg:pb-12";
