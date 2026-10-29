import "server-only";
import blur from "@/data/geo-shot-blur.json";

/**
 * A screenshot's placeholder: an 8-pixel-wide WebP of it (scripts/geo-blur.mjs),
 * shown blurred under a round's picture until the picture has decoded. Only
 * seen when the round wasn't fetched ahead. Undefined for a screenshot added
 * since the script last ran.
 */
const BLUR = blur as Record<string, string>;
export function shotBlur(id: string): string | undefined {
  const b64 = BLUR[id];
  return b64 ? `data:image/webp;base64,${b64}` : undefined;
}
