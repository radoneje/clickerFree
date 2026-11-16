import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
};

export default createNextIntlPlugin()(nextConfig);
