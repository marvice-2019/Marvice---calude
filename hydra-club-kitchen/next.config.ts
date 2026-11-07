import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "sharp"],
  images: {
    formats: ["image/avif", "image/webp"],
    // Venue photos are served by the app itself from UPLOAD_DIR at /media/... (photo pipeline, stage 5).
    localPatterns: [{ pathname: "/media/**" }, { pathname: "/brand/**" }],
    deviceSizes: [390, 640, 828, 1080, 1440, 1920],
    minimumCacheTTL: 31536000,
  },
};

export default nextConfig;
