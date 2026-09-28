import type { NextConfig } from "next";

// Where the NestJS API runs. Read when the app is built:
// local dev → http://localhost:3001, Docker → http://api:3001, production → the hosted API URL.
const apiUrl = process.env.API_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // Build a self-contained server in .next/standalone for the Docker image.
  output: "standalone",

  // The browser only ever calls this app's own /api/... paths.
  // Next.js forwards them to the API, so cookies stay first-party and no CORS setup is needed.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
