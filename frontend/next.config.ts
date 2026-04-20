import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep proxy responses (SSE) un-buffered for streaming in future phase.
    proxyTimeout: 60_000,
  },
};

export default nextConfig;
