/** Tiny className combiner (clsx-style, no dependency). */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

/** "mr-mime" → "Mr Mime", "special-attack" → "Special Attack". */
export function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
