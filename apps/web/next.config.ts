import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @quietpay/shared ships TypeScript source (temporary link: package until A2, then a workspace package).
  transpilePackages: ["@quietpay/shared"],
};

export default nextConfig;
