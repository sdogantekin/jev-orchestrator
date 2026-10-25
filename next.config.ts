import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Playground's custom mode reads stream and currency config from disk at request time
  // (lib/playground/customDecision.ts). File tracing can't see those reads, so without this the
  // deployed /api/decision function fails with ENOENT.
  outputFileTracingIncludes: {
    "/api/decision": ["./experiments/config/**/*.json"],
  },
  // lib/ and experiments/ use explicit ".js" extensions on relative imports (required for
  // plain Node ESM when run via tsx/vitest outside Next). Turbopack can't resolve those to
  // .ts files (no `resolve.extensionAlias` support yet), so this app runs on webpack
  // (`next dev --webpack` / `next build --webpack`), where this option does the mapping.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
