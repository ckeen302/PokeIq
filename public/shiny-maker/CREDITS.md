# Shiny Pokémon Maker credits

The maker recolours existing sprites; it ships no new artwork of its own beyond the part data derived from them.

- **Pixel style:** Black/White-style 96 px sprites from [PokéAPI's sprite collection](https://github.com/PokeAPI/sprites)
  (`sprites/pokemon/versions/generation-v/black-white`), loaded from GitHub or summarised here as palette slots and
  pixel indices (`px/{id}.json`). Sprites for #650 and later are fan-made in the Black/White style by the
  [Smogon Sprite Project](https://www.smogon.com/forums/forums/smeargles-studio.344/).
- **Animated sprites:** the same collection's animated Black/White sprites, loaded from GitHub when "Animate" is on.
- **HD style:** Pokémon HOME renders from PokéAPI's sprite collection (`sprites/pokemon/other/home`); the part masks
  in `hd/{id}.png` were computed from the normal and shiny renders (scripts/shiny-maker/hd.ts).
- The part data (which shades make up which part) was built by scripts/shiny-maker/build.ts and hand-curated for
  popular species (scripts/shiny-maker/curated.ts).

Pokémon and all related names and images are trademarks of Nintendo, Game Freak, Creatures and The Pokémon Company.
PokéIQ is an unofficial fan project and is not affiliated with or endorsed by them.
