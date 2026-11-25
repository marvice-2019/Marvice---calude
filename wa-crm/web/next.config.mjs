/** @type {import('next').NextConfig} */
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
export default {
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // The session token lives in the browser, so scripts are locked to this origin.
        { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ${api} ${api.replace(/^http/, 'ws')}; frame-ancestors 'none'` },
      ],
    }];
  },
};
