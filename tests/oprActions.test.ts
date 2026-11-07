import { describe, expect, it } from 'vitest';
import { canEditOpr, normalizeOprItem, oprRemoveSignerFields, oprVerificationFields } from '../vercel-app/app/web/opr-workspace/opr-workspace-model';

const opr = { status: 'draft', items: [{ id: 'lot', status: 'reserve', reserve_id: 'r', note: 'Note', extra: 'kept' }],
  signatories: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', signed: true }] };

describe('OPR field actions', () => {
  it('keeps existing lot fields and displays the verification from either client format', () => {
    const fields = oprVerificationFields(opr, 'lot', [{ id: 'r', status: 'closed' }], '07/11/2026 10:00', 'Camille');
    expect(fields.items[0]).toMatchObject({ note: 'Note', extra: 'kept', verifiedAt: '07/11/2026 10:00', verifiedBy: 'Camille' });
    expect(normalizeOprItem(fields.items[0], 0)).toMatchObject({ verifiedAt: '07/11/2026 10:00', verifiedBy: 'Camille' });
    expect(normalizeOprItem({ verified_at: 'date', verified_by: 'author' }, 0)).toMatchObject({ verifiedAt: 'date', verifiedBy: 'author' });
    expect(opr.items[0]).not.toHaveProperty('verifiedAt');
  });
  it('refuses verification without an accessible closed reserve and refuses to overwrite a verification', () => {
    for (const reserves of [[], [{ id: 'r', status: 'open' }], [{ id: 'r', status: 'closed', deleted_at: 'date' }]]) {
      expect(() => oprVerificationFields(opr, 'lot', reserves, 'date', 'author')).toThrow();
    }
    expect(() => oprVerificationFields({ ...opr, items: [{ ...opr.items[0], verifiedAt: 'old' }] }, 'lot', [{ id: 'r', status: 'closed' }], 'new', 'author')).toThrow();
    expect(() => oprVerificationFields({ ...opr, items: [{ ...opr.items[0], verified_at: 'old' }] }, 'lot', [{ id: 'r', status: 'closed' }], 'new', 'author')).toThrow();
  });
  it('removes only the pending signer while preserving the signed signer', () => {
    expect(oprRemoveSignerFields(opr, 'a')).toEqual({ signatories: [opr.signatories[1]] });
    expect(() => oprRemoveSignerFields(opr, 'b')).toThrow();
    expect(() => oprRemoveSignerFields({ ...opr, signatories: [{ id: 'a', signedAt: 'date' }] }, 'a')).toThrow();
    expect(opr.signatories).toHaveLength(2);
  });
  it('keeps signed and externally signed PVs locked', () => {
    for (const locked of [{ ...opr, status: 'signed' }, { ...opr, signatories: [{ id: 'a', signatureSource: 'web_link', signed: true }] }]) {
      expect(canEditOpr(locked)).toBe(false);
      expect(() => oprRemoveSignerFields(locked, 'a')).toThrow();
      expect(() => oprVerificationFields(locked, 'lot', [{ id: 'r', status: 'closed' }], 'date', 'author')).toThrow();
    }
  });
});
