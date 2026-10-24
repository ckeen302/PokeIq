/** Public bucket the pre-generated shiny-quiz images live in (scripts/shiny/upload.ts). */
export const SHINY_ORIGIN = "https://vowzddxxxhxcmibhplgl.supabase.co";
const SHINY_BASE = `${SHINY_ORIGIN}/storage/v1/object/public/shiny`;

export function shinyImageUrl(name: string): string {
  return `${SHINY_BASE}/${name}.webp`;
}
