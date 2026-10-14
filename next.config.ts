import type { NextConfig } from "next";

const DOCS_BASE = "https://bulwarkmail.org/docs/extensions";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3", "sharp"],
  turbopack: {
    root: import.meta.dirname,
  },
  // Read at runtime by app/publishing/page.tsx.
  outputFileTracingIncludes: {
    "/publishing": ["./content/**"],
  },
  async rewrites() {
    return [{ source: "/.well-known/bulwark-extension-keys.json", destination: "/api/v2/keys" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/docs",
        destination: `${DOCS_BASE}/introduction`,
        permanent: true,
      },
      {
        source: "/docs/guidelines",
        destination: `${DOCS_BASE}/guidelines`,
        permanent: true,
      },
      {
        source: "/docs/manifest",
        destination: `${DOCS_BASE}/manifest`,
        permanent: true,
      },
      {
        source: "/docs/api",
        destination: `${DOCS_BASE}/api`,
        permanent: true,
      },
      {
        source: "/docs/publishing",
        destination: "/publishing",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
