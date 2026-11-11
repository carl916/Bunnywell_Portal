import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_PUBLIC_WORKSPACE_FOUNDATION === "1" ? (process.env.WORKSPACE_FOUNDATION_BUILD_CHECK === "1" ? ".next-foundation-check" : ".next-foundation") : ".next",
};

export default nextConfig;
