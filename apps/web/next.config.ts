import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  /**
   * Server-side proxy: Next.js rewrites /api/* to the backend API.
   * In Docker, API_INTERNAL_URL uses the compose service name (server-to-server).
   * NEXT_PUBLIC_API_URL is only used by browser-side code (WebSocket URL etc).
   */
  async rewrites() {
    const apiUrl =
      process.env["API_INTERNAL_URL"] ??
      process.env["NEXT_PUBLIC_API_URL"] ??
      "http://api:3000";
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
    ];
  },
};

export default config;
