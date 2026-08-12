import { Bricolage_Grotesque, Manrope } from 'next/font/google';

export const buildTrackBodyFont = Manrope({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-buildtrack-body',
});

export const buildTrackDisplayFont = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-buildtrack-display',
});
