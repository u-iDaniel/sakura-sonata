import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // creates a minimal, self-contained production build optimized for containerized deployments under the .next/standalone directory
};

export default nextConfig;
