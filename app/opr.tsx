import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Platform,
  Modal,
  KeyboardAvoidingView,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateInput from '@/components/DateInput';
import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import {
  exportPDF as exportPDFHelper,
  loadPhotoAsDataUrl, loadPhotoAsDataUrlForPdf,
  svgStringToDataUrl,
  buildLetterhead,
  buildInfoGrid,
  buildKpiRow,
  buildDocFooter,
  wrapHTML,
  escapeHtml,
} from '@/lib/pdfBase';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { Opr, OprItem, OprSignatory, OprStatus, Reserve } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';
import SignaturePad, { SignaturePadRef } from '@/components/SignaturePad';
import { genId, formatDateFR, nowTimestampFR } from '@/lib/utils';
import { formatDate } from '@/lib/reserveUtils';
import LocationPicker from '@/components/LocationPicker';
import {
  enrichReservesForPdf as enrichReserveListForPdf,
  formatReserveLocation,
  getReservePdfPhotos,
} from '@/lib/pdfReserveHelpers';
import { buildPdfFilename } from '@/lib/pdfFilename';

type TFunc = (key: string, options?: Record<string, any>) => string;

const ITEM_STATUS_CFG = {
  ok: { labelKey: 'oprScreen.itemStatus.ok', color: C.closed, icon: 'checkmark-circle' },
  reserve: { labelKey: 'oprScreen.itemStatus.reserve', color: C.open, icon: 'warning' },
  non_applicable: { labelKey: 'oprScreen.itemStatus.nonApplicable', color: C.textMuted, icon: 'remove-circle-outline' },
};

const DEFAULT_OPR_ITEM_KEYS = [
  'structure',
  'roofing',
  'externalJoinery',
  'internalJoinery',
  'drywall',
  'flooring',
  'painting',
  'plumbing',
  'hvac',
  'electricity',
  'lowVoltage',
  'outdoor',
];

type PdfLang = 'fr' | 'en' | 'es';

function pdfLang(language?: string | null): PdfLang {
  if (language?.startsWith('en')) return 'en';
  if (language?.startsWith('es')) return 'es';
  return 'fr';
}

function pdfLocale(language?: string | null): string {
  if (language?.startsWith('en')) return 'en-US';
  if (language?.startsWith('es')) return 'es-ES';
  return 'fr-FR';
}

const OPR_PDF_COPY: Record<PdfLang, Record<string, string>> = {
  fr: {
    noValue: '—',
    receptionReport: 'Procès-verbal de réception',
    electronicSignatures: 'Signatures électroniques',
    signedReport: 'PV signé électroniquement le {{date}}',
    signatures: 'Signatures',
    manager: 'Conducteur de travaux',
    owner: "Maître d'ouvrage",
    signedOn: 'Signé le',
    date: 'Date',
    location: 'Localisation',
    receptionDate: 'Date de réception',
    contradictoryVisit: 'Visite contradictoire',
    participants: 'Participants à la visite contradictoire',
    name: 'Nom',
    companyFunction: 'Entreprise / fonction',
    presence: 'Présence',
    present: 'Présent',
    absent: 'Absent',
    compliant: 'Conforme',
    reserves: 'Réserves',
    reserve: 'Réserve',
    nonApplicable: 'Non applicable',
    conformity: 'Conformité',
    detailByLot: 'Détail par lot',
    lot: 'Lot',
    company: 'Entreprise',
    status: 'Statut',
    closureDeadline: 'Délai levée',
    reserveNo: 'N° rés.',
    observations: 'Observations',
    noControlPoint: 'Aucun point de contrôle',
    closureReport: 'Procès-verbal de levée de réserves',
    photosBeforeAfter: 'Photographies - Avant / Après levée',
    initialFinding: 'Constat initial',
    closedFinding: 'Levée constatée',
    closureCertification: 'Certification de levée des réserves',
    closureCertificationText: 'Les soussignés certifient avoir procédé à la vérification des réserves émises lors du procès-verbal de réception référencé {{id}} et attestent que les réserves indiquées comme « Levée » ont été régulièrement exécutées et conformes aux prescriptions contractuelles.',
    oprReference: 'Référence OPR',
    receptionDateShort: 'Date réception',
    conductor: 'Conducteur',
    reservesInReport: 'Réserves au PV',
    closed: 'Levées',
    waiting: 'En attente',
    closureRate: 'Taux de levée',
    allClosed: 'Toutes les réserves ont été levées - La réception est définitive.',
    pendingClosure: '{{count}} réserve(s) en attente - La réception définitive ne peut être prononcée qu’après levée de l’ensemble des réserves.',
    summaryByLot: 'Tableau récapitulatif des réserves par lot',
    description: 'Description',
    closedDate: 'Date levée',
    closedBy: 'Levée par',
    noReserveReception: 'Aucune réserve - Réception sans réserve',
    convocationTitle: 'Lettre de convocation - OPR',
    convocationObject: 'Objet',
    convocationObjectText: 'Convocation aux Opérations Préalables à la Réception (OPR) - {{title}}',
    controlPoints: 'Points de contrôle',
    emittedReserves: 'Réserves émises',
    invited: 'Convoqués',
    convocationPurpose: 'Objet de la convocation',
    convocationBody: "Par la présente, vous êtes convoqué(e) à participer aux Opérations Préalables à la Réception (OPR) du chantier {{project}} conformément aux dispositions contractuelles en vigueur. La réception des travaux intervient à la fin de l'exécution du marché. Elle permet de constater l'état d'achèvement des travaux et d'établir, le cas échéant, la liste des réserves à lever avant la réception définitive.",
    reservesBeforeReception: 'Réserves à lever avant réception',
    noReservePlanned: 'Aucune réserve - Réception envisagée sans réserve.',
    invitedParties: 'Parties convoquées',
    qualityRole: 'Qualité / rôle',
    email: 'Email',
    confirmed: 'Confirmé',
    summoned: 'Convoqué',
    noInvitedSigner: 'Aucun signataire invité - à compléter avant envoi',
    managerSignature: 'Signature du conducteur de travaux',
    acknowledgement: 'Accusé de réception',
    recipientSignature: 'Nom, date et signature du destinataire',
  },
  en: {
    noValue: '—',
    receptionReport: 'Handover report',
    electronicSignatures: 'Electronic signatures',
    signedReport: 'Report electronically signed on {{date}}',
    signatures: 'Signatures',
    manager: 'Construction manager',
    owner: 'Client',
    signedOn: 'Signed on',
    date: 'Date',
    location: 'Location',
    receptionDate: 'Handover date',
    contradictoryVisit: 'Joint inspection',
    participants: 'Joint inspection participants',
    name: 'Name',
    companyFunction: 'Company / role',
    presence: 'Presence',
    present: 'Present',
    absent: 'Absent',
    compliant: 'Compliant',
    reserves: 'Issues',
    reserve: 'Issue',
    nonApplicable: 'Not applicable',
    conformity: 'Compliance',
    detailByLot: 'Details by trade',
    lot: 'Trade',
    company: 'Company',
    status: 'Status',
    closureDeadline: 'Closure deadline',
    reserveNo: 'Issue no.',
    observations: 'Observations',
    noControlPoint: 'No control point',
    closureReport: 'Issue closure report',
    photosBeforeAfter: 'Photos - Before / after closure',
    initialFinding: 'Initial finding',
    closedFinding: 'Closure confirmed',
    closureCertification: 'Issue closure certification',
    closureCertificationText: 'The undersigned certify that they have checked the issues raised in handover report {{id}} and confirm that the issues marked as closed were properly completed and comply with contractual requirements.',
    oprReference: 'OPR reference',
    receptionDateShort: 'Handover date',
    conductor: 'Manager',
    reservesInReport: 'Issues in report',
    closed: 'Closed',
    waiting: 'Waiting',
    closureRate: 'Closure rate',
    allClosed: 'All issues have been closed - Handover is final.',
    pendingClosure: '{{count}} issue(s) still waiting - Final handover can only be confirmed after all issues are closed.',
    summaryByLot: 'Issue summary by trade',
    description: 'Description',
    closedDate: 'Closure date',
    closedBy: 'Closed by',
    noReserveReception: 'No issue - Handover without reservations',
    convocationTitle: 'OPR convocation letter',
    convocationObject: 'Subject',
    convocationObjectText: 'Convocation to the handover inspection (OPR) - {{title}}',
    controlPoints: 'Control points',
    emittedReserves: 'Issues raised',
    invited: 'Invited',
    convocationPurpose: 'Purpose of the convocation',
    convocationBody: 'You are invited to attend the handover inspection (OPR) for project {{project}} in accordance with the contractual provisions in force. Handover takes place at the end of the works. It records the completion status and, where applicable, the list of issues to close before final handover.',
    reservesBeforeReception: 'Issues to close before handover',
    noReservePlanned: 'No issue - Handover planned without reservations.',
    invitedParties: 'Invited parties',
    qualityRole: 'Position / role',
    email: 'Email',
    confirmed: 'Confirmed',
    summoned: 'Invited',
    noInvitedSigner: 'No invited signatory - complete before sending',
    managerSignature: 'Construction manager signature',
    acknowledgement: 'Acknowledgement of receipt',
    recipientSignature: 'Recipient name, date and signature',
  },
  es: {
    noValue: '—',
    receptionReport: 'Acta de recepción',
    electronicSignatures: 'Firmas electrónicas',
    signedReport: 'Acta firmada electrónicamente el {{date}}',
    signatures: 'Firmas',
    manager: 'Jefe de obra',
    owner: 'Cliente',
    signedOn: 'Firmado el',
    date: 'Fecha',
    location: 'Ubicación',
    receptionDate: 'Fecha de recepción',
    contradictoryVisit: 'Visita contradictoria',
    participants: 'Participantes en la visita contradictoria',
    name: 'Nombre',
    companyFunction: 'Empresa / función',
    presence: 'Presencia',
    present: 'Presente',
    absent: 'Ausente',
    compliant: 'Conforme',
    reserves: 'Incidencias',
    reserve: 'Incidencia',
    nonApplicable: 'No aplicable',
    conformity: 'Conformidad',
    detailByLot: 'Detalle por lote',
    lot: 'Lote',
    company: 'Empresa',
    status: 'Estado',
    closureDeadline: 'Plazo de cierre',
    reserveNo: 'N° incidencia',
    observations: 'Observaciones',
    noControlPoint: 'Ningún punto de control',
    closureReport: 'Acta de cierre de incidencias',
    photosBeforeAfter: 'Fotografías - Antes / después del cierre',
    initialFinding: 'Constatación inicial',
    closedFinding: 'Cierre constatado',
    closureCertification: 'Certificación de cierre de incidencias',
    closureCertificationText: 'Los abajo firmantes certifican haber verificado las incidencias emitidas en el acta de recepción {{id}} y declaran que las incidencias indicadas como cerradas se ejecutaron correctamente y conforme a los requisitos contractuales.',
    oprReference: 'Referencia OPR',
    receptionDateShort: 'Fecha recepción',
    conductor: 'Jefe de obra',
    reservesInReport: 'Incidencias del acta',
    closed: 'Cerradas',
    waiting: 'Pendientes',
    closureRate: 'Tasa de cierre',
    allClosed: 'Todas las incidencias se han cerrado - La recepción es definitiva.',
    pendingClosure: '{{count}} incidencia(s) pendiente(s) - La recepción definitiva solo puede confirmarse tras cerrar todas las incidencias.',
    summaryByLot: 'Resumen de incidencias por lote',
    description: 'Descripción',
    closedDate: 'Fecha cierre',
    closedBy: 'Cerrada por',
    noReserveReception: 'Ninguna incidencia - Recepción sin reservas',
    convocationTitle: 'Carta de convocatoria OPR',
    convocationObject: 'Asunto',
    convocationObjectText: 'Convocatoria a las operaciones previas a la recepción (OPR) - {{title}}',
    controlPoints: 'Puntos de control',
    emittedReserves: 'Incidencias emitidas',
    invited: 'Convocados',
    convocationPurpose: 'Objeto de la convocatoria',
    convocationBody: 'Por la presente, se le convoca a participar en las operaciones previas a la recepción (OPR) de la obra {{project}} conforme a las disposiciones contractuales vigentes. La recepción de los trabajos se realiza al final de la ejecución y permite constatar el estado de terminación y, si procede, la lista de incidencias que deben cerrarse antes de la recepción definitiva.',
    reservesBeforeReception: 'Incidencias que cerrar antes de la recepción',
    noReservePlanned: 'Ninguna incidencia - Recepción prevista sin reservas.',
    invitedParties: 'Partes convocadas',
    qualityRole: 'Cargo / rol',
    email: 'Email',
    confirmed: 'Confirmado',
    summoned: 'Convocado',
    noInvitedSigner: 'Ningún firmante invitado - completar antes del envío',
    managerSignature: 'Firma del jefe de obra',
    acknowledgement: 'Acuse de recibo',
    recipientSignature: 'Nombre, fecha y firma del destinatario',
  },
};

function oprPdfCopy(language?: string | null) {
  return OPR_PDF_COPY[pdfLang(language)];
}

function interpolatePdf(text: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((acc, [key, value]) => acc.replaceAll(`{{${key}}}`, String(value)), text);
}

function buildOprPDF(opr: Opr, projectName: string, t: TFunc, language?: string | null): string {
  const copy = oprPdfCopy(language);
  const locale = pdfLocale(language);
  const statusIcons: Record<string, string> = { ok: '✓', reserve: '⚠', non_applicable: '—' };
  const statusColors: Record<string, string> = { ok: '#059669', reserve: '#DC2626', non_applicable: '#6B7280' };
  const statusBg: Record<string, string> = { ok: '#ECFDF5', reserve: '#FEF2F2', non_applicable: '#F9FAFB' };

  const rows = opr.items.map((item, idx) =>
    `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:700">${escapeHtml(item.lotName)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${escapeHtml(item.entreprise ?? '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        <span style="background:${statusBg[item.status]};color:${statusColors[item.status]};font-weight:700;font-size:11px;padding:3px 10px;border-radius:12px">${statusIcons[item.status]} ${escapeHtml(t(ITEM_STATUS_CFG[item.status].labelKey))}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;${item.status === 'reserve' && item.deadline ? 'color:#DC2626;font-weight:700' : 'color:#6B7280'}">${item.status === 'reserve' ? escapeHtml(item.deadline ?? '—') : '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#003082;font-weight:700">${item.status === 'reserve' ? escapeHtml(item.reserveId ?? '—') : '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${escapeHtml(item.note ?? '')}</td>
    </tr>`
  ).join('');

  const totalOk = opr.items.filter(i => i.status === 'ok').length;
  const totalRes = opr.items.filter(i => i.status === 'reserve').length;
  const totalNA = opr.items.filter(i => i.status === 'non_applicable').length;
  const pctConformite = opr.items.length > 0 ? Math.round((totalOk / opr.items.length) * 100) : 0;
  const signedDate = opr.signedAt ?? opr.date;
  const today = new Date().toLocaleDateString(locale);

  const sigBlockHtml = opr.status === 'signed'
    ? `<div class="section-header">Signatures électroniques</div>
       <div class="alert alert-success">✓ PV signé électroniquement le ${signedDate}</div>
       <div class="sig-row">
         <div class="sig-block">
           <div class="sig-label">${escapeHtml(copy.manager)}</div>
           ${opr.conducteurSignature
             ? `<img src="${svgStringToDataUrl(opr.conducteurSignature)}" style="width:100%;max-width:260px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
             : '<div class="sig-line"></div>'
           }
           <div class="sig-name">${escapeHtml(opr.conducteur)}</div>
           <div class="sig-date">${escapeHtml(copy.signedOn)} ${escapeHtml(signedDate)}</div>
         </div>
         <div class="sig-block">
           <div class="sig-label">${escapeHtml(copy.owner)}</div>
           ${opr.moSignature
             ? `<img src="${svgStringToDataUrl(opr.moSignature)}" style="width:100%;max-width:260px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
             : '<div class="sig-line"></div>'
           }
           <div class="sig-name">${escapeHtml(opr.maireOuvrage ?? copy.noValue)}</div>
           <div class="sig-date">${escapeHtml(copy.signedOn)} ${escapeHtml(signedDate)}</div>
         </div>
       </div>`
    : `<div class="section-header">${escapeHtml(copy.signatures)}</div>
       <div class="sig-row">
         <div class="sig-block">
           <div class="sig-label">${escapeHtml(copy.manager)}</div>
           <div class="sig-line"></div>
           <div class="sig-name">${escapeHtml(opr.conducteur)}</div>
           <div class="sig-date">${escapeHtml(copy.date)} : _______________</div>
         </div>
         <div class="sig-block">
           <div class="sig-label">${escapeHtml(copy.owner)}</div>
           <div class="sig-line"></div>
           <div class="sig-name">${escapeHtml(opr.maireOuvrage ?? '')}</div>
           <div class="sig-date">${escapeHtml(copy.date)} : _______________</div>
         </div>
       </div>`;

  const infoItems = [
    ...(opr.building || opr.level || opr.zone ? [{ label: copy.location, value: [opr.building, opr.level, opr.zone].filter(Boolean).join(' — ') }] : []),
    { label: copy.manager, value: opr.conducteur },
    ...(opr.maireOuvrage ? [{ label: copy.owner, value: opr.maireOuvrage }] : []),
    { label: copy.receptionDate, value: opr.date },
    ...(opr.visitContradictoire ? [{ label: copy.contradictoryVisit, value: opr.visitContradictoire }] : []),
  ];

  const participants = opr.visitParticipants ?? [];
  const participantsSection = participants.length > 0 ? `
    <div class="section-header">${escapeHtml(copy.participants)}</div>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(copy.name)}</th>
          <th>${escapeHtml(copy.companyFunction)}</th>
          <th style="text-align:center">${escapeHtml(copy.presence)}</th>
        </tr>
      </thead>
      <tbody>
        ${participants.map((p, idx) => `
          <tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
            <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:700">${escapeHtml(p.name)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${escapeHtml(p.company || '—')}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
              <span style="background:${p.present ? '#ECFDF5' : '#FEF2F2'};color:${p.present ? '#059669' : '#DC2626'};font-weight:700;font-size:10px;padding:2px 8px;border-radius:10px">${p.present ? `✓ ${escapeHtml(copy.present)}` : `✗ ${escapeHtml(copy.absent)}`}</span>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>` : '';

  const body = `
    ${buildLetterhead(copy.receptionReport, opr.title, opr.id, today, projectName, { locale })}
    ${buildInfoGrid(infoItems)}
    ${buildKpiRow([
      { val: totalOk, label: copy.compliant, color: '#059669' },
      { val: totalRes, label: totalRes > 1 ? copy.reserves : copy.reserve, color: '#DC2626' },
      { val: totalNA, label: copy.nonApplicable, color: '#6B7280' },
      { val: `${pctConformite}%`, label: copy.conformity, color: '#003082' },
    ])}
    ${participantsSection}
    <div class="section-header">${escapeHtml(copy.detailByLot)}</div>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(copy.lot)}</th>
          <th>${escapeHtml(copy.company)}</th>
          <th style="text-align:center">${escapeHtml(copy.status)}</th>
          <th>${escapeHtml(copy.closureDeadline)}</th>
          <th>${escapeHtml(copy.reserveNo)}</th>
          <th>${escapeHtml(copy.observations)}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="6" style="padding:14px;text-align:center;color:#059669">${escapeHtml(copy.noControlPoint)}</td></tr>`}</tbody>
    </table>
    ${sigBlockHtml}
    ${buildDocFooter(projectName, { locale })}
  `;

  return wrapHTML(body, `${copy.receptionReport} - ${opr.title}`);
}

async function buildPvLeveePDF(opr: Opr, reserves: Reserve[], projectName: string, language?: string | null): Promise<string> {
  const copy = oprPdfCopy(language);
  const locale = pdfLocale(language);
  const dateShort = new Date().toLocaleDateString(locale);
  const docRef = `PVL-${opr.id}-${dateShort.replace(/\//g, '')}`;

  const reserveItems = opr.items.filter(i => i.status === 'reserve');
  const totalReserves = reserveItems.length;

  const linked = reserveItems.map(item => {
    const reserve = item.reserveId ? reserves.find(r => r.id === item.reserveId) : undefined;
    return { item, reserve };
  });
  const leveed = linked.filter(({ reserve }) => reserve?.status === 'closed');
  const pending = linked.filter(({ reserve }) => !reserve || reserve.status !== 'closed');

  const photoData: Record<string, { defect?: string; resolution?: string }> = {};
  await Promise.all(
    leveed.map(async ({ reserve }) => {
      const reservePhotos = reserve ? getReservePdfPhotos(reserve) : [];
      if (!reserve || !reservePhotos.length) return;
      const defectPhoto = reservePhotos.find(p => p.kind === 'defect');
      const resolutionPhoto = reservePhotos.find(p => p.kind === 'resolution');
      const [dSrc, rSrc] = await Promise.all([
        defectPhoto ? loadPhotoAsDataUrlForPdf(defectPhoto.uri) : Promise.resolve(''),
        resolutionPhoto ? loadPhotoAsDataUrlForPdf(resolutionPhoto.uri) : Promise.resolve(''),
      ]);
      photoData[reserve.id] = { defect: dSrc || undefined, resolution: rSrc || undefined };
    })
  );

  const rows = reserveItems.map((item, idx) => {
    const reserve = item.reserveId ? reserves.find(r => r.id === item.reserveId) : undefined;
    const isLevee = reserve?.status === 'closed';
    return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-weight:700;font-size:11px">${escapeHtml(item.lotName)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#003082;font-weight:700">${escapeHtml(item.reserveId ?? '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${escapeHtml(item.description !== item.lotName ? item.description : (reserve?.title ?? '—'))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${reserve ? escapeHtml(formatReserveLocation(reserve)) : '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        ${isLevee
          ? `<span style="background:#ECFDF5;color:#059669;font-weight:700;padding:3px 10px;border-radius:12px;font-size:10px">✓ ${escapeHtml(copy.closed)}</span>`
          : `<span style="background:#FEF2F2;color:#DC2626;font-weight:700;padding:3px 10px;border-radius:12px;font-size:10px">⚠ ${escapeHtml(copy.waiting)}</span>`}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#059669">${escapeHtml(reserve?.closedAt ?? '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${escapeHtml(reserve?.closedBy ?? '—')}</td>
    </tr>`;
  }).join('');

  const leveedWithPhotos = leveed.filter(({ reserve }) => reserve && photoData[reserve.id] && (photoData[reserve.id].defect || photoData[reserve.id].resolution));
  const photoSection = leveedWithPhotos.length > 0 ? `
    <div class="section-header">${escapeHtml(copy.photosBeforeAfter)}</div>
    ${leveedWithPhotos.map(({ item, reserve }) => {
      if (!reserve) return '';
      const photos = photoData[reserve.id];
      return `<div style="margin-bottom:20px;page-break-inside:avoid">
        <div style="font-size:11px;font-weight:700;color:#1A2742;margin-bottom:8px;background:#F4F7FB;padding:6px 10px;border-radius:6px">${escapeHtml(item.lotName)} — ${escapeHtml(reserve.title)} <span style="color:#6B7280;font-weight:400">· ${escapeHtml(formatReserveLocation(reserve))}</span></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${photos.defect ? `<div style="text-align:center"><img src="${photos.defect}" style="width:200px;height:auto;max-height:240px;object-fit:contain;background:#FFF5F5;border-radius:8px;border:2px solid #FCA5A5;display:block" /><div style="font-size:10px;color:#DC2626;font-weight:700;margin-top:4px">${escapeHtml(copy.initialFinding)}</div></div>` : ''}
          ${photos.resolution ? `<div style="text-align:center"><img src="${photos.resolution}" style="width:200px;height:auto;max-height:240px;object-fit:contain;background:#F0FFF4;border-radius:8px;border:2px solid #6EE7B7;display:block" /><div style="font-size:10px;color:#059669;font-weight:700;margin-top:4px">${escapeHtml(copy.closedFinding)}</div></div>` : ''}
        </div>
      </div>`;
    }).join('')}
  ` : '';

  const conducteurSigHtml = opr.conducteurSignature
    ? `<img src="${svgStringToDataUrl(opr.conducteurSignature)}" style="width:100%;max-width:240px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
    : '<div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>';
  const moSigHtml = opr.moSignature
    ? `<img src="${svgStringToDataUrl(opr.moSignature)}" style="width:100%;max-width:240px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
    : '<div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>';

  const signatureBlock = `
    <div style="margin-top:36px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div class="section-header">${escapeHtml(copy.closureCertification)}</div>
      <div class="alert alert-info" style="margin-bottom:20px">
        ${escapeHtml(interpolatePdf(copy.closureCertificationText, { id: opr.id }))}
      </div>
      <div class="sig-row">
        <div class="sig-block">
          <div class="sig-label">${escapeHtml(copy.manager)}</div>
          ${conducteurSigHtml}
          <div class="sig-name">${escapeHtml(opr.conducteur)}</div>
          <div class="sig-date">${escapeHtml(copy.date)} : ${escapeHtml(dateShort)}</div>
        </div>
        <div class="sig-block">
          <div class="sig-label">${escapeHtml(copy.owner)}</div>
          ${moSigHtml}
          <div class="sig-name">${escapeHtml(opr.maireOuvrage ?? copy.noValue)}</div>
          <div class="sig-date">${escapeHtml(copy.date)} : ${escapeHtml(dateShort)}</div>
        </div>
      </div>
    </div>`;

  const infoItems = [
    { label: copy.oprReference, value: opr.id },
    { label: copy.receptionDateShort, value: opr.date },
    ...((opr.building || opr.level || opr.zone) ? [{ label: copy.location, value: [opr.building, opr.level, opr.zone].filter(Boolean).join(' - ') }] : []),
    { label: copy.conductor, value: opr.conducteur },
    ...(opr.maireOuvrage ? [{ label: copy.owner, value: opr.maireOuvrage }] : []),
  ];

  const body = `
    ${buildLetterhead(copy.closureReport, opr.title, docRef, dateShort, projectName, { locale })}
    ${buildInfoGrid(infoItems)}
    ${buildKpiRow([
      { val: totalReserves, label: copy.reservesInReport, color: '#003082' },
      { val: leveed.length, label: copy.closed, color: '#059669' },
      { val: pending.length, label: copy.waiting, color: pending.length > 0 ? '#DC2626' : '#059669' },
      { val: totalReserves > 0 ? Math.round((leveed.length / totalReserves) * 100) + '%' : copy.noValue, label: copy.closureRate, color: '#003082' },
    ])}
    ${pending.length === 0
      ? `<div class="alert alert-success">${escapeHtml(copy.allClosed)}</div>`
      : `<div class="alert alert-warning">${escapeHtml(interpolatePdf(copy.pendingClosure, { count: pending.length }))}</div>`
    }
    <div class="section-header">${escapeHtml(copy.summaryByLot)}</div>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(copy.lot)}</th>
          <th>${escapeHtml(copy.reserve)}</th>
          <th>${escapeHtml(copy.description)}</th>
          <th>${escapeHtml(copy.location)}</th>
          <th style="text-align:center">${escapeHtml(copy.status)}</th>
          <th>${escapeHtml(copy.closedDate)}</th>
          <th>${escapeHtml(copy.closedBy)}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7" style="text-align:center;color:#059669;padding:14px">${escapeHtml(copy.noReserveReception)}</td></tr>`}</tbody>
    </table>
    ${photoSection}
    ${signatureBlock}
    ${buildDocFooter(projectName, { locale })}
  `;

  return wrapHTML(body, `${copy.closureReport} - ${opr.id}`);
}

function buildConvocationPDF(opr: Opr, projectName: string, conducteur: string, language?: string | null): string {
  const copy = oprPdfCopy(language);
  const locale = pdfLocale(language);
  const today = new Date().toLocaleDateString(locale);
  const docRef = `CONV-${opr.id}-${today.replace(/\//g, '')}`;
  const reserveItems = opr.items.filter(i => i.status === 'reserve');
  const totalItems = opr.items.length;
  const signatories = opr.signatories ?? [];

  const reserveRows = reserveItems.map((item, idx) =>
    `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:700">${escapeHtml(item.lotName)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${escapeHtml(item.entreprise ?? '—')}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#DC2626;font-weight:700">${escapeHtml(item.deadline ?? '—')}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${escapeHtml(item.note ?? '')}</td>
    </tr>`
  ).join('');

  const participants = signatories.length > 0
    ? signatories.map(s =>
        `<tr>
          <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:600">${escapeHtml(s.name)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${escapeHtml(s.role)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${escapeHtml(s.email ?? '—')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
            ${s.signedAt
              ? `<span style="background:#ECFDF5;color:#059669;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px">&#10003; ${escapeHtml(copy.confirmed)}</span>`
              : `<span style="background:#F9FAFB;color:#6B7280;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px">${escapeHtml(copy.summoned)}</span>`}
          </td>
        </tr>`
      ).join('')
    : `<tr><td colspan="4" style="padding:10px;text-align:center;color:#6B7280;font-style:italic;font-size:11px">${escapeHtml(copy.noInvitedSigner)}</td></tr>`;

  const body = `
    ${buildLetterhead(copy.convocationTitle, opr.title, docRef, today, projectName, { locale })}
    <div style="background:#FFF8E1;border-left:4px solid #F59E0B;padding:12px 16px;border-radius:0 10px 10px 0;margin-bottom:22px;font-size:12px;color:#92400E">
      <strong>${escapeHtml(copy.convocationObject)} :</strong> ${escapeHtml(interpolatePdf(copy.convocationObjectText, { title: opr.title }))}
    </div>
    ${buildInfoGrid([
      { label: copy.oprReference, value: opr.id },
      { label: copy.receptionDate, value: opr.date },
      ...((opr.building || opr.level || opr.zone) ? [{ label: copy.location, value: [opr.building, opr.level, opr.zone].filter(Boolean).join(' - ') }] : []),
      { label: copy.conductor, value: conducteur },
      ...(opr.maireOuvrage ? [{ label: copy.owner, value: opr.maireOuvrage }] : []),
      ...(opr.visitContradictoire ? [{ label: copy.contradictoryVisit, value: opr.visitContradictoire }] : []),
    ])}
    ${buildKpiRow([
      { val: totalItems, label: copy.controlPoints, color: '#003082' },
      { val: reserveItems.length, label: copy.emittedReserves, color: '#DC2626' },
      { val: opr.items.filter(i => i.status === 'ok').length, label: copy.compliant, color: '#059669' },
      { val: signatories.length, label: copy.invited, color: '#D97706' },
    ])}
    <div class="section-header">${escapeHtml(copy.convocationPurpose)}</div>
    <div style="background:#F4F7FB;border-radius:10px;padding:14px 16px;border:1px solid #DDE4EE;font-size:12px;line-height:1.8;margin-bottom:16px">
      ${escapeHtml(interpolatePdf(copy.convocationBody, { project: projectName }))}
    </div>
    ${reserveItems.length > 0 ? `
    <div class="section-header">${escapeHtml(copy.reservesBeforeReception)} (${reserveItems.length})</div>
    <table>
      <thead><tr>
        <th>${escapeHtml(copy.lot)}</th><th>${escapeHtml(copy.company)}</th><th>${escapeHtml(copy.closureDeadline)}</th><th>${escapeHtml(copy.observations)}</th>
      </tr></thead>
      <tbody>${reserveRows}</tbody>
    </table>
    ` : `<div class="alert alert-success">${escapeHtml(copy.noReservePlanned)}</div>`}
    <div class="section-header">${escapeHtml(copy.invitedParties)}</div>
    <table>
      <thead><tr>
        <th>${escapeHtml(copy.name)}</th><th>${escapeHtml(copy.qualityRole)}</th><th>${escapeHtml(copy.email)}</th><th style="text-align:center">${escapeHtml(copy.status)}</th>
      </tr></thead>
      <tbody>${participants}</tbody>
    </table>
    <div style="margin-top:36px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div class="section-header">${escapeHtml(copy.managerSignature)}</div>
      <div style="display:flex;gap:40px;margin-top:16px">
        <div>
          <div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:28px;font-weight:700">${escapeHtml(copy.manager)}</div>
          <div style="height:60px;border-bottom:2px solid #1A2742;width:220px;margin-bottom:8px"></div>
          <div style="font-size:12px;font-weight:700;color:#1A2742">${conducteur}</div>
          <div style="font-size:10px;color:#6B7280">${escapeHtml(copy.date)} : ${today}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:28px;font-weight:700">${escapeHtml(copy.acknowledgement)}</div>
          <div style="height:60px;border-bottom:2px solid #1A2742;width:220px;margin-bottom:8px"></div>
          <div style="font-size:10px;color:#6B7280">${escapeHtml(copy.recipientSignature)}</div>
        </div>
      </div>
    </div>
    ${buildDocFooter(projectName, { locale })}
  `;

  return wrapHTML(body, `${copy.convocationTitle} - ${opr.id}`);
}

export default function OprScreen() {
  const { t, i18n } = useTranslation();
  const { oprs, addOpr, updateOpr, deleteOpr, lots, reserves, activeChantierId, activeChantier, updateReserveStatus, photos } = useApp();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();

  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(formatDateFR(new Date()));
  const [building, setBuilding] = useState('');
  const [level, setLevel] = useState('');
  const [zone, setZone] = useState('');
  const [maireOuvrage, setMaireOuvrage] = useState('');

  const [signModalOpr, setSignModalOpr] = useState<Opr | null>(null);
  const [signStep, setSignStep] = useState<'conducteur' | 'mo'>('conducteur');
  const [signConducteurName, setSignConducteurName] = useState('');
  const [signMoName, setSignMoName] = useState('');

  const conducteurPadRef = useRef<SignaturePadRef>(null);
  const moPadRef = useRef<SignaturePadRef>(null);

  const [inviteModal, setInviteModal] = useState<{ opr: Opr } | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  const [visitDateForm, setVisitDateForm] = useState('');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [itemEdits, setItemEdits] = useState<Record<string, { entreprise: string; deadline: string; note: string }>>({});

  const [formLots, setFormLots] = useState<Array<{ id: string; name: string; entreprise: string }>>(
    () => DEFAULT_OPR_ITEM_KEYS.map(key => ({ id: genId(), name: t(`oprScreen.defaultItems.${key}`), entreprise: '' }))
  );
  const [showLotsConfig, setShowLotsConfig] = useState(false);
  const [newLotName, setNewLotName] = useState('');

  const [expandedParticipantsOpr, setExpandedParticipantsOpr] = useState<string | null>(null);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantCompany, setNewParticipantCompany] = useState('');

  const [linkReserveModal, setLinkReserveModal] = useState<{ opr: Opr; itemId: string } | null>(null);

  const [editingVisitOprId, setEditingVisitOprId] = useState<string | null>(null);
  const [editingVisitDate, setEditingVisitDate] = useState('');

  if (user?.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Header title="OPR" />
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ marginTop: 16, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text, textAlign: 'center' }}>{t('oprScreen.unauthorized')}</Text>
        <Text style={{ marginTop: 8, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center' }}>
          {t('oprScreen.subcontractorDenied')}
        </Text>
      </View>
    );
  }

  function addSignatory() {
    if (!inviteModal || !inviteName.trim()) return;
    const opr = inviteModal.opr;
    const newSig: OprSignatory = {
      id: genId(),
      name: inviteName.trim(),
      role: inviteRole.trim() || t('oprScreen.participant'),
      email: inviteEmail.trim() || undefined,
    };
    updateOpr({ ...opr, signatories: [...(opr.signatories ?? []), newSig] });
    setInviteName(''); setInviteRole(''); setInviteEmail('');
    setInviteModal(null);
  }

  function removeSignatory(opr: Opr, sigId: string) {
    Alert.alert(t('oprScreen.remove'), t('oprScreen.removeSignatoryText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('oprScreen.remove'), style: 'destructive', onPress: () =>
        updateOpr({ ...opr, signatories: (opr.signatories ?? []).filter(s => s.id !== sigId) })
      },
    ]);
  }

  const chantierOprs = useMemo(
    () => oprs.filter(o => !activeChantierId || o.chantierId === activeChantierId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [oprs, activeChantierId]
  );

  const enrichedReserves = useMemo(
    () => enrichReserveListForPdf(reserves, photos),
    [reserves, photos],
  );

  const chantierReserves = useMemo(
    () => enrichedReserves.filter(r => !activeChantierId || r.chantierId === activeChantierId),
    [enrichedReserves, activeChantierId]
  );

  function setItemStatus(opr: Opr, itemId: string, newStatus: 'ok' | 'reserve' | 'non_applicable') {
    const item = opr.items.find(i => i.id === itemId);
    if (!item) return;
    const updated = opr.items.map(i => i.id === itemId ? { ...i, status: newStatus } : i);
    updateOpr({ ...opr, items: updated });

    if (item.reserveId) {
      if (newStatus === 'ok') {
        updateReserveStatus(item.reserveId, 'closed', user?.name ?? 'OPR');
      } else if (item.status === 'ok' && newStatus === 'reserve') {
        updateReserveStatus(item.reserveId, 'in_progress', user?.name ?? 'OPR');
      }
    }

    if (newStatus === 'reserve') {
      setItemEdits(prev => ({
        ...prev,
        [itemId]: { entreprise: item.entreprise ?? '', deadline: item.deadline ?? '', note: item.note ?? '' },
      }));
      setExpandedItemId(itemId);
    } else if (expandedItemId === itemId) {
      setExpandedItemId(null);
    }
  }

  function addParticipant(opr: Opr) {
    if (!newParticipantName.trim()) return;
    const p = { id: genId(), name: newParticipantName.trim(), company: newParticipantCompany.trim(), present: true };
    updateOpr({ ...opr, visitParticipants: [...(opr.visitParticipants ?? []), p] });
    setNewParticipantName('');
    setNewParticipantCompany('');
  }

  function toggleParticipantPresent(opr: Opr, participantId: string) {
    const updated = (opr.visitParticipants ?? []).map(p =>
      p.id === participantId ? { ...p, present: !p.present } : p
    );
    updateOpr({ ...opr, visitParticipants: updated });
  }

  function removeParticipant(opr: Opr, participantId: string) {
    updateOpr({ ...opr, visitParticipants: (opr.visitParticipants ?? []).filter(p => p.id !== participantId) });
  }

  function linkReserveToItem(opr: Opr, itemId: string, reserveId: string) {
    const reserve = reserves.find(r => r.id === reserveId);
    const updated = opr.items.map(item =>
      item.id === itemId
        ? { ...item, reserveId, status: 'reserve' as const, description: reserve?.title ?? item.description }
        : item
    );
    updateOpr({ ...opr, items: updated });
    setLinkReserveModal(null);
  }

  function createOpr() {
    if (!title.trim()) { Alert.alert(t('oprScreen.requiredField'), t('oprScreen.titleRequired')); return; }
    const validLots = formLots.filter(l => l.name.trim());
    if (validLots.length === 0) { Alert.alert(t('oprScreen.lotsRequired'), t('oprScreen.addAtLeastOneLot')); return; }
    const items: OprItem[] = validLots.map(lot => ({
      id: genId(),
      lotName: lot.name.trim(),
      description: lot.name.trim(),
      status: 'ok' as const,
      entreprise: lot.entreprise.trim() || undefined,
    }));
    const opr: Opr = {
      id: 'OPR-' + genId().slice(0, 8).toUpperCase(),
      chantierId: activeChantierId ?? 'chan1',
      title: title.trim(),
      date,
      building,
      level,
      zone: zone.trim() || undefined,
      conducteur: user?.name ?? t('oprScreen.constructionManager'),
      status: 'draft',
      items,
      maireOuvrage: maireOuvrage.trim() || undefined,
      visitContradictoire: visitDateForm.trim() || undefined,
      createdAt: nowTimestampFR(),
    };
    addOpr(opr);
    setTitle('');
    setDate(formatDateFR(new Date()));
    setBuilding('');
    setLevel('');
    setZone('');
    setMaireOuvrage('');
    setVisitDateForm('');
    setFormLots(DEFAULT_OPR_ITEM_KEYS.map(key => ({ id: genId(), name: t(`oprScreen.defaultItems.${key}`), entreprise: '' })));
    setShowLotsConfig(false);
    setNewLotName('');
    setShowNew(false);
  }

  async function shareOprLink(opr: Opr) {
    const base = Platform.OS === 'web' ? window.location.origin : (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : process.env.EXPO_PUBLIC_APP_URL ?? '');
    const url = `${base}/opr-session/${opr.id}`;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(url); Alert.alert(t('oprScreen.linkCopied'), t('oprScreen.shareLinkHint')); } catch { Alert.alert(t('oprScreen.sessionLink'), url); }
      return;
    }
    try {
      await Share.share({ message: t('oprScreen.shareSessionMessage', { title: opr.title, url }), url });
    } catch {}
  }

  async function exportOprPDF(opr: Opr) {
    try {
      const html = buildOprPDF(opr, projectName, t, i18n.resolvedLanguage ?? i18n.language);
      await exportPDFHelper(html, buildPdfFilename('PV_OPR', [opr.id, opr.title, opr.level, projectName]));
    } catch (e: any) {
      Alert.alert(t('oprScreen.pdfError'), e?.message ?? '');
    }
  }

  async function exportLeveePDF(opr: Opr) {
    try {
      const html = await buildPvLeveePDF(opr, enrichedReserves, projectName, i18n.resolvedLanguage ?? i18n.language);
      await exportPDFHelper(html, buildPdfFilename('PV_Levee_OPR', [opr.id, opr.title, opr.level, projectName]));
    } catch (e: any) {
      Alert.alert(t('oprScreen.pdfError'), e?.message ?? '');
    }
  }

  async function exportConvocationPDF(opr: Opr) {
    try {
      const html = buildConvocationPDF(opr, projectName, user?.name ?? t('oprScreen.constructionManager'), i18n.resolvedLanguage ?? i18n.language);
      await exportPDFHelper(html, buildPdfFilename('Convocation_OPR', [opr.id, opr.title, opr.level, projectName]));
    } catch (e: any) {
      Alert.alert(t('oprScreen.pdfError'), e?.message ?? '');
    }
  }

  function openSignModal(opr: Opr) {
    setSignConducteurName(opr.conducteur ?? user?.name ?? '');
    setSignMoName(opr.maireOuvrage ?? '');
    setSignStep('conducteur');
    setSignModalOpr(opr);
  }

  async function confirmSign() {
    if (!signModalOpr) return;
    if (!signConducteurName.trim()) {
      Alert.alert(t('oprScreen.nameRequired'), t('oprScreen.managerNameRequired'));
      return;
    }
    if (!signMoName.trim()) {
      Alert.alert(t('oprScreen.nameRequired'), t('oprScreen.ownerNameRequired'));
      return;
    }

    const conducteurSig = conducteurPadRef.current?.isEmpty() ? undefined : conducteurPadRef.current?.getSVGData() ?? undefined;
    const moSig = moPadRef.current?.isEmpty() ? undefined : moPadRef.current?.getSVGData() ?? undefined;

    if (!conducteurSig) {
      Alert.alert(t('oprScreen.managerSignatureRequired'), t('oprScreen.managerSignatureRequiredText'));
      setSignStep('conducteur');
      return;
    }
    if (!moSig) {
      Alert.alert(t('oprScreen.ownerSignatureRequired'), t('oprScreen.ownerSignatureRequiredText'));
      return;
    }

    const now = nowTimestampFR();
    updateOpr({
      ...signModalOpr,
      status: 'signed',
      conducteur: signConducteurName.trim(),
      maireOuvrage: signMoName.trim(),
      signedBy: signConducteurName.trim(),
      signedAt: now,
      conducteurSignature: conducteurSig,
      moSignature: moSig,
    });
    setSignModalOpr(null);
  }

  function isOverdue(deadline: string): boolean {
    if (!deadline) return false;
    const parts = deadline.split('/');
    if (parts.length !== 3) return false;
    const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    return d < new Date();
  }

  function toggleItemExpand(opr: Opr, itemId: string) {
    if (expandedItemId === itemId) { setExpandedItemId(null); return; }
    const item = opr.items.find(i => i.id === itemId);
    setItemEdits(prev => ({
      ...prev,
      [itemId]: { entreprise: item?.entreprise ?? '', deadline: item?.deadline ?? '', note: item?.note ?? '' },
    }));
    setExpandedItemId(itemId);
  }

  function saveItemDetail(opr: Opr, itemId: string) {
    const edit = itemEdits[itemId];
    if (!edit) return;
    const updated = opr.items.map(item =>
      item.id === itemId
        ? { ...item, entreprise: edit.entreprise.trim() || undefined, deadline: edit.deadline.trim() || undefined, note: edit.note.trim() || undefined }
        : item
    );
    updateOpr({ ...opr, items: updated });
    setExpandedItemId(null);
  }

  function verifyLevee(opr: Opr, itemId: string) {
    const now = nowTimestampFR();
    const updated = opr.items.map(item =>
      item.id === itemId ? { ...item, verifiedAt: now, verifiedBy: user?.name ?? t('oprScreen.constructionManager') } : item
    );
    updateOpr({ ...opr, items: updated });
    Alert.alert(t('oprScreen.closureVerifiedTitle'), t('oprScreen.closureVerifiedText'));
  }

  const STATUS_CFG: Record<OprStatus, { label: string; color: string }> = {
    draft: { label: t('oprScreen.status.draft'), color: C.textMuted },
    in_progress: { label: t('oprScreen.status.inProgress'), color: C.inProgress },
    signed: { label: t('oprScreen.status.signed'), color: C.closed },
  };

  return (
    <View style={styles.container}>
      <Header
        title={t('oprScreen.headerTitle')}
        subtitle={t('oprScreen.headerSubtitle', { count: chantierOprs.length })}
        showBack
        rightIcon={permissions.canCreate ? 'add-circle-outline' : undefined}
        onRightPress={permissions.canCreate ? () => setShowNew(v => !v) : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {showNew && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{t('oprScreen.newPv')}</Text>

            <Text style={styles.label}>{t('oprScreen.titleLabel')}</Text>
            <TextInput
              style={[styles.input, !title.trim() && styles.inputError]}
              placeholder={t('oprScreen.titlePlaceholder')}
              placeholderTextColor={C.textMuted}
              value={title}
              onChangeText={setTitle}
              autoCapitalize="words"
              returnKeyType="next"
              accessibilityLabel={t('oprScreen.titleAccessibility')}
            />

            <Text style={styles.label}>{t('oprScreen.owner')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('oprScreen.ownerPlaceholder')}
              placeholderTextColor={C.textMuted}
              value={maireOuvrage}
              onChangeText={setMaireOuvrage}
              autoCapitalize="words"
              returnKeyType="done"
              accessibilityLabel={t('oprScreen.ownerPlaceholder')}
            />

            <Text style={styles.label}>{t('oprScreen.location')}</Text>
            <LocationPicker
              buildings={activeChantier?.buildings ?? []}
              building={building}
              level={level}
              zone={zone}
              onBuildingChange={setBuilding}
              onLevelChange={setLevel}
              onZoneChange={setZone}
            />

            <View style={{ marginTop: 4, marginBottom: 2 }}>
              <DateInput label={t('oprScreen.receptionDate')} value={date} onChange={setDate} />
            </View>

            <View style={{ marginTop: 4 }}>
              <DateInput label={t('oprScreen.contradictoryVisitDate')} value={visitDateForm} onChange={setVisitDateForm} optional />
            </View>

            <TouchableOpacity
              style={styles.lotsToggle}
              onPress={() => setShowLotsConfig(v => !v)}
              accessibilityRole="button"
              accessibilityLabel={t('oprScreen.lotsAccessibility', { count: formLots.filter(l => l.name.trim()).length, action: showLotsConfig ? t('oprScreen.hide') : t('oprScreen.configure') })}
              accessibilityState={{ expanded: showLotsConfig }}
            >
              <Ionicons name="list-outline" size={14} color={C.primary} />
              <Text style={styles.lotsToggleText}>
                {t('oprScreen.tradesWithCount', { count: formLots.filter(l => l.name.trim()).length })}
              </Text>
              <Ionicons name={showLotsConfig ? 'chevron-up' : 'chevron-down'} size={14} color={C.primary} />
            </TouchableOpacity>

            {showLotsConfig && (
              <View style={styles.lotsConfig}>
                {formLots.map(lot => (
                  <View key={lot.id} style={styles.lotConfigRow}>
                    <View style={{ flex: 1, gap: 5 }}>
                      <TextInput
                        style={styles.lotNameInput}
                        value={lot.name}
                        onChangeText={v => setFormLots(prev => prev.map(l => l.id === lot.id ? { ...l, name: v } : l))}
                        placeholder={t('oprScreen.lotNamePlaceholder')}
                        placeholderTextColor={C.textMuted}
                        accessibilityLabel={t('oprScreen.lotNameAccessibility', { lot: lot.name || t('oprScreen.untitled') })}
                        returnKeyType="next"
                      />
                      <TextInput
                        style={styles.lotEntrepriseInput}
                        value={lot.entreprise}
                        onChangeText={v => setFormLots(prev => prev.map(l => l.id === lot.id ? { ...l, entreprise: v } : l))}
                        placeholder={t('oprScreen.responsibleCompanyPlaceholder')}
                        placeholderTextColor={C.textMuted}
                        accessibilityLabel={t('oprScreen.responsibleCompanyAccessibility', { lot: lot.name || t('oprScreen.untitled') })}
                        returnKeyType="done"
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() => setFormLots(prev => prev.filter(l => l.id !== lot.id))}
                      hitSlop={8} style={{ padding: 4 }}
                      accessibilityLabel={t('oprScreen.deleteLotAccessibility', { lot: lot.name || t('oprScreen.untitled') })}
                      accessibilityRole="button"
                    >
                      <Ionicons name="close-circle" size={18} color={C.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.addLotRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    value={newLotName}
                    onChangeText={setNewLotName}
                    placeholder={t('oprScreen.addLotPlaceholder')}
                    placeholderTextColor={C.textMuted}
                    returnKeyType="done"
                    accessibilityLabel={t('oprScreen.newLotAccessibility')}
                    onSubmitEditing={() => {
                      if (!newLotName.trim()) return;
                      setFormLots(prev => [...prev, { id: genId(), name: newLotName.trim(), entreprise: '' }]);
                      setNewLotName('');
                    }}
                  />
                  <TouchableOpacity
                    style={styles.addLotBtn}
                    onPress={() => {
                      if (!newLotName.trim()) return;
                      setFormLots(prev => [...prev, { id: genId(), name: newLotName.trim(), entreprise: '' }]);
                      setNewLotName('');
                    }}
                    accessibilityLabel={t('oprScreen.addThisLot')}
                    accessibilityRole="button"
                  >
                    <Ionicons name="add" size={18} color={C.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.formActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowNew(false)}
                accessibilityLabel={t('oprScreen.cancelPvCreation')}
                accessibilityRole="button"
              >
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, !title.trim() && { opacity: 0.45 }]}
                onPress={createOpr}
                accessibilityLabel={t('oprScreen.createPvAccessibility')}
                accessibilityRole="button"
                accessibilityState={{ disabled: !title.trim() }}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.createBtnText}>{t('oprScreen.createPv')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {chantierOprs.length === 0 && !showNew ? (
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyTitle}>{t('oprScreen.noPv')}</Text>
            <Text style={styles.emptyText}>{t('oprScreen.noPvHint')}</Text>
            {permissions.canCreate && (
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => setShowNew(true)}
                accessibilityLabel={t('oprScreen.createNewPv')}
                accessibilityRole="button"
              >
                <Text style={styles.emptyBtnText}>{t('oprScreen.createPv')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          chantierOprs.map(opr => {
            const cfg = STATUS_CFG[opr.status];
            const countOk = opr.items.filter(i => i.status === 'ok').length;
            const countRes = opr.items.filter(i => i.status === 'reserve').length;
            const reserveItems = opr.items.filter(i => i.status === 'reserve');
            const leveedCount = reserveItems.filter(i => {
              const r = i.reserveId ? reserves.find(r2 => r2.id === i.reserveId) : undefined;
              return r?.status === 'closed';
            }).length;
            const pctLevee = countRes > 0 ? Math.round((leveedCount / countRes) * 100) : 0;
            const allVerified = reserveItems.length === 0 || reserveItems.every(i => !!i.verifiedAt);
            const phaseStep = opr.status === 'signed' ? 4 : allVerified && reserveItems.length === 0 ? 1 : opr.visitContradictoire && allVerified ? 3 : opr.visitContradictoire ? 2 : 1;
            return (
              <View key={opr.id} style={styles.oprCard}>
                <View style={styles.oprHeader}>
                  <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
                    <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                  <Text style={styles.oprDate}>{opr.date}</Text>
                </View>

                <View style={styles.phaseStepper}>
                  {([
                    t('oprScreen.phase.creation'),
                    t('oprScreen.phase.visit'),
                    t('oprScreen.phase.closure'),
                    t('oprScreen.phase.signed'),
                  ] as const).map((label, idx) => {
                    const stepNum = idx + 1;
                    const done = stepNum < phaseStep;
                    const active = stepNum === phaseStep;
                    return (
                      <View key={label} style={styles.phaseStepWrapper}>
                        {idx > 0 && <View style={[styles.phaseConnector, done && styles.phaseConnectorDone]} />}
                        <View style={[
                          styles.phaseStepDot,
                          done && styles.phaseStepDotDone,
                          active && styles.phaseStepDotActive,
                        ]}>
                          {done
                            ? <Ionicons name="checkmark" size={10} color="#fff" />
                            : <Text style={[styles.phaseStepNum, active && { color: '#fff' }]}>{stepNum}</Text>
                          }
                        </View>
                        <Text style={[
                          styles.phaseStepLabel,
                          done && { color: C.closed },
                          active && { color: C.primary, fontFamily: 'Inter_600SemiBold' },
                        ]}>{label}</Text>
                      </View>
                    );
                  })}
                </View>

                <Text style={styles.oprTitle}>{opr.title}</Text>
                <Text style={styles.oprMeta}>{[opr.building, opr.level, opr.zone].filter(Boolean).join(' — ')}{(opr.building || opr.level || opr.zone) ? ' · ' : ''}{opr.conducteur}</Text>
                {opr.maireOuvrage ? (
                  <Text style={styles.oprMeta}>MO : {opr.maireOuvrage}</Text>
                ) : null}
                {opr.visitContradictoire ? (
                  <View>
                    <View style={styles.visiteMeta}>
                      <Ionicons name="calendar-outline" size={12} color={C.verification} />
                      {editingVisitOprId === opr.id ? (
                        <View style={{ flex: 1 }}>
                          <DateInput value={editingVisitDate} onChange={setEditingVisitDate} />
                          <View style={styles.visitDateEditRow}>
                            <TouchableOpacity
                              style={styles.visitDateSaveBtn}
                              onPress={() => {
                                const trimmed = editingVisitDate.trim();
                                if (trimmed) updateOpr({ ...opr, visitContradictoire: trimmed });
                                setEditingVisitOprId(null);
                              }}
                              accessibilityLabel={t('oprScreen.confirmVisitDate')}
                              accessibilityRole="button"
                            >
                              <Ionicons name="checkmark" size={13} color="#fff" />
                              <Text style={styles.visitDateSaveBtnText}>{t('oprScreen.confirm')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => setEditingVisitOprId(null)}
                              hitSlop={8}
                              accessibilityLabel={t('oprScreen.cancelVisitDateChange')}
                              accessibilityRole="button"
                            >
                              <Ionicons name="close" size={14} color={C.textMuted} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                            onPress={() => setExpandedParticipantsOpr(p => p === opr.id ? null : opr.id)}
                            accessibilityRole="button"
                            accessibilityLabel={t('oprScreen.contradictoryVisitA11y', {
                              date: opr.visitContradictoire,
                              action: expandedParticipantsOpr === opr.id ? t('oprScreen.hide') : t('oprScreen.show'),
                            })}
                            accessibilityState={{ expanded: expandedParticipantsOpr === opr.id }}
                          >
                            <Text style={styles.visiteMetaText}>{t('oprScreen.visitPrefix', { date: opr.visitContradictoire })}</Text>
                            <Text style={styles.participantsCountText}>
                              {(opr.visitParticipants ?? []).length > 0
                                ? t('oprScreen.participantsCount', { count: (opr.visitParticipants ?? []).length })
                                : t('oprScreen.addParticipants')}
                            </Text>
                            <Ionicons name={expandedParticipantsOpr === opr.id ? 'chevron-up' : 'chevron-down'} size={11} color={C.verification} />
                          </TouchableOpacity>
                          {permissions.canEdit && opr.status !== 'signed' && (
                            <TouchableOpacity
                              onPress={() => { setEditingVisitDate(opr.visitContradictoire ?? ''); setEditingVisitOprId(opr.id); }}
                              hitSlop={8}
                              style={{ paddingLeft: 4 }}
                              accessibilityLabel={t('oprScreen.editVisitDate')}
                              accessibilityRole="button"
                            >
                              <Ionicons name="pencil-outline" size={13} color={C.textMuted} />
                            </TouchableOpacity>
                          )}
                        </>
                      )}
                    </View>

                    {expandedParticipantsOpr === opr.id && (
                      <View style={styles.participantsPanel}>
                        {(opr.visitParticipants ?? []).length === 0 ? (
                          <Text style={styles.participantsEmpty}>{t('oprScreen.noParticipants')}</Text>
                        ) : (
                          (opr.visitParticipants ?? []).map(p => (
                            <View key={p.id} style={styles.participantRow}>
                              <TouchableOpacity
                                style={[styles.presenceBtn, p.present && styles.presenceBtnActive]}
                                onPress={() => toggleParticipantPresent(opr, p.id)}
                                accessibilityRole="checkbox"
                                accessibilityLabel={t('oprScreen.markParticipantA11y', {
                                  name: p.name,
                                  status: p.present ? t('oprScreen.absent').toLowerCase() : t('oprScreen.present').toLowerCase(),
                                })}
                                accessibilityState={{ checked: p.present }}
                              >
                                <Ionicons name={p.present ? 'checkmark' : 'close'} size={10} color={p.present ? '#fff' : C.textMuted} />
                              </TouchableOpacity>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.participantName}>{p.name}</Text>
                                {p.company ? <Text style={styles.participantCompany}>{p.company}</Text> : null}
                              </View>
                              <Text style={[styles.participantBadge, p.present ? styles.participantPresent : styles.participantAbsent]}>
                                {p.present ? t('oprScreen.present') : t('oprScreen.absent')}
                              </Text>
                              {permissions.canEdit && opr.status !== 'signed' && (
                                <TouchableOpacity
                                  onPress={() => removeParticipant(opr, p.id)}
                                  hitSlop={8}
                                  accessibilityLabel={`Retirer ${p.name} des participants`}
                                  accessibilityRole="button"
                                >
                                  <Ionicons name="close" size={13} color={C.textMuted} />
                                </TouchableOpacity>
                              )}
                            </View>
                          ))
                        )}
                        {permissions.canEdit && opr.status !== 'signed' && (
                          <View style={styles.addParticipantRow}>
                            <TextInput
                              style={[styles.detailInput, { flex: 1 }]}
                              placeholder={t('oprScreen.participantNamePlaceholder')}
                              placeholderTextColor={C.textMuted}
                              value={newParticipantName}
                              onChangeText={setNewParticipantName}
                              returnKeyType="next"
                              accessibilityLabel={t('oprScreen.participantNameA11y')}
                            />
                            <TextInput
                              style={[styles.detailInput, { flex: 1 }]}
                              placeholder={t('oprScreen.participantCompanyPlaceholder')}
                              placeholderTextColor={C.textMuted}
                              value={newParticipantCompany}
                              onChangeText={setNewParticipantCompany}
                              returnKeyType="done"
                              onSubmitEditing={() => addParticipant(opr)}
                              accessibilityLabel={t('oprScreen.participantCompanyA11y')}
                            />
                            <TouchableOpacity
                              style={styles.addParticipantBtn}
                              onPress={() => addParticipant(opr)}
                              accessibilityLabel={t('oprScreen.addParticipantA11y')}
                              accessibilityRole="button"
                            >
                              <Ionicons name="person-add-outline" size={16} color={C.primary} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                ) : permissions.canEdit && opr.status !== 'signed' ? (
                  <View style={{ marginBottom: 2 }}>
                    {editingVisitOprId === opr.id ? (
                      <View style={{ marginBottom: 4 }}>
                        <DateInput value={editingVisitDate} onChange={setEditingVisitDate} />
                        <View style={styles.visitDateEditRow}>
                          <TouchableOpacity
                            style={styles.visitDateSaveBtn}
                            onPress={() => {
                              const trimmed = editingVisitDate.trim();
                              if (trimmed) updateOpr({ ...opr, visitContradictoire: trimmed });
                              setEditingVisitOprId(null);
                            }}
                            accessibilityLabel={t('oprScreen.confirmVisitDate')}
                            accessibilityRole="button"
                          >
                            <Ionicons name="checkmark" size={13} color="#fff" />
                            <Text style={styles.visitDateSaveBtnText}>{t('oprScreen.confirm')}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => setEditingVisitOprId(null)}
                            hitSlop={8}
                            accessibilityLabel={t('oprScreen.cancelVisitDateChange')}
                            accessibilityRole="button"
                          >
                            <Ionicons name="close" size={14} color={C.textMuted} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.planifierVisiteBtn}
                        onPress={() => { setEditingVisitDate(''); setEditingVisitOprId(opr.id); }}
                        accessibilityLabel={t('oprScreen.planVisit')}
                        accessibilityRole="button"
                      >
                        <Ionicons name="calendar-outline" size={12} color={C.verification} />
                        <Text style={styles.planifierVisiteText}>{t('oprScreen.planVisit')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}

                <View style={styles.oprStats}>
                  <View style={styles.oprStat}>
                    <Ionicons name="checkmark-circle" size={13} color={C.closed} />
                    <Text style={[styles.oprStatText, { color: C.closed }]}>{t('oprScreen.compliantCount', { count: countOk })}</Text>
                  </View>
                  <View style={styles.oprStat}>
                    <Ionicons name="warning" size={13} color={C.open} />
                    <Text style={[styles.oprStatText, { color: C.open }]}>{t('oprScreen.reserveCount', { count: countRes })}</Text>
                  </View>
                  <Text style={styles.oprStatSep}>·</Text>
                  <Text style={styles.oprStatText}>{t('oprScreen.pointsCount', { count: opr.items.length })}</Text>
                </View>

                <View style={styles.itemsList}>
                  {opr.items.map(item => {
                    const icfg = ITEM_STATUS_CFG[item.status];
                    const isExpanded = expandedItemId === item.id;
                    const edit = itemEdits[item.id] ?? { entreprise: item.entreprise ?? '', deadline: item.deadline ?? '', note: item.note ?? '' };
                    const linkedReserve = item.reserveId ? reserves.find(r => r.id === item.reserveId) : undefined;
                    const isLevee = linkedReserve?.status === 'closed';
                    const overdue = item.deadline ? isOverdue(item.deadline) : false;
                    return (
                      <View key={item.id}>
                        <View style={[styles.itemRow, item.status === 'reserve' && overdue && !isLevee && styles.itemRowOverdue]}>
                          <TouchableOpacity
                            style={{ flex: 1 }}
                            onPress={item.status === 'reserve' ? () => toggleItemExpand(opr, item.id) : undefined}
                            activeOpacity={item.status === 'reserve' ? 0.7 : 1}
                            accessibilityRole={item.status === 'reserve' ? 'button' : undefined}
                            accessibilityLabel={item.status === 'reserve' ? t('oprScreen.itemDetailA11y', {
                              lot: item.lotName,
                              action: isExpanded ? t('oprScreen.collapse') : t('oprScreen.expand'),
                            }) : undefined}
                            accessibilityState={item.status === 'reserve' ? { expanded: isExpanded } : undefined}
                          >
                            <Text style={styles.itemText}>{item.lotName}</Text>
                            {item.status === 'reserve' && (item.entreprise || item.deadline || item.verifiedAt) && (
                              <View style={styles.itemSubRow}>
                                {item.entreprise ? <Text style={styles.itemSubText}>{item.entreprise}</Text> : null}
                                {item.deadline ? (
                                  <Text style={[styles.itemSubText, overdue && !isLevee && { color: C.open }]}>
                                    {overdue && !isLevee ? '⚠ ' : ''}{item.deadline}
                                  </Text>
                                ) : null}
                                {item.verifiedAt ? <Text style={[styles.itemSubText, { color: C.closed }]}>✓ {t('oprScreen.verified')}</Text> : null}
                              </View>
                            )}
                          </TouchableOpacity>

                          {opr.status !== 'signed' && permissions.canEdit ? (
                            <View style={styles.statusBtnGroup}>
                              {(['ok', 'reserve', 'non_applicable'] as const).map(s => {
                                const cfg = ITEM_STATUS_CFG[s];
                                const active = item.status === s;
                                return (
                                  <TouchableOpacity
                                    key={s}
                                    style={[styles.statusBtn, active && { backgroundColor: cfg.color + '25', borderColor: cfg.color }]}
                                    onPress={() => setItemStatus(opr, item.id, s)}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('oprScreen.itemStatusAccessibility', { status: t(cfg.labelKey), lot: item.lotName })}
                                    accessibilityState={{ selected: active }}
                                  >
                                    <Ionicons name={cfg.icon as any} size={14} color={active ? cfg.color : C.textMuted} />
                                  </TouchableOpacity>
                                );
                              })}
                              {item.status === 'reserve' && (
                                <TouchableOpacity
                                  onPress={() => toggleItemExpand(opr, item.id)}
                                  hitSlop={8}
                                  style={{ paddingLeft: 4 }}
                                  accessibilityLabel={t('oprScreen.itemDetailA11y', {
                                    lot: item.lotName,
                                    action: isExpanded ? t('oprScreen.collapse') : t('oprScreen.expand'),
                                  })}
                                  accessibilityRole="button"
                                  accessibilityState={{ expanded: isExpanded }}
                                >
                                  <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.textMuted} />
                                </TouchableOpacity>
                              )}
                            </View>
                          ) : (
                            <Ionicons name={icfg.icon as any} size={16} color={icfg.color} />
                          )}
                        </View>

                        {isExpanded && item.status === 'reserve' && opr.status !== 'signed' && (
                          <View style={styles.itemDetailPanel}>
                            <Text style={styles.detailPanelTitle}>{t('oprScreen.detailForLot', { lot: item.lotName })}</Text>

                            <Text style={styles.detailLabel}>{t('oprScreen.responsibleCompanyUpper')}</Text>
                            <TextInput
                              style={styles.detailInput}
                              placeholder={t('oprScreen.companyNamePlaceholder')}
                              placeholderTextColor={C.textMuted}
                              value={edit.entreprise}
                              onChangeText={v => setItemEdits(prev => ({ ...prev, [item.id]: { ...edit, entreprise: v } }))}
                              accessibilityLabel={t('oprScreen.responsibleCompanyForLot', { lot: item.lotName })}
                              returnKeyType="next"
                            />

                            <Text style={styles.detailLabel}>{t('oprScreen.liftingDeadlineUpper')}</Text>
                            <DateInput
                              value={edit.deadline}
                              onChange={v => setItemEdits(prev => ({ ...prev, [item.id]: { ...edit, deadline: v } }))}
                              optional
                            />

                            <Text style={styles.detailLabel}>{t('oprScreen.observationNoteUpper')}</Text>
                            <TextInput
                              style={[styles.detailInput, { minHeight: 60, textAlignVertical: 'top' }]}
                              placeholder={t('oprScreen.observationPlaceholder')}
                              placeholderTextColor={C.textMuted}
                              value={edit.note}
                              onChangeText={v => setItemEdits(prev => ({ ...prev, [item.id]: { ...edit, note: v } }))}
                              multiline
                              accessibilityLabel={t('oprScreen.observationForLot', { lot: item.lotName })}
                            />

                            <Text style={styles.detailLabel}>{t('oprScreen.linkedReserveUpper')}</Text>
                            {item.reserveId ? (
                              <View style={styles.linkedReserveRow}>
                                <Ionicons name="link" size={13} color={C.primary} />
                                <Text style={styles.linkedReserveText} numberOfLines={1}>
                                  {reserves.find(r => r.id === item.reserveId)?.title ?? item.reserveId}
                                </Text>
                                <TouchableOpacity
                                  onPress={() => {
                                    const updated = opr.items.map(i => i.id === item.id ? { ...i, reserveId: undefined } : i);
                                    updateOpr({ ...opr, items: updated });
                                  }}
                                  hitSlop={8}
                                  accessibilityLabel={t('oprScreen.unlinkReserveA11y', { lot: item.lotName })}
                                  accessibilityRole="button"
                                >
                                  <Ionicons name="close-circle" size={15} color={C.textMuted} />
                                </TouchableOpacity>
                              </View>
                            ) : (
                              <TouchableOpacity
                                style={styles.linkReserveBtn}
                                onPress={() => setLinkReserveModal({ opr, itemId: item.id })}
                                accessibilityLabel={t('oprScreen.linkExistingReserveA11y', { lot: item.lotName })}
                                accessibilityRole="button"
                              >
                                <Ionicons name="link-outline" size={13} color={C.primary} />
                                <Text style={styles.linkReserveBtnText}>{t('oprScreen.linkExistingReserve')}</Text>
                              </TouchableOpacity>
                            )}

                            <View style={styles.detailActions}>
                              {isLevee && !item.verifiedAt && (
                                <TouchableOpacity
                                  style={styles.verifyBtn}
                                  onPress={() => verifyLevee(opr, item.id)}
                                  accessibilityLabel={t('oprScreen.confirmClosureA11y', { lot: item.lotName })}
                                  accessibilityRole="button"
                                >
                                  <Ionicons name="checkmark-circle-outline" size={14} color={C.closed} />
                                  <Text style={styles.verifyBtnText}>{t('oprScreen.verifyClosure')}</Text>
                                </TouchableOpacity>
                              )}
                              {item.verifiedAt && (
                                <View style={styles.verifiedBadge}>
                                  <Ionicons name="checkmark-circle" size={14} color={C.closed} />
                                  <Text style={styles.verifiedBadgeText}>{t('oprScreen.verifiedAt', { date: item.verifiedAt })}</Text>
                                </View>
                              )}
                              <TouchableOpacity
                                style={styles.detailSaveBtn}
                                onPress={() => saveItemDetail(opr, item.id)}
                                accessibilityLabel={t('oprScreen.saveLotDetailsA11y', { lot: item.lotName })}
                                accessibilityRole="button"
                              >
                                <Ionicons name="save-outline" size={14} color="#fff" />
                                <Text style={styles.detailSaveBtnText}>{t('common.save')}</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>

                {countRes > 0 && (
                  <View style={styles.suiviSection}>
                    <View style={styles.suiviHeader}>
                      <Ionicons name="timer-outline" size={13} color={C.textSub} />
                      <Text style={styles.suiviTitle}>{t('oprScreen.closureFollowUp')}</Text>
                      <Text style={styles.suiviProgress}>{t('oprScreen.closureProgress', { closed: leveedCount, total: countRes })}</Text>
                    </View>
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${pctLevee}%` as any }]} />
                    </View>
                    {reserveItems.map(item => {
                      const r = item.reserveId ? reserves.find(r2 => r2.id === item.reserveId) : undefined;
                      const isLev = r?.status === 'closed';
                      const isVer = !!item.verifiedAt;
                      const over = item.deadline ? isOverdue(item.deadline) : false;
                      return (
                        <View key={item.id} style={[styles.suiviRow, over && !isLev && styles.suiviRowOverdue]}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.suiviLot}>{item.lotName}</Text>
                            {item.entreprise ? <Text style={styles.suiviEntreprise}>{item.entreprise}</Text> : null}
                          </View>
                          {item.deadline ? (
                            <Text style={[styles.suiviDeadline, over && !isLev && { color: C.open, fontFamily: 'Inter_600SemiBold' }]}>
                              {over && !isLev ? '⚠ ' : ''}{item.deadline}
                            </Text>
                          ) : null}
                          <View style={[
                            styles.suiviBadge,
                            isVer ? styles.suiviBadgeVerified :
                            isLev ? styles.suiviBadgeLevee :
                            over ? styles.suiviBadgeOverdue :
                            styles.suiviBadgePending,
                          ]}>
                            <Text style={[
                              styles.suiviBadgeText,
                              isVer ? { color: C.closed } :
                              isLev ? { color: C.closed } :
                              over ? { color: C.open } :
                              { color: C.textMuted },
                            ]}>
                              {isVer ? `✓ ${t('oprScreen.verified')}` : isLev ? t('oprScreen.phase.closure') : over ? t('oprScreen.overdue') : t('oprScreen.waiting')}
                            </Text>
                          </View>
                          {isLev && !isVer && permissions.canEdit && opr.status !== 'signed' && (
                            <TouchableOpacity
                              onPress={() => verifyLevee(opr, item.id)}
                              hitSlop={8}
                              style={{ marginLeft: 4 }}
                              accessibilityLabel={t('oprScreen.confirmClosureA11y', { lot: item.lotName })}
                              accessibilityRole="button"
                            >
                              <Ionicons name="checkmark-circle-outline" size={16} color={C.closed} />
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                <View style={styles.oprActions}>
                  {permissions.canExport && (
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => exportOprPDF(opr)}
                      accessibilityLabel={t('oprScreen.exportReceptionPdf')}
                      accessibilityRole="button"
                    >
                      <Ionicons name="download-outline" size={14} color={C.primary} />
                      <Text style={[styles.actionBtnText, { color: C.primary }]}>{t('oprScreen.receptionPdfShort')}</Text>
                    </TouchableOpacity>
                  )}
                  {permissions.canExport && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: C.waiting + '40', backgroundColor: C.waitingBg }]}
                      onPress={() => exportConvocationPDF(opr)}
                      accessibilityLabel={t('oprScreen.exportConvocationPdf')}
                      accessibilityRole="button"
                    >
                      <Ionicons name="mail-outline" size={14} color={C.waiting} />
                      <Text style={[styles.actionBtnText, { color: C.waiting }]}>{t('oprScreen.convocation')}</Text>
                    </TouchableOpacity>
                  )}
                  {permissions.canExport && opr.items.some(i => i.status === 'reserve') && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: C.closed + '40', backgroundColor: C.closedBg }]}
                      onPress={() => exportLeveePDF(opr)}
                      accessibilityLabel={t('oprScreen.exportClosurePdf')}
                      accessibilityRole="button"
                    >
                      <Ionicons name="checkmark-done-outline" size={14} color={C.closed} />
                      <Text style={[styles.actionBtnText, { color: C.closed }]}>{t('oprScreen.closurePdfShort')}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: C.verification + '20', backgroundColor: C.verificationBg }]}
                    onPress={() => shareOprLink(opr)}
                    accessibilityLabel={t('oprScreen.copySessionLink')}
                    accessibilityRole="button"
                  >
                    <Ionicons name="link-outline" size={14} color={C.verification} />
                    <Text style={[styles.actionBtnText, { color: C.verification }]}>{t('oprScreen.sessionLinkShort')}</Text>
                  </TouchableOpacity>
                  {permissions.canEdit && opr.status !== 'signed' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.signBtn]}
                      onPress={() => openSignModal(opr)}
                      accessibilityLabel={t('oprScreen.signPvA11y')}
                      accessibilityRole="button"
                    >
                      <Ionicons name="create-outline" size={14} color={C.closed} />
                      <Text style={[styles.actionBtnText, { color: C.closed }]}>{t('oprScreen.signPv')}</Text>
                    </TouchableOpacity>
                  )}
                  {opr.status === 'signed' && (
                    <View style={styles.signedBadge}>
                      <Ionicons name="checkmark-circle" size={14} color={C.closed} />
                      <Text style={styles.signedText}>{t('oprScreen.pvSignedAt', { date: formatDate(opr.signedAt ?? '') })}</Text>
                    </View>
                  )}
                  {permissions.canDelete && (
                    <TouchableOpacity
                      onPress={() => Alert.alert(t('oprScreen.deletePvTitle'), t('oprScreen.deletePvText', { title: opr.title }), [
                        { text: t('common.cancel'), style: 'cancel' },
                        { text: t('common.delete'), style: 'destructive', onPress: () => deleteOpr(opr.id) },
                      ])}
                      hitSlop={8}
                      accessibilityLabel={t('oprScreen.deletePvA11y', { title: opr.title })}
                      accessibilityRole="button"
                    >
                      <Ionicons name="trash-outline" size={15} color={C.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.signatoryPanel}>
                  <View style={styles.signatoryHeader}>
                    <Ionicons name="people-outline" size={13} color={C.textSub} />
                    <Text style={styles.signatoryTitle}>{t('oprScreen.collaborativeSignatories')}</Text>
                    {permissions.canEdit && opr.status !== 'signed' && (
                      <TouchableOpacity
                        style={styles.inviteBtn}
                        onPress={() => setInviteModal({ opr })}
                        accessibilityLabel={t('oprScreen.inviteSignatoryA11y')}
                        accessibilityRole="button"
                      >
                        <Ionicons name="person-add-outline" size={12} color={C.primary} />
                        <Text style={styles.inviteBtnText}>{t('oprScreen.invite')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {(opr.signatories ?? []).length === 0 ? (
                    <Text style={styles.signatoryEmpty}>{t('oprScreen.noSignatoryHint')}</Text>
                  ) : (
                    (opr.signatories ?? []).map(sig => (
                      <View key={sig.id} style={styles.signatoryRow}>
                        <View style={styles.signatoryAvatar}>
                          <Text style={styles.signatoryAvatarText}>{sig.name.slice(0, 1).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.signatoryName}>{sig.name}</Text>
                          <Text style={styles.signatoryRole} numberOfLines={1} ellipsizeMode="tail">{sig.role}{sig.email ? ' · ' + sig.email : ''}</Text>
                        </View>
                        {sig.signedAt ? (
                          <View style={styles.sigSignedBadge}>
                            <Ionicons name="checkmark-circle" size={12} color={C.closed} />
                            <Text style={styles.sigSignedText}>{formatDate(sig.signedAt)}</Text>
                          </View>
                        ) : (
                          <View style={styles.sigPendingBadge}>
                            <Text style={styles.sigPendingText}>{t('oprScreen.pending')}</Text>
                          </View>
                        )}
                        {permissions.canDelete && (
                          <TouchableOpacity
                            onPress={() => removeSignatory(opr, sig.id)}
                            hitSlop={8}
                            accessibilityLabel={t('oprScreen.removeSignatoryA11y', { name: sig.name })}
                            accessibilityRole="button"
                          >
                            <Ionicons name="close" size={14} color={C.textMuted} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <BottomNavBar />

      <Modal visible={inviteModal !== null} transparent animationType="slide" onRequestClose={() => setInviteModal(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.inviteOverlay}>
            <View style={styles.inviteSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.inviteTitle}>{t('oprScreen.inviteSignatoryTitle')}</Text>
              <Text style={styles.modalLabel}>{t('oprScreen.fullName')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('oprScreen.fullNamePlaceholder')}
                placeholderTextColor={C.textMuted}
                value={inviteName}
                onChangeText={setInviteName}
                autoFocus
                autoCapitalize="words"
                autoComplete="name"
                returnKeyType="next"
                accessibilityLabel={t('oprScreen.signatoryNameA11y')}
              />
              <Text style={styles.modalLabel}>{t('oprScreen.roleFunction')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('oprScreen.roleFunctionPlaceholder')}
                placeholderTextColor={C.textMuted}
                value={inviteRole}
                onChangeText={setInviteRole}
                returnKeyType="next"
                accessibilityLabel={t('oprScreen.roleFunctionA11y')}
              />
              <Text style={styles.modalLabel}>{t('oprScreen.emailOptional')}</Text>
              <TextInput
                style={styles.input}
                placeholder="prenom.nom@entreprise.fr"
                placeholderTextColor={C.textMuted}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                returnKeyType="done"
                textContentType="emailAddress"
                onSubmitEditing={addSignatory}
                accessibilityLabel={t('oprScreen.signatoryEmailA11y')}
              />
              <View style={styles.inviteActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { setInviteModal(null); setInviteName(''); setInviteRole(''); setInviteEmail(''); }}
                  accessibilityLabel={t('oprScreen.cancelInvitation')}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.createBtn, !inviteName.trim() && { opacity: 0.45 }]}
                  onPress={addSignatory}
                  disabled={!inviteName.trim()}
                  accessibilityLabel={t('oprScreen.addSignatory')}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !inviteName.trim() }}
                >
                  <Ionicons name="person-add-outline" size={15} color="#fff" />
                  <Text style={styles.createBtnText}>{t('oprScreen.add')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={linkReserveModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setLinkReserveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.inviteSheet, { maxHeight: '75%' }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.inviteTitle}>{t('oprScreen.linkExistingReserve')}</Text>
            <Text style={[styles.label, { marginBottom: 10 }]}>{t('oprScreen.selectReserveForLot')}</Text>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {chantierReserves.length === 0 ? (
                <Text style={styles.participantsEmpty}>{t('oprScreen.noReserveInProject')}</Text>
              ) : (
                chantierReserves.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.reservePickerRow}
                    onPress={() => linkReserveModal && linkReserveToItem(linkReserveModal.opr, linkReserveModal.itemId, r.id)}
                    accessibilityLabel={t('oprScreen.linkReserveA11y', {
                      title: r.title,
                      status: r.status === 'closed' ? t('oprScreen.phase.closure') : t('oprScreen.open'),
                    })}
                    accessibilityRole="button"
                  >
                    <View style={[styles.reservePickerDot, { backgroundColor: r.status === 'closed' ? C.closed : C.open }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reservePickerTitle}>{r.title}</Text>
                      <Text style={styles.reservePickerMeta}>{r.company}{(r.building || r.level) ? ` · ${[r.building, r.level].filter(Boolean).join(' ')}` : ''}</Text>
                    </View>
                    <View style={[styles.suiviBadge, r.status === 'closed' ? styles.suiviBadgeLevee : styles.suiviBadgePending]}>
                      <Text style={[styles.suiviBadgeText, { color: r.status === 'closed' ? C.closed : C.textMuted }]}>
                        {r.status === 'closed' ? t('oprScreen.phase.closure') : t('oprScreen.open')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <TouchableOpacity
              style={[styles.cancelBtn, { marginTop: 12 }]}
              onPress={() => setLinkReserveModal(null)}
              accessibilityLabel={t('oprScreen.closeReservePicker')}
              accessibilityRole="button"
            >
              <Text style={styles.cancelBtnText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={signModalOpr !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          const hasSig = !conducteurPadRef.current?.isEmpty() || !moPadRef.current?.isEmpty();
          if (hasSig) {
            Alert.alert(
              t('oprScreen.closeWithoutSavingTitle'),
              t('oprScreen.closeWithoutSavingText'),
              [
                { text: t('oprScreen.continueSignature'), style: 'cancel' },
                { text: t('oprScreen.closeAnyway'), style: 'destructive', onPress: () => setSignModalOpr(null) },
              ]
            );
          } else {
            setSignModalOpr(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <ScrollView
            style={styles.modalScrollWrap}
            contentContainerStyle={styles.modalSheet}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <Ionicons name="create-outline" size={20} color={C.primary} />
              <Text style={styles.modalTitle}>{t('oprScreen.pvSignatureTitle')}</Text>
            </View>

            {signModalOpr && (
              <View style={styles.modalPvInfo}>
                <Text style={styles.modalPvTitle}>{signModalOpr.title}</Text>
                <Text style={styles.modalPvMeta}>
                  {t('oprScreen.dateLabel')} : {signModalOpr.date}
                  {signModalOpr.building ? ` · ${[signModalOpr.building, signModalOpr.level].filter(Boolean).join(' — ')}` : ''}
                </Text>
              </View>
            )}

            <View style={styles.signStepRow}>
              <TouchableOpacity
                style={[styles.signStepTab, signStep === 'conducteur' && styles.signStepTabActive]}
                onPress={() => setSignStep('conducteur')}
                accessibilityRole="tab"
                accessibilityLabel={t('oprScreen.managerStepA11y')}
                accessibilityState={{ selected: signStep === 'conducteur' }}
              >
                <Ionicons name="person-outline" size={14} color={signStep === 'conducteur' ? C.primary : C.textMuted} />
                <Text style={[styles.signStepTabText, signStep === 'conducteur' && { color: C.primary }]}>{t('oprScreen.managerStep')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.signStepTab, signStep === 'mo' && styles.signStepTabActive]}
                onPress={() => setSignStep('mo')}
                accessibilityRole="tab"
                accessibilityLabel={t('oprScreen.ownerStepA11y')}
                accessibilityState={{ selected: signStep === 'mo' }}
              >
                <Ionicons name="business-outline" size={14} color={signStep === 'mo' ? C.primary : C.textMuted} />
                <Text style={[styles.signStepTabText, signStep === 'mo' && { color: C.primary }]}>{t('oprScreen.ownerStep')}</Text>
              </TouchableOpacity>
            </View>

            {signStep === 'conducteur' && (
              <View style={styles.signBlock}>
                <Text style={styles.modalLabel}>{t('oprScreen.managerNameUpper')}</Text>
                <View style={styles.signInputWrap}>
                  <Ionicons name="person-outline" size={15} color={C.textMuted} />
                  <TextInput
                    style={styles.signInput}
                    value={signConducteurName}
                    onChangeText={setSignConducteurName}
                    placeholder={t('oprScreen.fullNamePlaceholder')}
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="words"
                    returnKeyType="done"
                    accessibilityLabel={t('oprScreen.managerFullNameA11y')}
                  />
                </View>
                <Text style={styles.modalLabel}>{t('oprScreen.signatureDrawLabel')}</Text>
                <View style={styles.padContainer}>
                  <SignaturePad ref={conducteurPadRef} />
                  <TouchableOpacity
                    style={styles.clearPadBtn}
                    onPress={() => conducteurPadRef.current?.clear()}
                    accessibilityLabel={t('oprScreen.clearManagerSignatureA11y')}
                    accessibilityRole="button"
                  >
                    <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                    <Text style={styles.clearPadText}>{t('common.clear')}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.nextStepBtn}
                  onPress={() => {
                    if (!signConducteurName.trim()) {
                      Alert.alert(t('oprScreen.nameRequired'), t('oprScreen.fullNameRequiredBeforeContinue'));
                      return;
                    }
                    if (conducteurPadRef.current?.isEmpty()) {
                      Alert.alert(t('oprScreen.signatureRequiredTitle'), t('oprScreen.signatureRequiredBeforeNextStep'));
                      return;
                    }
                    setSignStep('mo');
                  }}
                  accessibilityLabel={t('oprScreen.goToOwnerStepA11y')}
                  accessibilityRole="button"
                >
                  <Text style={styles.nextStepBtnText}>{t('oprScreen.nextOwnerStep')}</Text>
                  <Ionicons name="arrow-forward" size={15} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            {signStep === 'mo' && (
              <View style={styles.signBlock}>
                <Text style={styles.modalLabel}>{t('oprScreen.ownerNameUpper')}</Text>
                <View style={styles.signInputWrap}>
                  <Ionicons name="business-outline" size={15} color={C.textMuted} />
                  <TextInput
                    style={styles.signInput}
                    value={signMoName}
                    onChangeText={setSignMoName}
                    placeholder={t('oprScreen.ownerNamePlaceholder')}
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="words"
                    returnKeyType="done"
                    accessibilityLabel={t('oprScreen.ownerNameA11y')}
                  />
                </View>
                <Text style={styles.modalLabel}>{t('oprScreen.signatureDrawLabel')}</Text>
                <View style={styles.padContainer}>
                  <SignaturePad ref={moPadRef} />
                  <TouchableOpacity
                    style={styles.clearPadBtn}
                    onPress={() => moPadRef.current?.clear()}
                    accessibilityLabel={t('oprScreen.clearOwnerSignatureA11y')}
                    accessibilityRole="button"
                  >
                    <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                    <Text style={styles.clearPadText}>{t('common.clear')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.signNotice}>
              <Ionicons name="shield-checkmark-outline" size={14} color={C.closed} />
              <Text style={styles.signNoticeText}>
                {t('oprScreen.signNotice')}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  const hasSig = !conducteurPadRef.current?.isEmpty() || !moPadRef.current?.isEmpty();
                  if (hasSig) {
                    Alert.alert(
                      t('oprScreen.cancelSignatureTitle'),
                      t('oprScreen.cancelSignatureText'),
                      [
                        { text: t('common.continue'), style: 'cancel' },
                        { text: t('oprScreen.cancelAnyway'), style: 'destructive', onPress: () => setSignModalOpr(null) },
                      ]
                    );
                  } else {
                    setSignModalOpr(null);
                  }
                }}
                accessibilityLabel={t('oprScreen.cancelPvSignatureA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={confirmSign}
                accessibilityLabel={t('oprScreen.validateSignaturesA11y')}
                accessibilityRole="button"
              >
                <Ionicons name="ribbon-outline" size={16} color="#fff" />
                <Text style={styles.modalConfirmText}>{t('oprScreen.validateSignatures')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 100 },

  formCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  formTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 12 },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, marginBottom: 10,
  },
  inputError: { borderColor: C.open },
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 4, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: C.border },
  chipActive: { borderColor: C.primary, backgroundColor: C.primary + '15' },
  chipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  chipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  createBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.primary, paddingVertical: 11, borderRadius: 10 },
  createBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', paddingHorizontal: 20 },
  emptyBtn: { marginTop: 8, backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 10 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  oprCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  oprHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  oprDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  oprTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  oprMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 2 },

  oprStats: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 10 },
  oprStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  oprStatText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  oprStatSep: { color: C.border, fontSize: 14 },

  itemsList: { gap: 1, marginBottom: 10, backgroundColor: C.bg, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  itemText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },

  oprActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  actionBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  signBtn: { borderColor: C.closed + '40', backgroundColor: C.closedBg },
  signedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  signedText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.closed },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', alignItems: 'center' },
  modalScrollWrap: { maxHeight: '92%', width: '100%', maxWidth: 640 },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },

  modalPvInfo: { backgroundColor: C.bg, borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  modalPvTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  modalPvMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },

  signStepRow: { flexDirection: 'row', gap: 8, marginBottom: 16, backgroundColor: C.bg, borderRadius: 12, padding: 4 },
  signStepTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9 },
  signStepTabActive: { backgroundColor: C.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  signStepTabText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textMuted },

  signBlock: { gap: 8, marginBottom: 12 },
  modalLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5 },
  signInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  signInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },

  padContainer: { alignItems: 'center', gap: 6, marginBottom: 4 },
  clearPadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearPadText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  nextStepBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, paddingVertical: 12, borderRadius: 10, marginTop: 4 },
  nextStepBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  signNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.closedBg, borderRadius: 10, padding: 12, marginVertical: 12 },
  signNoticeText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.closed, lineHeight: 18 },

  signatoryPanel: {
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border,
  },
  signatoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  signatoryTitle: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '30' },
  inviteBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  signatoryEmpty: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic', lineHeight: 16 },
  signatoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  signatoryAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.primary + '20', alignItems: 'center', justifyContent: 'center' },
  signatoryAvatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  signatoryName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  signatoryRole: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  sigSignedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.closedBg, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  sigSignedText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.closed },
  sigPendingBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: C.waitingBg },
  sigPendingText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.waiting },

  inviteOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', alignItems: 'center' },
  inviteSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, width: '100%', maxWidth: 640 },
  inviteTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 14 },
  inviteActions: { flexDirection: 'row', gap: 10, marginTop: 8 },

  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  modalCancelText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  modalConfirmBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, paddingVertical: 13, borderRadius: 12 },
  modalConfirmText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  phaseStepper: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 12, marginTop: 2,
  },
  phaseStepWrapper: { flexDirection: 'column', alignItems: 'center', gap: 3 },
  phaseConnector: { flex: 1, height: 2, backgroundColor: C.border, marginHorizontal: 2, marginBottom: 12 },
  phaseConnectorDone: { backgroundColor: C.closed },
  phaseStepDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: C.bg, borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  phaseStepDotDone: { backgroundColor: C.closed, borderColor: C.closed },
  phaseStepDotActive: { backgroundColor: C.primary, borderColor: C.primary },
  phaseStepNum: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.textMuted },
  phaseStepLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2, textAlign: 'center' },

  visiteMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  visiteMetaText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.verification },
  visitDateEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  visitDateInput: {
    flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.verification,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text,
  },
  visitDateSaveBtn: {
    backgroundColor: C.verification, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  visitDateSaveBtnText: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff',
  },
  planifierVisiteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: C.verification + '20', backgroundColor: C.verificationBg,
    alignSelf: 'flex-start', marginBottom: 2,
  },
  planifierVisiteText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.verification },

  itemRowOverdue: { backgroundColor: C.open + '12' },
  itemSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' },
  itemSubText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  itemDetailPanel: {
    backgroundColor: C.primaryBg, padding: 14, gap: 8,
    borderBottomWidth: 1, borderColor: C.border,
    borderLeftWidth: 3, borderLeftColor: C.primary,
  },
  detailPanelTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary, marginBottom: 4 },
  detailLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  detailInput: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text,
  },
  detailActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: C.closed + '50', backgroundColor: C.closedBg,
  },
  verifyBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.closed },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  verifiedBadgeText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.closed },
  detailSaveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
    backgroundColor: C.primary,
  },
  detailSaveBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  cycleBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  cycleBtnText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic' },

  suiviSection: {
    marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, gap: 6,
  },
  suiviHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  suiviTitle: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  suiviProgress: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  progressBarBg: { height: 5, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progressBarFill: { height: '100%', backgroundColor: C.closed, borderRadius: 3 },
  suiviRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 6, borderRadius: 7 },
  suiviRowOverdue: { backgroundColor: C.open + '12' },
  suiviLot: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text },
  suiviEntreprise: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  suiviDeadline: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, minWidth: 70, textAlign: 'right' },
  suiviBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  suiviBadgeVerified: { backgroundColor: C.closedBg },
  suiviBadgeLevee: { backgroundColor: C.closedBg },
  suiviBadgeOverdue: { backgroundColor: C.openBg },
  suiviBadgePending: { backgroundColor: C.bg },
  suiviBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  statusBtnGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusBtn: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.bg,
  },

  lotsToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.primary + '30',
    marginTop: 4, marginBottom: 8,
  },
  lotsToggleText: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  lotsConfig: {
    backgroundColor: C.bg, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.border, marginBottom: 10, gap: 8,
  },
  lotConfigRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  lotNameInput: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7,
    fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text,
  },
  lotEntrepriseInput: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6,
    fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub,
  },
  addLotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  addLotBtn: {
    width: 38, height: 38, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.primaryBg,
  },

  participantsCountText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.verification, marginLeft: 'auto' as any, marginRight: 4 },
  participantsPanel: {
    backgroundColor: C.verificationBg, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.verification + '40', gap: 8, marginTop: 4, marginBottom: 6,
  },
  participantsEmpty: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic', textAlign: 'center', paddingVertical: 4 },
  participantRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  presenceBtn: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.bg,
  },
  presenceBtnActive: { backgroundColor: C.closed, borderColor: C.closed },
  participantName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  participantCompany: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  participantBadge: { fontSize: 10, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  participantPresent: { backgroundColor: C.closedBg, color: C.closed },
  participantAbsent: { backgroundColor: C.openBg, color: C.open },
  addParticipantRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  addParticipantBtn: {
    width: 36, height: 36, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40',
  },

  linkedReserveRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.primaryBg, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: C.primary + '30',
  },
  linkedReserveText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  linkReserveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderStyle: 'dashed' as any,
    borderColor: C.primary + '50',
  },
  linkReserveBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },

  reservePickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  reservePickerDot: { width: 10, height: 10, borderRadius: 5 },
  reservePickerTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  reservePickerMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
});
