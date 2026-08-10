import { Bricolage_Grotesque, Manrope } from 'next/font/google';
import type { Metadata } from 'next';
import LandingPage from './LandingPage';
import { detectRequestLanguage } from '@/lib/landing-request-language';
import { LANDING_COPY } from './landing-copy';

const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-buildtrack-body',
});

const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-buildtrack-display',
});

export async function generateMetadata(): Promise<Metadata> {
  const language = await detectRequestLanguage();
  const copy = LANDING_COPY[language].meta;
  return {
    title: copy.title,
    description: copy.description,
  };
}

export default async function HomePage() {
  const initialLanguage = await detectRequestLanguage();
  return (
    <div className={`${manrope.variable} ${bricolageGrotesque.variable}`}>
      <LandingPage initialLanguage={initialLanguage} />
    </div>
  );
}
