import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // Proxy API calls to avoid CORS issues in production
  async rewrites() {
    const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "http://api:3000";
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
    ];
  },
};

export default config;
