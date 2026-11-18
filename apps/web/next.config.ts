import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    const socketUrl = process.env.SOCKET_PUBLIC_URL ?? '';
    let socketOrigins = '';
    if (socketUrl) {
      try {
        const origin = new URL(socketUrl).origin;
        socketOrigins = ` ${origin} ${origin.replace(/^http/, 'ws')}`;
      } catch {
        socketOrigins = '';
      }
    }
    const scriptSrc =
      process.env.NODE_ENV === 'production'
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      `connect-src 'self'${socketOrigins}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin()(nextConfig);
