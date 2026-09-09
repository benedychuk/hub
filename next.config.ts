import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "6mb" } }, // обкладинки воронок як data URL
};

export default nextConfig;
