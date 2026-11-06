import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @quietpay/node ships TypeScript source (workspace package).
  transpilePackages: ["@quietpay/node", "@quietpay/shared"],
};

export default nextConfig;
