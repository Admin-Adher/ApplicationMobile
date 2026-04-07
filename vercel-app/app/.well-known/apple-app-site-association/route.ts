import { NextResponse } from 'next/server';

const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: `${process.env.IOS_TEAM_ID ?? 'XXXXXXXXXX'}.com.buildtrack.app`,
        paths: ['/invite', '/invite/*', '/register', '/register/*'],
      },
    ],
  },
  webcredentials: {
    apps: [`${process.env.IOS_TEAM_ID ?? 'XXXXXXXXXX'}.com.buildtrack.app`],
  },
};

export async function GET() {
  return NextResponse.json(AASA, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
