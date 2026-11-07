import type { NextConfig } from "next";

/** Security headers on every response (brief §10). The CSP itself is set per request in middleware (nonce). */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "sharp"],
  images: {
    formats: ["image/avif", "image/webp"],
    // Venue photos are served by the app itself from UPLOAD_DIR at /media/... (photo pipeline).
    localPatterns: [{ pathname: "/media/**" }, { pathname: "/brand/**" }],
    deviceSizes: [390, 640, 828, 1080, 1440, 1920],
    minimumCacheTTL: 31536000,
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
