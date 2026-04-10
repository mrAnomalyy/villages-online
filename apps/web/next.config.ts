import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  transpilePackages: ["@villages/shared", "@villages/world"]
};

export default nextConfig;
