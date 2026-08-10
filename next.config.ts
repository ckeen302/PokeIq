import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/PokeAPI/sprites/**",
      },
    ],
    // Sprites are immutable per-URL; cache aggressively at the edge.
    minimumCacheTTL: 86400,
  },
};

export default nextConfig;
