/** Public bucket the pre-generated shiny-quiz images live in (scripts/shiny/upload.ts). */
export function shinyImageUrl(name: string): string {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/shiny/${name}.webp`;
}
