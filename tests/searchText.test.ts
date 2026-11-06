import { describe, expect, it } from 'vitest';
import { matchesSearchText, normalizeSearchText } from '../lib/searchText';

describe('BuildTrack global search text', () => {
  it('finds accented names, regulatory references and plan revisions without accents', () => {
    expect(matchesSearchText(normalizeSearchText('  HELENE CONTROLE  '), 'Visite', 'Hélène Contrôle')).toBe(true);
    expect(matchesSearchText(normalizeSearchText('reglementation temoin'), 'DICT', 'Dossier réglementation témoin')).toBe(true);
    expect(matchesSearchText(normalizeSearchText('r02'), 'Électricité RDC', 'R02')).toBe(true);
  });

  it('ignores missing legacy fields and requires at least two characters', () => {
    expect(matchesSearchText(normalizeSearchText('r'), undefined, null, 'R02')).toBe(false);
    expect(matchesSearchText(normalizeSearchText('etr'), undefined, null, 'Étrier')).toBe(true);
    expect(matchesSearchText(normalizeSearchText('r02'), undefined, null, 'R03')).toBe(false);
  });
});
