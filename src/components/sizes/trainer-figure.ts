import type { TrainerConfig } from "@/lib/trainer/config";
import type { RefBuilders } from "./scene/figures";

/**
 * The human scale reference on /pokedex/sizes: the player's own 3D trainer
 * when they have one, otherwise the site's starter trainer, standing at the
 * documented adult height. Built only with the scene (the model loads with
 * it), idling in place.
 */
export function trainerFigure(cfg: TrainerConfig | null | undefined): NonNullable<RefBuilders["trainer"]> {
  return async () => {
    const [{ buildTrainer }, { starterTrainer }] = await Promise.all([import("@/components/trainer3d/model"), import("@/lib/trainer/config")]);
    const model = buildTrainer(cfg ?? starterTrainer());
    return { object: model.root, update: (t: number, dt: number) => model.update(t, dt, "idle"), dispose: () => model.dispose() };
  };
}
