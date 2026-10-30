import type { NextConfig } from 'next';
import { securityHeaders } from './src/shared/security-headers';

const nextConfig: NextConfig = {
  async headers() {
    // Для всех путей, включая /api, manifest и иконки.
    return [{ source: '/:path*', headers: securityHeaders({ dev: process.env.NODE_ENV !== 'production' }) }];
  },
};

export default nextConfig;
