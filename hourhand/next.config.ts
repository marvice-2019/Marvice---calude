import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A profile photo (up to 2 MB) goes up through a server action; the default limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
};

export default nextConfig;
