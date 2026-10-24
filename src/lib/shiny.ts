/** Public bucket the pre-generated shiny-quiz images live in (scripts/shiny/upload.ts). */
const SHINY_BASE = "https://vowzddxxxhxcmibhplgl.supabase.co/storage/v1/object/public/shiny";

export function shinyImageUrl(name: string): string {
  return `${SHINY_BASE}/${name}.webp`;
}
