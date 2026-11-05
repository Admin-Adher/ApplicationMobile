import { getPdfCompanyPalette, renderPdfCompanyLabel, type PdfCompany } from '../../../../lib/pdfCompanyColors';
import type { OprSummary, ReserveSource } from './opr-workspace-model';

export type OprPrintKind = 'pv' | 'convocation' | 'levee';

const titleByKind = { pv: 'Procès-verbal de réception', convocation: 'Convocation à la visite contradictoire', levee: 'Procès-verbal de levée des réserves' };
const labels: Record<string, string> = { ok: 'Conforme', reserve: 'Réserve', non_applicable: 'Non applicable' };

function escape(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function buildWebOprPrint(opr: OprSummary, projectName: string, reserves: ReserveSource[], kind: OprPrintKind, companies?: PdfCompany[]) {
  const palette = getPdfCompanyPalette(companies);
  const title = titleByKind[kind];
  const source = opr.source;
  const reserveById = new Map(reserves.map(reserve => [reserve.id, reserve]));
  const items = kind === 'pv' ? opr.items : opr.items.filter(item => item.status === 'reserve');
  const signers = Array.isArray(source.signatories) ? source.signatories : [];
  const visit = typeof source.visit_contradictoire === 'string' && !/^(true|false)$/i.test(source.visit_contradictoire) ? source.visit_contradictoire : '';
  const rows = items.map(item => {
    const reserve = reserveById.get(item.reserveId);
    const label = kind === 'levee' ? (reserve?.status === 'closed' ? 'Levée' : 'En attente') : labels[item.status];
    return '<tr><td>' + escape(item.lotName) + '</td><td>' + renderPdfCompanyLabel(item.entreprise || '—', palette) + '</td><td>'
      + escape(label) + '</td><td>' + escape(item.reserveId || '—') + '</td><td>'
      + escape(kind === 'levee' ? reserve?.closed_at || '—' : item.deadline || '—')
      + '</td><td>' + escape(item.note || item.description || '—') + '</td></tr>';
  }).join('');
  const signatures = signers.map(signer => {
    const signature = typeof signer?.signature === 'string' && signer.signature.startsWith('<svg')
      ? '<img alt="" src="data:image/svg+xml,' + escape(encodeURIComponent(signer.signature)) + '"/>' : '';
    return '<li><strong>' + escape(signer?.name) + '</strong> · ' + escape(signer?.role || 'Participant')
      + (signer?.signed || signer?.signedAt ? ' · Signé ' + escape(signer.signedAt) : ' · En attente')
      + (kind !== 'convocation' ? signature : '') + '</li>';
  }).join('');
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + escape(title)
    + '</title><style>@page{size:A4;margin:15mm}body{font:12px system-ui,Arial;color:#172b45;print-color-adjust:exact}h1{color:#003082;margin:.5em 0}h2{font-size:15px;margin:1.4em 0 .4em}header{border-bottom:3px solid #003082;padding-bottom:.6em}table{border-collapse:collapse;width:100%}th,td{text-align:left;border:1px solid #dce4ef;padding:.5em;vertical-align:top}th{color:white;background:#003082}tr,li{break-inside:avoid}li{margin:.5em 0}img{display:block;max-width:170px;max-height:70px}</style></head><body>'
    + '<header><strong>BuildTrack</strong><h1>' + escape(title) + '</h1><p>' + escape(opr.title) + '</p><p>'
    + escape([projectName, opr.location, opr.date].filter(Boolean).join(' · ')) + '</p></header><p>Réf. ' + escape(opr.id)
    + ' · Conducteur : ' + escape(opr.conducteur || '—') + '</p>'
    + (visit ? '<p>Visite contradictoire : ' + escape(visit) + '</p>' : '')
    + '<h2>Lots et réserves</h2><table><thead><tr><th>Lot</th><th>Entreprise</th><th>Statut</th><th>Réserve</th><th>'
    + (kind === 'levee' ? 'Date de levée' : 'Échéance') + '</th><th>Observations</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="6">Aucun lot concerné.</td></tr>') + '</tbody></table><h2>Signataires</h2>'
    + (signatures ? '<ul>' + signatures + '</ul>' : '<p>Aucun signataire renseigné.</p>') + '</body></html>';
}
