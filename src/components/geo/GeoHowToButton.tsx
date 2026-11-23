"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import geoHowto from "@/messages/geo-howto";

/**
 * The light half of PokéGuessr's how-to: the "?" button and the loader that
 * fetches the pop-up (its sheet and live demo, GeoHowTo) only when it's about
 * to open, so the game's first load doesn't carry it.
 */

export const PREFS_KEY = "pokeiq:guessr-prefs:v1";

export function seenDemo(): boolean {
  try {
    return !!(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { seenHowToDemo?: boolean }).seenHowToDemo;
  } catch {
    return false;
  }
}

const GeoHowTo = dynamic(() => import("./GeoHowTo").then((m) => m.GeoHowTo), { ssr: false });

/** The "?" icon button: asks the pop-up (GeoHowTo) to open. */
export function HowToHelpButton({ className }: { className?: string }) {
  const t = useT(geoHowto);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("pokeiq:howto"))}
      aria-label={t("open")}
      title={t("open")}
      data-testid="geo-howto-open"
      className={cn("tap",
        "rounded-md p-2 text-muted-foreground transition-colors hover:bg-screen/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <CircleHelp className="h-5 w-5" />
    </button>
  );
}

/**
 * Mounts the pop-up once it's wanted: on a first visit (until "Don't show
 * again") or on the `pokeiq:howto` event. A first visit's opens once the page
 * has loaded and painted, so the page itself comes first.
 */
export function GeoHowToLoader() {
  const [wanted, setWanted] = useState<"auto" | "asked" | null>(null);
  useEffect(() => {
    let raf = 0;
    let idle = 0;
    const auto = () => {
      raf = requestAnimationFrame(() => {
        const open = () => setWanted((w) => w ?? "auto");
        if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(open, { timeout: 400 });
        else open();
      });
    };
    if (!seenDemo()) {
      if (document.readyState === "complete") auto();
      else window.addEventListener("load", auto, { once: true });
    }
    const ask = () => setWanted((w) => w ?? "asked");
    window.addEventListener("pokeiq:howto", ask);
    return () => {
      window.removeEventListener("load", auto);
      window.removeEventListener("pokeiq:howto", ask);
      cancelAnimationFrame(raf);
      if (idle && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
    };
  }, []);
  return wanted ? <GeoHowTo defaultOpen /> : null;
}
