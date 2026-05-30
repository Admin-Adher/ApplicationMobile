import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['@sparticuz/chromium', '@sparticuz/chromium-min', 'puppeteer-core'],
  outputFileTracingIncludes: {
    '/api/generate-pdf': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/@sparticuz/chromium-min/bin/**/*',
    ],
  },
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ];
  },
};

export default nextConfig;
