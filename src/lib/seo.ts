import type { Metadata } from "next";
import { SITE_NAME } from "./site";

/** What the site is, in one breath: the default description and the home page's. */
export const SITE_TAGLINE = "Pokémon games: PokéGuessr, Pokédle, battles & quizzes";
export const SITE_DESCRIPTION =
  "Free Pokémon games, no sign-up: PokéGuessr (GeoGuessr with real in-game screenshots of every region), a daily Pokédle with live duels, Showdown-accurate battles against the computer or a friend, a Battle Lab that simulates thousands of battles for win odds, and quizzes on all 1,025 Pokémon.";

/**
 * Shared preview cards, for pages without an `opengraph-image` of their own.
 * A page that sets `openGraph` no longer inherits its parent segment's image
 * file, so it names one of these instead.
 */
export const SHARE_IMAGES = {
  site: { url: "/opengraph-image", alt: "PokéIQ: PokéGuessr, Pokédle, Pokémon battles and quizzes" },
  battle: { url: "/battle/opengraph-image", alt: "Pokémon battles on Pokémon Showdown's engine" },
  pokedex: { url: "/pokedex/opengraph-image", alt: "The PokéIQ Pokédex: every Pokémon, Kanto to Paldea" },
};

interface PageMetadata {
  /** The tab title; the layout's template appends " · PokéIQ". */
  title: string;
  description: string;
  /** Canonical path. Leave it out for per-player pages (invites, results). */
  path?: string;
  /** Link-preview title and description, when they should read differently from the tab's. */
  socialTitle?: string;
  socialDescription?: string;
  /**
   * The preview image, for a page whose route segment has no
   * `opengraph-image` of its own (a segment's own image file is picked up
   * automatically and must not be overridden here).
   */
  image?: { url: string; alt: string; width?: number; height?: number };
  /** Keep the page out of search results (it can still be shared). */
  noindex?: boolean;
}

/**
 * A page's title, description, canonical URL and link preview (Open Graph
 * and X card) in one place. A page that sets `openGraph` replaces the
 * layout's whole object, so every field a preview needs is repeated here.
 */
export function pageMetadata({ title, description, path, socialTitle, socialDescription, image, noindex }: PageMetadata): Metadata {
  const shareTitle = socialTitle ?? `${title} · ${SITE_NAME}`;
  const shareDescription = socialDescription ?? description;
  // Site cards are 1200x630 PNGs; an external image (a card scan, a set logo) carries its own size, if known.
  const images = image
    ? [
        image.url.startsWith("/")
          ? { url: image.url, width: 1200, height: 630, alt: image.alt, type: "image/png" }
          : { url: image.url, alt: image.alt, ...(image.width && image.height && { width: image.width, height: image.height }) },
      ]
    : undefined;
  return {
    title,
    description,
    ...(path !== undefined && { alternates: { canonical: path } }),
    openGraph: {
      title: shareTitle,
      description: shareDescription,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      ...(path !== undefined && { url: path }),
      ...(images && { images }),
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: shareDescription,
      ...(images && { images }),
    },
    ...(noindex && { robots: { index: false, follow: true } }),
  };
}

/**
 * An invite link (duel or live battle): kept out of search, with no canonical
 * URL. The title may name the trainers but never the game's contents; the
 * picture is the segment's generic challenge card.
 */
export function inviteMetadata(title: string, description: string): Metadata {
  return pageMetadata({ title, description, socialTitle: title, noindex: true });
}

/** JSON for a `<script type="application/ld+json">`, safe to inline in HTML. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
