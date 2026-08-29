import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack visits responsive scroll ownership', () => {
  it('keeps the visits workspace scrollable below the desktop breakpoint', () => {
    const css = read('vercel-app/app/web/web.module.css');

    expect(css).not.toMatch(/\.workspace,\s*\.workspacePlans,\s*\.workspaceReserves,\s*\.workspaceVisites\s*\{[^}]*overflow:\s*visible/);
    expect(css).toMatch(/\.workspaceVisites\s*\{\s*height:\s*100%;\s*min-height:\s*0;\s*max-height:\s*100%;\s*max-width:\s*100%;\s*overflow-x:\s*hidden;\s*overflow-y:\s*auto;/);
    expect(css).toMatch(/\.visitesListPanel,\s*\.visitDetailPanel\s*\{[^}]*overflow:\s*visible;/);
  });
});
