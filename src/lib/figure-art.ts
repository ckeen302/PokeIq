/**
 * The cut-out figures' pictures (the race, The History of the Pokémon World,
 * The Story of Pokémon): static files the CDN serves (public/race/art, made
 * by scripts/figure-art.ts), same-origin as WebGL textures need.
 */
export const figureArtUrl = (id: number, size: 256 | 512) => `/race/art/${size}/${id}.webp`;
