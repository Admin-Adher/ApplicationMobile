import { describe, expect, it } from 'vitest';
import {
  createWebPdfBatchPayloads,
  partitionReserveReportItems,
  pdfApiErrorMessage,
} from '../vercel-app/lib/pdf-report-batching';

describe('large web PDF report batching', () => {
  it('keeps reserve order while bounding both rows and photos', () => {
    const reserves = Array.from({ length: 320 }, (_, index) => ({
      id: `r${index}`,
      photos: index < 50 ? [{}, {}, {}] : [],
    }));
    const batches = partitionReserveReportItems(reserves);

    expect(batches.length).toBeGreaterThan(3);
    expect(batches.flat().map(item => item.id)).toEqual(reserves.map(item => item.id));
    batches.forEach(batch => {
      expect(batch.length).toBeLessThanOrEqual(150);
      expect(batch.reduce((sum, reserve) => sum + reserve.photos.length, 0)).toBeLessThanOrEqual(60);
    });
  });

  it('turns the current 809-reserve maximum into eight bounded requests', () => {
    const reserves = Array.from({ length: 809 }, (_, index) => ({
      id: `r${index}`,
      photos: index < 50 ? [{}, {}, {}] : [],
    }));
    const batches = createWebPdfBatchPayloads('global_reserves', { reserves, companyFilter: null }, 'fr');

    expect(batches).toHaveLength(8);
    expect(batches.flatMap(batch => batch.reserves).map((reserve: any) => reserve.id))
      .toEqual(reserves.map(reserve => reserve.id));
  });

  it('splits plan reports and keeps every associated or unassigned reserve exactly once', () => {
    const plans = Array.from({ length: 18 }, (_, index) => ({ id: `p${index}` }));
    const reserves = [
      ...plans.map((plan, index) => ({ id: `r${index}`, planId: plan.id })),
      { id: 'unassigned', planId: '' },
    ];
    const batches = createWebPdfBatchPayloads('plans', { plans, reserves, companyFilter: null }, 'fr');

    expect(batches).toHaveLength(3);
    expect(batches.map(batch => batch.plans.length)).toEqual([8, 8, 2]);
    expect(batches.flatMap(batch => batch.reserves).map((reserve: any) => reserve.id).sort())
      .toEqual(reserves.map(reserve => reserve.id).sort());
    expect(batches[0].companyFilter).toContain('Partie 1/3');
  });

  it('turns structured Vercel timeout errors into a readable message', () => {
    expect(pdfApiErrorMessage(504, '{"error":{"code":"FUNCTION_INVOCATION_TIMEOUT"}}', { error: { code: 'FUNCTION_INVOCATION_TIMEOUT' } }))
      .toBe('Le rapport a dépassé le délai de génération. Réessayez dans quelques instants.');
    expect(pdfApiErrorMessage(500, '{"error":{"message":"Panne PDF"}}', { error: { message: 'Panne PDF' } }))
      .toBe('Panne PDF');
  });
});
