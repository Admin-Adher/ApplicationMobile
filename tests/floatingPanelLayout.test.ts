import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { computeFloatingPanelLayout } from '../vercel-app/app/web/inventory-workspace/floating-panel';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('floating inventory export panel', () => {
  it('renders outside the clipped stock card with a viewport-bounded scroll area', () => {
    const workspace = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');
    const css = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.module.css');

    expect(workspace).toContain("import { createPortal } from 'react-dom'");
    expect(workspace).toContain('createPortal(');
    expect(workspace).toContain('document.body');
    expect(workspace).toContain('computeFloatingPanelLayout({');
    expect(css).toMatch(/\.exportPanel\s*\{[\s\S]*?position:\s*fixed;/);
    expect(css).toMatch(/\.exportPanel\s*\{[\s\S]*?overflow-y:\s*auto;/);
  });

  it('opens below the trigger when the full panel fits', () => {
    expect(computeFloatingPanelLayout({
      anchor: { top: 80, right: 560, bottom: 124 },
      panelHeight: 420,
      viewportWidth: 580,
      viewportHeight: 596,
    })).toEqual({ top: 132, left: 256, width: 304, maxHeight: 448, placement: 'bottom' });
  });

  it('keeps the panel inside a short viewport and makes its contents scrollable', () => {
    expect(computeFloatingPanelLayout({
      anchor: { top: 80, right: 560, bottom: 124 },
      panelHeight: 420,
      viewportWidth: 580,
      viewportHeight: 400,
    })).toEqual({ top: 132, left: 256, width: 304, maxHeight: 252, placement: 'bottom' });
  });

  it('flips above a trigger near the bottom edge', () => {
    expect(computeFloatingPanelLayout({
      anchor: { top: 500, right: 560, bottom: 544 },
      panelHeight: 420,
      viewportWidth: 580,
      viewportHeight: 596,
    })).toEqual({ top: 72, left: 256, width: 304, maxHeight: 476, placement: 'top' });
  });

  it('respects horizontal viewport margins on a narrow screen', () => {
    expect(computeFloatingPanelLayout({
      anchor: { top: 80, right: 310, bottom: 124 },
      panelHeight: 240,
      viewportWidth: 320,
      viewportHeight: 596,
    })).toMatchObject({ left: 16, width: 288 });
  });
});
