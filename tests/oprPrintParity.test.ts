import { describe, expect, it } from 'vitest';
import { buildWebOprPrint, type OprPrintKind } from '../vercel-app/app/web/opr-workspace/opr-print';
import { summarizeOpr } from '../vercel-app/app/web/opr-workspace/opr-workspace-model';
import { oprPdfCopy } from '../lib/oprPdfCopy';

const png = 'data:image/png;base64,iVBORw0KGgo=';
const opr = summarizeOpr({ id: 'OPR-F', title: 'Recette <OPR>', date: '07/11/2026', status: 'draft',
  items: [{ id: 'lot', lotName: 'Peinture', status: 'reserve', reserveId: 'r' }],
  visit_participants: [{ name: 'Camille', present: false }],
});
const reserve = { id: 'r', title: 'Fissure', status: 'closed', closed_at: '07/11/2026', photos: [
  { kind: 'defect', uri: png, annotations: [{ id: 'a', tool: 'text', x: 10, y: 10, label: 'Zone <A>', text: 'Zone <A>' }] },
  { kind: 'resolution', uri: png },
] };

describe('OPR PDF parity', () => {
  for (const lang of ['fr', 'en', 'es']) {
    it.each(['pv', 'convocation', 'levee'] as OprPrintKind[])('uses shared mobile translations for '+lang+' / %s', kind => {
      const copy = oprPdfCopy(lang);
      const html = buildWebOprPrint(opr, 'Recette', [reserve], kind, [], lang);
      const title = kind === 'pv' ? copy.receptionReport : kind === 'convocation' ? copy.convocationTitle : copy.closureReport;
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html).toContain(`<th>${copy.company}</th>`);
      expect(html).toContain(copy.observations);
      expect(html).not.toContain('Recette <OPR>');
      if (lang !== 'fr') expect(html).not.toContain('Aucun signataire renseigné');
    });
  }
  it('embeds both before and after evidence, captions and escaped annotations for a closed reserve', () => {
    const html = buildWebOprPrint(opr, 'Recette', [reserve], 'levee', [], 'en');
    expect(html.match(/<figure /g)).toHaveLength(2);
    expect(html.match(/src="data:image\/png/g)).toHaveLength(2);
    expect(html).toContain('Initial finding');
    expect(html).toContain('Closure confirmed');
    expect(html).toContain('Zone &lt;A&gt;');
    expect(html).not.toContain('Zone <A>');
    expect(buildWebOprPrint(opr, 'Recette', [{ ...reserve, status: 'open' }], 'levee')).not.toContain('<figure');
  });
  it('does not turn an internal or unsafe media reference into a broken image URL', () => {
    for (const uri of ['media://private-id', 'javascript:alert(1)']) {
      const html = buildWebOprPrint(opr, 'Recette', [{ ...reserve, photos: [{ kind: 'defect', uri }] }], 'levee');
      expect(html).toContain('Photographie indisponible');
      expect(html).not.toContain(`src="${uri}`);
    }
  });
});
