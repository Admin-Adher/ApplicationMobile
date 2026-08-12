import type { Metadata } from 'next';
import LandingPage from './LandingPage';
import { detectRequestLanguage } from '@/lib/landing-request-language';
import { LANDING_COPY } from './landing-copy';

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
  return <LandingPage initialLanguage={initialLanguage} />;
}
