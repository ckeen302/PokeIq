import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { checkAbout, checkCard, readAbout } from "@/lib/about-validate";
import { getCard } from "@/lib/tcg/api";
import { CARD_SLOTS, type AboutData } from "@/lib/about-data";

/**
 * Trainers' "About me" (migration 0036: profile_about). Everyone can read
 * it; only the owner writes, through the server (the account system is the
 * site's own, so writes use the service key after checking the session).
 * With POKEIQ_LOCAL_ACCOUNTS=1 (tests, local E2E) and in development without
 * Supabase it lives in memory.
 */

export class AboutUnavailable extends Error {}

export interface AboutStore {
  load(userId: string): Promise<unknown>;
  save(userId: string, data: AboutData): Promise<void>;
}

const g = globalThis as unknown as { __pokeiqAbout?: Map<string, AboutData> };
const mem = () => (g.__pokeiqAbout ??= new Map());

export function clearMemoryAbout() {
  g.__pokeiqAbout = new Map();
}

export const memoryAboutStore = (): AboutStore => ({
  async load(userId) {
    return mem().get(userId) ?? null;
  },
  async save(userId, data) {
    mem().set(userId, data);
  },
});

const MISSING = new Set(["42P01", "PGRST205", "PGRST204"]);

export function supabaseAboutStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): AboutStore {
  return {
    async load(userId) {
      const { data, error } = await sb.from("profile_about").select("data").eq("user_id", userId).maybeSingle();
      if (error) {
        if (MISSING.has(error.code ?? "")) return null;
        throw new Error(error.message);
      }
      return data?.data ?? null;
    },
    async save(userId, data) {
      const { error } = await sb.from("profile_about").upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
      if (error && MISSING.has(error.code ?? "")) throw new AboutUnavailable(error.message);
      if (error) throw new Error(error.message);
    },
  };
}

export function aboutStore(): AboutStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryAboutStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseAboutStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryAboutStore() : null;
}

/** A trainer's about-me; empty when unset or the store is unavailable. Never throws. */
export async function aboutFor(userId: string, store = aboutStore()): Promise<AboutData> {
  try {
    return readAbout(store ? await store.load(userId) : null);
  } catch (err) {
    console.error("[about] load failed:", err);
    return { pokemon: {}, games: {} };
  }
}

export type SaveAbout = { ok: true; about: AboutData } | { ok: false; status: number; error: string };

/** Validates and replaces the owner's whole about-me. */
export async function saveAbout(userId: string, raw: unknown, store = aboutStore()): Promise<SaveAbout> {
  if (!store) return { ok: false, status: 503, error: "About me opens soon." };
  const checked = checkAbout(raw);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const cards = checked.about.cards;
  if (cards) {
    // Only the TCG API's own record is stored: name, image and set never come from the browser.
    const prior = (await aboutFor(userId, store)).cards ?? {};
    for (const [slotId, pick] of Object.entries(cards)) {
      // An unchanged pick keeps what's stored, so the API being down never blocks saving the rest.
      if (prior[slotId]?.id === pick.id) {
        cards[slotId] = prior[slotId];
        continue;
      }
      const found = await getCard(pick.id);
      const card = found && checkCard({ id: found.id, name: found.name, image: found.images?.small ?? null, set: found.set?.name ?? null });
      const label = CARD_SLOTS.find((s) => s.id === slotId)?.label ?? "Card";
      if (!card) return { ok: false, status: 400, error: `${label}: couldn't find that card. Try again in a moment.` };
      cards[slotId] = card;
    }
  }
  try {
    await store.save(userId, checked.about);
  } catch (err) {
    if (err instanceof AboutUnavailable) return { ok: false, status: 503, error: "About me opens soon." };
    throw err;
  }
  return { ok: true, about: checked.about };
}
