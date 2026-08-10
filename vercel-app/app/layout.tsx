import type { Metadata, Viewport } from 'next';
import Script from 'next/script';

export const metadata: Metadata = {
  title: { default: 'BuildTrack', template: '%s | BuildTrack' },
  description: 'Construction management on mobile and web.',
  applicationName: 'BuildTrack',
  keywords: [
    'construction management',
    'gestion de chantier',
    'gestión de obra',
    'construction app',
    'suivi de réserves',
    'site inventory',
  ],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F7F9FC',
};

const languageBootstrap = `(() => {
  try {
    const match = document.cookie.match(/(?:^|; )buildtrack_landing_language=(en|fr|es)(?:;|$)/);
    const requested = match ? match[1] : (navigator.language || 'en').split('-')[0].toLowerCase();
    document.documentElement.lang = ['en', 'fr', 'es'].includes(requested) ? requested : 'en';
  } catch (_) {
    document.documentElement.lang = 'en';
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><Script id="buildtrack-language" strategy="beforeInteractive">{languageBootstrap}</Script></head>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
