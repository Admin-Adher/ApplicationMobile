import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dirname, '../app/settings.tsx'), 'utf8');

function styleBlock(name: string): string {
  return source.match(new RegExp(`${name}:\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('settings sync actions layout', () => {
  it('gives the long diagnostic export label its own full-width row', () => {
    const block = styleBlock('queueExportBtn');
    expect(block).toContain("width: '100%'");
    expect(block).toContain('minHeight: 48');
    expect(block).toContain("justifyContent: 'center'");
  });

  it.each(['queueExportTxt', 'queueRetryTxt', 'queueReviewTxt', 'queueClearTxt'])(
    'lets translated text shrink inside %s instead of crushing sibling actions',
    styleName => {
      expect(styleBlock(styleName)).toContain('flexShrink: 1');
    },
  );
});
