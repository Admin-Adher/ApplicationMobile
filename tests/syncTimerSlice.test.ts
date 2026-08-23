import { describe, expect, it } from 'vitest';
import {
  MAX_REPRESENTABLE_DATE_MS,
  MAX_TIMER_SLICE_MS,
  computeTimerSlice,
  normalizeTimerTarget,
} from '../lib/syncTimerSlice';

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

describe('a long deadline never reaches setTimeout whole', () => {
  it('caps the slice past the safe 32-bit range', () => {
    // 2^31-1 ms ~ 24,8 jours. Au-dela, le comportement depend du runtime :
    // ecretage, debordement, ou declenchement quasi immediat — ce dernier cas
    // rejouerait la file en boucle pendant une limitation serveur longue.
    const slice = computeTimerSlice(NOW + 40 * DAY_MS, NOW);

    expect(slice.sliceMs).toBe(MAX_TIMER_SLICE_MS);
    expect(slice.sliceMs).toBeLessThan(2 ** 31 - 1);
    expect(slice.due).toBe(false);
  });

  it('keeps the real deadline visible, not the end of the slice', () => {
    const target = NOW + 40 * DAY_MS;
    expect(computeTimerSlice(target, NOW).targetIso).toBe(new Date(target).toISOString());
  });

  it('converges: each slice shortens the remaining wait', () => {
    const target = NOW + 5 * DAY_MS;
    let now = NOW;
    let wakeups = 0;

    while (!computeTimerSlice(target, now).due) {
      const { sliceMs } = computeTimerSlice(target, now);
      expect(sliceMs).toBeGreaterThan(0);
      now += sliceMs;
      wakeups += 1;
      expect(wakeups, 'la decoupe doit converger').toBeLessThan(1000);
    }

    expect(now).toBe(target);
    expect(wakeups).toBe(5 * 24);
  });

  it('hands a short delay straight through', () => {
    const slice = computeTimerSlice(NOW + 30_000, NOW);

    expect(slice.sliceMs).toBe(30_000);
    expect(slice.due).toBe(false);
  });

  it('reports a past deadline as due rather than negative', () => {
    const slice = computeTimerSlice(NOW - 60_000, NOW);

    expect(slice.due).toBe(true);
    expect(slice.sliceMs).toBe(0);
  });
});

describe('a deadline coming from outside cannot break the scheduler', () => {
  it('never lets an unrepresentable date throw', () => {
    // `new Date(ms).toISOString()` leve au-dela de 8,64e15 ms. La valeur vient
    // d'un `Retry-After` serveur : elle n'est pas de confiance.
    const slice = computeTimerSlice(MAX_REPRESENTABLE_DATE_MS * 2, NOW);

    expect(() => computeTimerSlice(MAX_REPRESENTABLE_DATE_MS * 2, NOW)).not.toThrow();
    expect(slice.targetIso).toBeNull();
    // Le reveil reste borne : on ne renonce pas a reessayer un jour.
    expect(slice.sliceMs).toBe(MAX_TIMER_SLICE_MS);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['une chaine', 'demain'],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to the default delay on %s', (_label, value) => {
    expect(normalizeTimerTarget(value, NOW, 15_000)).toBe(NOW + 15_000);
  });

  it('clamps an absurd deadline instead of propagating it', () => {
    expect(normalizeTimerTarget(1e300, NOW, 15_000)).toBe(MAX_REPRESENTABLE_DATE_MS);
  });

  it('treats a past deadline as reached, never rewinding the clock', () => {
    expect(normalizeTimerTarget(NOW - DAY_MS, NOW, 15_000)).toBe(NOW);
  });
});
