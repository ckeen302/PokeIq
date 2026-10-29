"use client";

import type { AvatarUnlocks, PublicAvatar } from "../avatar";
import { parseTrainer, type TrainerConfig } from "./config";

/** Anyone's public trainer, as GET /api/avatar/trainer?name= returns it. */
export interface PublicTrainer {
  username: string;
  /** Their 3D trainer, or null when they haven't made one (show `avatar` instead). */
  trainer: TrainerConfig | null;
  /** Their small avatar (Pokémon, picture or trainer portrait). */
  avatar: PublicAvatar | null;
}

/** The signed-in trainer's own settings, as GET /api/avatar/trainer returns them. */
export interface TrainerSettings {
  /** Trainers can be saved here (false until the migration is applied). */
  available: boolean;
  trainer: TrainerConfig | null;
  unlocks: AvatarUnlocks;
  /** Their current avatar (its Pokémon is the creator's starting partner). */
  avatar: PublicAvatar;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<PublicTrainer | null> }>();

/**
 * Any trainer's public avatar config by name (null: no such account). Cached
 * for a minute per page, and the same request is shared while in flight.
 * For duel screens: `<Avatar3D config={t.trainer} pose="fight" facing="left" />`,
 * or `<Avatar avatar={t.avatar} />` when `trainer` is null.
 */
export function fetchTrainer(name: string): Promise<PublicTrainer | null> {
  const key = name.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = fetch(`/api/avatar/trainer?name=${encodeURIComponent(key)}`)
    .then(async (r) => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`trainer ${r.status}`);
      const body = (await r.json()) as PublicTrainer;
      return { ...body, trainer: parseTrainer(body.trainer) };
    })
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** After saving: the next fetchTrainer(name) asks the server again. */
export function forgetTrainer(name: string) {
  cache.delete(name.trim().toLowerCase());
}
