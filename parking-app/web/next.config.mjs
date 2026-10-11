/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(self), payment=(self "https://checkout.razorpay.com")' }
];

const nextConfig = {
  output: "standalone", // small Docker image for Coolify (stage 8)
  poweredByHeader: false,
  reactStrictMode: true,
  // Put <title>/<meta> in <head> for every client, not only known bots (Next 15 streams it otherwise).
  htmlLimitedBots: /.*/,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;
