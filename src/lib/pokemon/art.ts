/** Client-safe asset URL helpers for the Pokédex. */

export function artUrl(id: number, size: 96 | 160 | 256 | 400 = 256, shiny = false): string {
  return `/api/art/${id}?s=${size}${shiny ? "&shiny=1" : ""}`;
}

export function animatedSpriteUrl(id: number, shiny = false): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/${shiny ? "shiny/" : ""}${id}.gif`;
}

export function homeRenderUrl(id: number, shiny = false): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${shiny ? "shiny/" : ""}${id}.png`;
}

export function publicCryUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`;
}

export function spriteUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}
