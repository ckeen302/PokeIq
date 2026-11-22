/**
 * Hand-curated parts for the most popular species, from a review of the contact sheets
 * (scripts/shiny-maker/sheet.ts): each part is [name, its shades as normal-sprite colours]. A shade left out joins
 * the part it touches most. Species not listed get the automatic parts (build.ts).
 */
export const CURATED: Record<number, [string, string][]> = {
  6: [["Body", "ee8329 cd5241 833118"], ["Belly", "eeb45a eede7b"], ["Wings", "207394 084152"], ["Flame", "f6a410 ffd510 e64110"], ["Claws", "ffffff cdcdcd 626262"], ["Outline", "000000"]],
};
