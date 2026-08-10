import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PokéIQ — Pokémon Knowledge Engine",
    short_name: "PokéIQ",
    description:
      "Four live-computed Pokémon quiz modules: recognition, types, moves, stats.",
    start_url: "/",
    display: "standalone",
    background_color: "#06070f",
    theme_color: "#06070f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
