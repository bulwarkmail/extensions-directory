import type { NextConfig } from "next";

const DOCS_BASE = "https://bulwarkmail.org/docs/extensions";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: import.meta.dirname,
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
        destination: `${DOCS_BASE}/publishing`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
