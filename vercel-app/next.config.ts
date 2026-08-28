import path from 'node:path';
import type { NextConfig } from 'next';

const repositoryRoot = path.join(process.cwd(), '..');

const nextConfig: NextConfig = {
  // The canonical barcode route deliberately reuses the same validated core
  // as Expo. Turbopack otherwise treats vercel-app/ as a hard filesystem
  // boundary and cannot bundle the shared server-only provider modules.
  turbopack: {
    root: repositoryRoot,
  },
  outputFileTracingRoot: repositoryRoot,
  serverExternalPackages: ['@sparticuz/chromium', '@sparticuz/chromium-min', 'puppeteer-core'],
  images: {
    // Private-media URLs are short-lived signed URLs. Keep the allow-list
    // exact, resize them server-side, and do not cache longer than the signing
    // window. This prevents a 1868x4000 original from being downloaded into a
    // 168x128 reserve thumbnail.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '5da3d4bc18c3d1e7b668366b5fb0408b.r2.cloudflarestorage.com',
        pathname: '/buildtrack-files/**',
      },
      {
        protocol: 'https',
        hostname: 'jzeojdpgglbxjdasjgta.supabase.co',
        pathname: '/storage/v1/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    qualities: [70, 82],
    minimumCacheTTL: 60,
    maximumRedirects: 0,
    dangerouslyAllowLocalIP: false,
  },
  outputFileTracingIncludes: {
    '/api/generate-pdf': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/@sparticuz/chromium-min/bin/**/*',
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
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
