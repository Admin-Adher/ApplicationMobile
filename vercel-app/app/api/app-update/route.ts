import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GITHUB_RELEASE_API = 'https://api.github.com/repos/Admin-Adher/ApplicationMobile/releases/latest';
const APK_NAME = 'buildtrack-release.apk';

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowedOrigin = !origin
    || origin === 'https://buildtrack-mobile.vercel.app'
    || /^https:\/\/[^/]+\.vercel\.app$/i.test(origin)
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
      ? (origin ?? '*')
      : 'https://buildtrack-mobile.vercel.app';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Vary': 'Origin',
  };
}
function buildNumberFromRelease(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/(?:android[-_\s]*)?build[-_#:\s]*(\d+)/i);
  if (!match) return null;
  const build = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(build) && build > 0 ? build : null;
}

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request);
  try {
    const response = await fetch(GITHUB_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      next: { revalidate: 60 },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: 'release_unavailable' },
        { status: 502, headers: { ...headers, 'Cache-Control': 'no-store' } },
      );
    }

    const release = await response.json();
    const tag = typeof release?.tag_name === 'string' ? release.tag_name : '';
    const name = typeof release?.name === 'string' ? release.name : '';
    const buildNumber = buildNumberFromRelease(tag) ?? buildNumberFromRelease(name);
    const asset = Array.isArray(release?.assets)
      ? release.assets.find((candidate: any) => candidate?.name === APK_NAME)
      : null;
    const downloadUrl = typeof asset?.browser_download_url === 'string'
      ? asset.browser_download_url
      : null;

    if (buildNumber == null || !downloadUrl) {
      return NextResponse.json(
        { error: 'invalid_release' },
        { status: 502, headers: { ...headers, 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json({
      schemaVersion: 1,
      buildNumber,
      version: null,
      tag,
      publishedAt: release?.published_at ?? release?.created_at ?? null,
      downloadUrl,
      apk: {
        name: APK_NAME,
        url: downloadUrl,
        size: typeof asset?.size === 'number' ? asset.size : null,
      },
    }, {
      headers: {
        ...headers,
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'release_unavailable' },
      { status: 502, headers: { ...headers, 'Cache-Control': 'no-store' } },
    );
  }
}
