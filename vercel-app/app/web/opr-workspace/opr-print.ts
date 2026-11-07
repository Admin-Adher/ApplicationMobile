import { getPdfCompanyPalette, renderPdfCompanyLabel, type PdfCompany } from '../../../../lib/pdfCompanyColors';
import { oprPdfCopy } from '../../../../lib/oprPdfCopy';
import { buildPhotoAnnotationsOverlayHtml } from '../../../../lib/pdfReserveHelpers';
import type { OprSummary, ReserveSource } from './opr-workspace-model';

export type OprPrintKind = 'pv' | 'convocation' | 'levee';
const extraCopy = {
  fr: { signers: 'Signataires', participant: 'Participant', noSigner: 'Aucun signataire renseigné.', noLot: 'Aucun lot concerné.', reference: 'Réf.', missingPhoto: 'Photographie indisponible' },
  en: { signers: 'Signatories', participant: 'Participant', noSigner: 'No signatory provided.', noLot: 'No applicable trade.', reference: 'Ref.', missingPhoto: 'Photograph unavailable' },
  es: { signers: 'Firmantes', participant: 'Participante', noSigner: 'Ningún firmante indicado.', noLot: 'Ningún lote afectado.', reference: 'Ref.', missingPhoto: 'Fotografía no disponible' },
};
function escape(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function signatureImage(value: unknown) {
  if (typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)) return '<img alt="" src="' + value + '"/>';
  return typeof value === 'string' && /^\s*<svg\b/i.test(value)
    ? '<img alt="" src="data:image/svg+xml,' + escape(encodeURIComponent(value.trim())) + '"/>' : '';
}

// Photos passed by the caller have already been resolved through the private
// media registry and embedded. Never print internal media identifiers as URLs.
export function buildWebOprPrint(opr: OprSummary, projectName: string, reserves: ReserveSource[], kind: OprPrintKind, companies?: PdfCompany[], language?: string | null) {
  const lang = language?.startsWith('en') ? 'en' : language?.startsWith('es') ? 'es' : 'fr';
  const copy = oprPdfCopy(language);
  const extra = extraCopy[lang];
  const palette = getPdfCompanyPalette(companies);
  const title = kind === 'pv' ? copy.receptionReport : kind === 'convocation' ? copy.convocationTitle : copy.closureReport;
  const source = opr.source;
  const reserveById = new Map(reserves.map(reserve => [reserve.id, reserve]));
  const items = kind === 'pv' ? opr.items : opr.items.filter(item => item.status === 'reserve');
  const labels: Record<string, string> = { ok: copy.compliant, reserve: copy.reserve, non_applicable: copy.nonApplicable };
  const signers = Array.isArray(source.signatories) ? source.signatories : [];
  const participants = (Array.isArray(source.visit_participants) ? source.visit_participants : []).map(person =>
    '<li>' + escape([person.name, person.company, person.present ? copy.present : copy.absent].filter(Boolean).join(' · ')) + '</li>'
  ).join('');
  const visit = typeof source.visit_contradictoire === 'string' && !/^(true|false)$/i.test(source.visit_contradictoire) ? source.visit_contradictoire : '';
  const rows = items.map(item => {
    const reserve = reserveById.get(item.reserveId);
    const label = kind === 'levee' ? (reserve?.status === 'closed' ? copy.closed : copy.waiting) : labels[item.status];
    return '<tr><td>' + escape(item.lotName) + '</td><td>' + renderPdfCompanyLabel(item.entreprise || '—', palette) + '</td><td>'
      + escape(label) + '</td><td>' + escape(item.reserveId || '—') + '</td><td>'
      + escape(kind === 'levee' ? reserve?.closed_at || reserve?.closedAt || '—' : item.deadline || '—')
      + '</td><td>' + escape(item.note || item.description || '—') + '</td></tr>';
  }).join('');
  const photoSections = kind !== 'levee' ? '' : items.map(item => {
    const reserve = reserveById.get(item.reserveId);
    if (reserve?.status !== 'closed') return '';
    const photos = Array.isArray(reserve.photos) ? reserve.photos : [];
    const figures = ['defect', 'resolution'].map(photoKind => {
      const photo = photos.find(photo => (photo.kind || 'defect') === photoKind);
      if (!photo) return '';
      const src = String(photo.uri ?? '');
      const valid = /^(https?:\/\/|data:image\/(?:png|jpe?g|webp);base64,)/i.test(src);
      const caption = photoKind === 'resolution' ? copy.closedFinding : copy.initialFinding;
      return '<figure class="photo-item"><div class="photo-image">' + (valid
        ? '<img alt="' + escape(caption) + '" src="' + escape(src) + '"/>' + buildPhotoAnnotationsOverlayHtml(photo.annotations)
        : '<p>' + escape(extra.missingPhoto) + '</p>') + '</div><figcaption>' + escape(caption) + '</figcaption></figure>';
    }).join('');
    return figures ? '<section class="photo-pair"><h3>' + escape(item.lotName + ' — ' + (reserve.title || item.reserveId)) + '</h3><div class="photos">' + figures + '</div></section>' : '';
  }).join('');
  const signatures = signers.map(signer => {
    const signature = signatureImage(signer?.signature);
    return '<li class="sig-block"><strong>' + escape(signer?.name) + '</strong> · ' + escape(signer?.role || extra.participant)
      + (signer?.signed || signer?.signedAt ? ' · ' + escape(copy.signedOn) + ' ' + escape(signer.signedAt) : ' · ' + escape(copy.waiting))
      + (kind !== 'convocation' ? signature : '') + '</li>';
  });
  if (kind !== 'convocation') {
    const manager = signatureImage(source.conducteur_signature);
    const owner = signatureImage(source.mo_signature);
    if (manager) signatures.push('<li class="sig-block"><strong>' + escape(copy.manager) + '</strong> · ' + escape(opr.conducteur) + manager + '</li>');
    if (owner) signatures.push('<li class="sig-block"><strong>' + escape(copy.owner) + '</strong> · ' + escape(source.maire_ouvrage) + owner + '</li>');
  }
  return '<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8"><title>' + escape(title)
    + '</title><style>@page{size:A4;margin:15mm}body{font:12px system-ui,Arial;color:#172b45;print-color-adjust:exact}h1{color:#003082;margin:.5em 0}h2{font-size:15px;margin:1.4em 0 .4em}header{border-bottom:3px solid #003082;padding-bottom:.6em}table{border-collapse:collapse;width:100%}th,td{text-align:left;border:1px solid #dce4ef;padding:.5em;vertical-align:top}th{color:white;background:#003082}tr,li{break-inside:avoid}li{margin:.5em 0}img{display:block;max-width:170px;max-height:70px}.photos{display:flex;gap:16px;flex-wrap:wrap}.photo-pair{break-inside:avoid}.photo-item{margin:0 0 16px;max-width:240px}.photo-image{position:relative;display:inline-block;max-width:100%}.photo-image img{max-width:230px;max-height:240px;width:auto;height:auto}.photo-item figcaption{margin-top:5px;font-weight:600}</style></head><body>'
    + '<header><strong>BuildTrack</strong><h1>' + escape(title) + '</h1><p>' + escape(opr.title) + '</p><p>'
    + escape([projectName, opr.location, opr.date].filter(Boolean).join(' · ')) + '</p></header><p>' + escape(extra.reference) + ' ' + escape(opr.id)
    + ' · ' + escape(copy.conductor) + ' : ' + escape(opr.conducteur || '—') + '</p>'
    + (visit ? '<p>' + escape(copy.contradictoryVisit) + ' : ' + escape(visit) + '</p>' : '')
    + (participants && kind !== 'convocation' ? '<h2>' + escape(copy.participants) + '</h2><ul>' + participants + '</ul>' : '')
    + '<h2>' + escape(copy.detailByLot) + '</h2><table><thead><tr><th>' + escape(copy.lot) + '</th><th>' + escape(copy.company) + '</th><th>' + escape(copy.status) + '</th><th>' + escape(copy.reserve) + '</th><th>'
    + escape(kind === 'levee' ? copy.closedDate : copy.closureDeadline) + '</th><th>' + escape(copy.observations) + '</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="6">' + escape(extra.noLot) + '</td></tr>') + '</tbody></table>'
    + (photoSections ? '<h2>' + escape(copy.photosBeforeAfter) + '</h2>' + photoSections : '')
    + '<h2>' + escape(extra.signers) + '</h2>' + (signatures.length ? '<ul>' + signatures.join('') + '</ul>' : '<p>' + escape(extra.noSigner) + '</p>') + '</body></html>';
}
