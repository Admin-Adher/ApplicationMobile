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
import { useRouter } from 'expo-router';
import { useState, useMemo, useRef } from 'react';
import { C } from '@/constants/colors';
import {
  exportPDF as exportPDFHelper,
  loadPhotoAsDataUrl,
  svgStringToDataUrl,
  buildLetterhead,
  buildInfoGrid,
  buildKpiRow,
  buildDocFooter,
  wrapHTML,
} from '@/lib/pdfBase';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { Opr, OprItem, OprSignatory, OprStatus, Reserve } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';
import SignaturePad, { SignaturePadRef } from '@/components/SignaturePad';
import { genId, formatDateFR } from '@/lib/utils';
import { RESERVE_BUILDINGS, RESERVE_LEVELS } from '@/lib/reserveUtils';

const ITEM_STATUS_CFG = {
  ok: { label: 'Conforme', color: C.closed, icon: 'checkmark-circle' },
  reserve: { label: 'Réserve', color: C.open, icon: 'warning' },
  non_applicable: { label: 'N/A', color: C.textMuted, icon: 'remove-circle-outline' },
};

const DEFAULT_OPR_ITEMS = [
  'Gros œuvre / Structure',
  'Couverture / Étanchéité',
  'Menuiseries extérieures',
  'Menuiseries intérieures',
  'Plâtrerie / Doublage',
  'Carrelage / Revêtements sol',
  'Peinture / Finitions',
  'Plomberie sanitaire',
  'Chauffage / VMC',
  'Électricité courants forts',
  'Courants faibles',
  'Espaces extérieurs',
];

function buildOprPDF(opr: Opr, projectName: string): string {
  const statusIcons: Record<string, string> = { ok: '✓', reserve: '⚠', non_applicable: '—' };
  const statusColors: Record<string, string> = { ok: '#059669', reserve: '#DC2626', non_applicable: '#6B7280' };
  const statusBg: Record<string, string> = { ok: '#ECFDF5', reserve: '#FEF2F2', non_applicable: '#F9FAFB' };

  const rows = opr.items.map((item, idx) =>
    `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:700">${item.lotName}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${item.entreprise ?? '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        <span style="background:${statusBg[item.status]};color:${statusColors[item.status]};font-weight:700;font-size:11px;padding:3px 10px;border-radius:12px">${statusIcons[item.status]} ${ITEM_STATUS_CFG[item.status].label}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;${item.status === 'reserve' && item.deadline ? 'color:#DC2626;font-weight:700' : 'color:#6B7280'}">${item.status === 'reserve' ? (item.deadline ?? '—') : '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#003082;font-weight:700">${item.status === 'reserve' ? (item.reserveId ?? '—') : '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${item.note ?? ''}</td>
    </tr>`
  ).join('');

  const totalOk = opr.items.filter(i => i.status === 'ok').length;
  const totalRes = opr.items.filter(i => i.status === 'reserve').length;
  const totalNA = opr.items.filter(i => i.status === 'non_applicable').length;
  const pctConformite = opr.items.length > 0 ? Math.round((totalOk / opr.items.length) * 100) : 0;
  const signedDate = opr.signedAt ?? opr.date;
  const today = formatDateFR(new Date());

  const sigBlockHtml = opr.status === 'signed'
    ? `<div class="section-header">Signatures électroniques</div>
       <div class="alert alert-success">✓ PV signé électroniquement le ${signedDate}</div>
       <div class="sig-row">
         <div class="sig-block">
           <div class="sig-label">Conducteur de travaux</div>
           ${opr.conducteurSignature
             ? `<img src="${svgStringToDataUrl(opr.conducteurSignature)}" style="width:100%;max-width:260px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
             : '<div class="sig-line"></div>'
           }
           <div class="sig-name">${opr.conducteur}</div>
           <div class="sig-date">Signé le ${signedDate}</div>
         </div>
         <div class="sig-block">
           <div class="sig-label">Maître d'ouvrage</div>
           ${opr.moSignature
             ? `<img src="${svgStringToDataUrl(opr.moSignature)}" style="width:100%;max-width:260px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
             : '<div class="sig-line"></div>'
           }
           <div class="sig-name">${opr.maireOuvrage ?? '—'}</div>
           <div class="sig-date">Signé le ${signedDate}</div>
         </div>
       </div>`
    : `<div class="section-header">Signatures</div>
       <div class="sig-row">
         <div class="sig-block">
           <div class="sig-label">Conducteur de travaux</div>
           <div class="sig-line"></div>
           <div class="sig-name">${opr.conducteur}</div>
           <div class="sig-date">Date : _______________</div>
         </div>
         <div class="sig-block">
           <div class="sig-label">Maître d'ouvrage</div>
           <div class="sig-line"></div>
           <div class="sig-name">${opr.maireOuvrage ?? ''}</div>
           <div class="sig-date">Date : _______________</div>
         </div>
       </div>`;

  const infoItems = [
    { label: 'Localisation', value: `Bât. ${opr.building} — ${opr.level}` },
    { label: 'Conducteur de travaux', value: opr.conducteur },
    ...(opr.maireOuvrage ? [{ label: "Maître d'ouvrage", value: opr.maireOuvrage }] : []),
    { label: 'Date de réception', value: opr.date },
    ...(opr.visitContradictoire ? [{ label: 'Visite contradictoire', value: opr.visitContradictoire }] : []),
  ];

  const participants = opr.visitParticipants ?? [];
  const participantsSection = participants.length > 0 ? `
    <div class="section-header">Participants à la visite contradictoire</div>
    <table>
      <thead>
        <tr>
          <th>NOM</th>
          <th>ENTREPRISE / FONCTION</th>
          <th style="text-align:center">PRÉSENCE</th>
        </tr>
      </thead>
      <tbody>
        ${participants.map((p, idx) => `
          <tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
            <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:700">${p.name}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${p.company || '—'}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
              <span style="background:${p.present ? '#ECFDF5' : '#FEF2F2'};color:${p.present ? '#059669' : '#DC2626'};font-weight:700;font-size:10px;padding:2px 8px;border-radius:10px">${p.present ? '✓ Présent' : '✗ Absent'}</span>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>` : '';

  const body = `
    ${buildLetterhead('Procès-verbal de réception', opr.title, opr.id, today, projectName)}
    ${buildInfoGrid(infoItems)}
    ${buildKpiRow([
      { val: totalOk, label: 'Conforme' + (totalOk > 1 ? 's' : ''), color: '#059669' },
      { val: totalRes, label: 'Réserve' + (totalRes > 1 ? 's' : ''), color: '#DC2626' },
      { val: totalNA, label: 'Non applicable', color: '#6B7280' },
      { val: `${pctConformite}%`, label: 'Conformité', color: '#003082' },
    ])}
    ${participantsSection}
    <div class="section-header">Détail par lot</div>
    <table>
      <thead>
        <tr>
          <th>LOT</th>
          <th>ENTREPRISE</th>
          <th style="text-align:center">STATUT</th>
          <th>DÉLAI LEVÉE</th>
          <th>N° RÉS.</th>
          <th>OBSERVATIONS</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="padding:14px;text-align:center;color:#059669">Aucun point de contrôle</td></tr>'}</tbody>
    </table>
    ${sigBlockHtml}
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, `PV de réception — ${opr.title}`);
}

async function buildPvLeveePDF(opr: Opr, reserves: Reserve[], projectName: string): Promise<string> {
  const dateShort = formatDateFR(new Date());
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
      if (!reserve?.photos?.length) return;
      const defectPhoto = reserve.photos.find(p => p.kind === 'defect');
      const resolutionPhoto = reserve.photos.find(p => p.kind === 'resolution');
      const [dSrc, rSrc] = await Promise.all([
        defectPhoto ? loadPhotoAsDataUrl(defectPhoto.uri) : Promise.resolve(''),
        resolutionPhoto ? loadPhotoAsDataUrl(resolutionPhoto.uri) : Promise.resolve(''),
      ]);
      photoData[reserve.id] = { defect: dSrc || undefined, resolution: rSrc || undefined };
    })
  );

  const rows = reserveItems.map((item, idx) => {
    const reserve = item.reserveId ? reserves.find(r => r.id === item.reserveId) : undefined;
    const isLevee = reserve?.status === 'closed';
    return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-weight:700;font-size:11px">${item.lotName}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#003082;font-weight:700">${item.reserveId ?? '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${item.description !== item.lotName ? item.description : (reserve?.title ?? '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        ${isLevee
          ? '<span style="background:#ECFDF5;color:#059669;font-weight:700;padding:3px 10px;border-radius:12px;font-size:10px">✓ Levée</span>'
          : '<span style="background:#FEF2F2;color:#DC2626;font-weight:700;padding:3px 10px;border-radius:12px;font-size:10px">⚠ En attente</span>'}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#059669">${reserve?.closedAt ?? '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${reserve?.closedBy ?? '—'}</td>
    </tr>`;
  }).join('');

  const leveedWithPhotos = leveed.filter(({ reserve }) => reserve && photoData[reserve.id] && (photoData[reserve.id].defect || photoData[reserve.id].resolution));
  const photoSection = leveedWithPhotos.length > 0 ? `
    <div class="section-header">Photographies — Avant / Après levée</div>
    ${leveedWithPhotos.map(({ item, reserve }) => {
      if (!reserve) return '';
      const photos = photoData[reserve.id];
      return `<div style="margin-bottom:20px;page-break-inside:avoid">
        <div style="font-size:11px;font-weight:700;color:#1A2742;margin-bottom:8px;background:#F4F7FB;padding:6px 10px;border-radius:6px">${item.lotName} — ${reserve.title}</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${photos.defect ? `<div style="text-align:center"><img src="${photos.defect}" style="width:200px;height:140px;object-fit:cover;border-radius:8px;border:2px solid #FCA5A5" /><div style="font-size:10px;color:#DC2626;font-weight:700;margin-top:4px">🔴 Constat initial</div></div>` : ''}
          ${photos.resolution ? `<div style="text-align:center"><img src="${photos.resolution}" style="width:200px;height:140px;object-fit:cover;border-radius:8px;border:2px solid #6EE7B7" /><div style="font-size:10px;color:#059669;font-weight:700;margin-top:4px">🟢 Levée constatée</div></div>` : ''}
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
      <div class="section-header">Certification de levée des réserves</div>
      <div class="alert alert-info" style="margin-bottom:20px">
        Les soussignés certifient avoir procédé à la vérification des réserves émises lors du procès-verbal de réception référencé <strong>${opr.id}</strong> et attestent que les réserves indiquées comme « Levée » ont été régulièrement exécutées et conformes aux prescriptions contractuelles.
      </div>
      <div class="sig-row">
        <div class="sig-block">
          <div class="sig-label">Conducteur de travaux</div>
          ${conducteurSigHtml}
          <div class="sig-name">${opr.conducteur}</div>
          <div class="sig-date">Date : ${dateShort}</div>
        </div>
        <div class="sig-block">
          <div class="sig-label">Maître d'ouvrage</div>
          ${moSigHtml}
          <div class="sig-name">${opr.maireOuvrage ?? '—'}</div>
          <div class="sig-date">Date : ${dateShort}</div>
        </div>
      </div>
    </div>`;

  const infoItems = [
    { label: 'Référence OPR', value: opr.id },
    { label: 'Date réception', value: opr.date },
    { label: 'Localisation', value: `Bât. ${opr.building} — ${opr.level}` },
    { label: 'Conducteur', value: opr.conducteur },
    ...(opr.maireOuvrage ? [{ label: "Maître d'ouvrage", value: opr.maireOuvrage }] : []),
  ];

  const body = `
    ${buildLetterhead('Procès-Verbal de Levée de Réserves', opr.title, docRef, dateShort, projectName)}
    ${buildInfoGrid(infoItems)}
    ${buildKpiRow([
      { val: totalReserves, label: 'Réserves au PV', color: '#003082' },
      { val: leveed.length, label: 'Levées', color: '#059669' },
      { val: pending.length, label: 'En attente', color: pending.length > 0 ? '#DC2626' : '#059669' },
      { val: totalReserves > 0 ? Math.round((leveed.length / totalReserves) * 100) + '%' : '—', label: 'Taux de levée', color: '#003082' },
    ])}
    ${pending.length === 0
      ? '<div class="alert alert-success">✅ Toutes les réserves ont été levées — La réception est définitive.</div>'
      : `<div class="alert alert-warning">⚠️ <strong>${pending.length} réserve${pending.length > 1 ? 's' : ''} en attente</strong> — La réception définitive ne peut être prononcée qu'après levée de l'ensemble des réserves.</div>`
    }
    <div class="section-header">Tableau récapitulatif des réserves par lot</div>
    <table>
      <thead>
        <tr>
          <th>LOT</th>
          <th>RÉSERVE</th>
          <th>DESCRIPTION</th>
          <th style="text-align:center">STATUT</th>
          <th>DATE LEVÉE</th>
          <th>LEVÉE PAR</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#059669;padding:14px">Aucune réserve — Réception sans réserve</td></tr>'}</tbody>
    </table>
    ${photoSection}
    ${signatureBlock}
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, `PV de Levée — ${opr.id}`);
}

function buildConvocationPDF(opr: Opr, projectName: string, conducteur: string): string {
  const today = formatDateFR(new Date());
  const docRef = `CONV-${opr.id}-${today.replace(/\//g, '')}`;
  const reserveItems = opr.items.filter(i => i.status === 'reserve');
  const totalItems = opr.items.length;
  const signatories = opr.signatories ?? [];

  const reserveRows = reserveItems.map((item, idx) =>
    `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:700">${item.lotName}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${item.entreprise ?? '—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#DC2626;font-weight:700">${item.deadline ?? '—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${item.note ?? ''}</td>
    </tr>`
  ).join('');

  const participants = signatories.length > 0
    ? signatories.map(s =>
        `<tr>
          <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:600">${s.name}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${s.role}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${s.email ?? '—'}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
            ${s.signedAt
              ? '<span style="background:#ECFDF5;color:#059669;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px">✓ Confirmé</span>'
              : '<span style="background:#F9FAFB;color:#6B7280;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px">Convoqué</span>'}
          </td>
        </tr>`
      ).join('')
    : `<tr><td colspan="4" style="padding:10px;text-align:center;color:#6B7280;font-style:italic;font-size:11px">Aucun signataire invité — à compléter avant envoi</td></tr>`;

  const body = `
    ${buildLetterhead('Lettre de Convocation — OPR', opr.title, docRef, today, projectName)}
    <div style="background:#FFF8E1;border-left:4px solid #F59E0B;padding:12px 16px;border-radius:0 10px 10px 0;margin-bottom:22px;font-size:12px;color:#92400E">
      <strong>Objet :</strong> Convocation aux Opérations Préalables à la Réception (OPR) — ${opr.title}
    </div>
    ${buildInfoGrid([
      { label: 'Référence OPR', value: opr.id },
      { label: 'Date de réception', value: opr.date },
      { label: 'Localisation', value: `Bât. ${opr.building} — ${opr.level}` },
      { label: 'Conducteur', value: conducteur },
      ...(opr.maireOuvrage ? [{ label: "Maître d'ouvrage", value: opr.maireOuvrage }] : []),
      ...(opr.visitContradictoire ? [{ label: 'Visite contradictoire', value: opr.visitContradictoire }] : []),
    ])}
    ${buildKpiRow([
      { val: totalItems, label: 'Points de contrôle', color: '#003082' },
      { val: reserveItems.length, label: 'Réserves émises', color: '#DC2626' },
      { val: opr.items.filter(i => i.status === 'ok').length, label: 'Conformes', color: '#059669' },
      { val: signatories.length, label: 'Convoqués', color: '#D97706' },
    ])}
    <div class="section-header">Objet de la convocation</div>
    <div style="background:#F4F7FB;border-radius:10px;padding:14px 16px;border:1px solid #DDE4EE;font-size:12px;line-height:1.8;margin-bottom:16px">
      Par la présente, vous êtes convoqué(e) à participer aux <strong>Opérations Préalables à la Réception (OPR)</strong>
      du chantier <strong>${projectName}</strong> conformément aux dispositions contractuelles en vigueur.
      <br/><br/>
      La réception des travaux intervient à la fin de l'exécution du marché. Elle permet de constater l'état d'achèvement
      des travaux et d'établir, le cas échéant, la liste des réserves à lever avant la réception définitive.
    </div>
    ${reserveItems.length > 0 ? `
    <div class="section-header">Réserves à lever avant réception (${reserveItems.length})</div>
    <table>
      <thead><tr>
        <th>LOT</th><th>ENTREPRISE</th><th>DÉLAI DE LEVÉE</th><th>OBSERVATIONS</th>
      </tr></thead>
      <tbody>${reserveRows}</tbody>
    </table>
    ` : `<div class="alert alert-success">✅ Aucune réserve — Réception envisagée sans réserve.</div>`}
    <div class="section-header">Parties convoquées</div>
    <table>
      <thead><tr>
        <th>NOM</th><th>QUALITÉ / RÔLE</th><th>EMAIL</th><th style="text-align:center">STATUT</th>
      </tr></thead>
      <tbody>${participants}</tbody>
    </table>
    <div style="margin-top:36px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div class="section-header">Signature du conducteur de travaux</div>
      <div style="display:flex;gap:40px;margin-top:16px">
        <div>
          <div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:28px;font-weight:700">Conducteur de travaux</div>
          <div style="height:60px;border-bottom:2px solid #1A2742;width:220px;margin-bottom:8px"></div>
          <div style="font-size:12px;font-weight:700;color:#1A2742">${conducteur}</div>
          <div style="font-size:10px;color:#6B7280">Date : ${today}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:28px;font-weight:700">Accusé de réception</div>
          <div style="height:60px;border-bottom:2px solid #1A2742;width:220px;margin-bottom:8px"></div>
          <div style="font-size:10px;color:#6B7280">Nom, date et signature du destinataire</div>
        </div>
      </div>
    </div>
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, `Convocation OPR — ${opr.id}`);
}

export default function OprScreen() {
  const router = useRouter();
  const { oprs, addOpr, updateOpr, deleteOpr, lots, reserves, activeChantierId, activeChantier, updateReserveStatus } = useApp();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();

  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(formatDateFR(new Date()));
  const [building, setBuilding] = useState(RESERVE_BUILDINGS[0]);
  const [level, setLevel] = useState('RDC');
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
    () => DEFAULT_OPR_ITEMS.map(name => ({ id: genId(), name, entreprise: '' }))
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
      <View style={{ flex: 1, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Header title="OPR" />
        <Ionicons name="lock-closed-outline" size={48} color="#9CA3AF" />
        <Text style={{ marginTop: 16, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#374151', textAlign: 'center' }}>Accès non autorisé</Text>
        <Text style={{ marginTop: 8, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center' }}>
          Les OPR (Opérations de réception) sont réservés aux conducteurs de travaux et chefs d'équipe.
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
      role: inviteRole.trim() || 'Participant',
      email: inviteEmail.trim() || undefined,
    };
    updateOpr({ ...opr, signatories: [...(opr.signatories ?? []), newSig] });
    setInviteName(''); setInviteRole(''); setInviteEmail('');
    setInviteModal(null);
  }

  function removeSignatory(opr: Opr, sigId: string) {
    Alert.alert('Retirer', 'Retirer ce signataire ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () =>
        updateOpr({ ...opr, signatories: (opr.signatories ?? []).filter(s => s.id !== sigId) })
      },
    ]);
  }

  const chantierOprs = useMemo(
    () => oprs.filter(o => !activeChantierId || o.chantierId === activeChantierId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [oprs, activeChantierId]
  );

  const chantierReserves = useMemo(
    () => reserves.filter(r => !activeChantierId || r.chantierId === activeChantierId),
    [reserves, activeChantierId]
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
    if (!title.trim()) { Alert.alert('Champ requis', 'Titre obligatoire.'); return; }
    const validLots = formLots.filter(l => l.name.trim());
    if (validLots.length === 0) { Alert.alert('Lots requis', 'Ajoutez au moins un lot.'); return; }
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
      conducteur: user?.name ?? 'Conducteur',
      status: 'draft',
      items,
      maireOuvrage: maireOuvrage.trim() || undefined,
      visitContradictoire: visitDateForm.trim() || undefined,
      createdAt: formatDateFR(new Date()),
    };
    addOpr(opr);
    setTitle('');
    setMaireOuvrage('');
    setVisitDateForm('');
    setFormLots(DEFAULT_OPR_ITEMS.map(name => ({ id: genId(), name, entreprise: '' })));
    setShowLotsConfig(false);
    setNewLotName('');
    setShowNew(false);
  }

  async function shareOprLink(opr: Opr) {
    const base = Platform.OS === 'web' ? window.location.origin : (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : process.env.EXPO_PUBLIC_APP_URL ?? '');
    const url = `${base}/opr-session/${opr.id}`;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(url); Alert.alert('Lien copié', 'Partagez ce lien avec les signataires externes.'); } catch { Alert.alert('Lien de session', url); }
      return;
    }
    try {
      await Share.share({ message: `Accès à la session OPR "${opr.title}" :\n${url}`, url });
    } catch {}
  }

  async function exportOprPDF(opr: Opr) {
    try {
      const html = buildOprPDF(opr, projectName);
      await exportPDFHelper(html, `PV ${opr.id}`);
    } catch (e: any) {
      Alert.alert('Erreur PDF', e?.message ?? '');
    }
  }

  async function exportLeveePDF(opr: Opr) {
    try {
      const html = await buildPvLeveePDF(opr, reserves, projectName);
      await exportPDFHelper(html, `PV Levée ${opr.id}`);
    } catch (e: any) {
      Alert.alert('Erreur PDF', e?.message ?? '');
    }
  }

  async function exportConvocationPDF(opr: Opr) {
    try {
      const html = buildConvocationPDF(opr, projectName, user?.name ?? 'Conducteur de travaux');
      await exportPDFHelper(html, `Convocation OPR ${opr.id}`);
    } catch (e: any) {
      Alert.alert('Erreur PDF', e?.message ?? '');
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
      Alert.alert('Nom requis', 'Veuillez saisir le nom du conducteur de travaux.');
      return;
    }
    if (!signMoName.trim()) {
      Alert.alert('Nom requis', "Veuillez saisir le nom du maître d'ouvrage.");
      return;
    }

    const conducteurSig = conducteurPadRef.current?.isEmpty() ? undefined : conducteurPadRef.current?.getSVGData() ?? undefined;
    const moSig = moPadRef.current?.isEmpty() ? undefined : moPadRef.current?.getSVGData() ?? undefined;

    if (!conducteurSig && !moSig) {
      Alert.alert('Signature requise', 'Veuillez apposer au moins une signature dessinée.');
      return;
    }

    const now = formatDateFR(new Date());
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
    const now = formatDateFR(new Date());
    const updated = opr.items.map(item =>
      item.id === itemId ? { ...item, verifiedAt: now, verifiedBy: user?.name ?? 'Conducteur' } : item
    );
    updateOpr({ ...opr, items: updated });
    Alert.alert('Levée vérifiée ✓', 'La levée de la réserve a été confirmée et horodatée.');
  }

  function cycleItemStatus(opr: Opr, itemId: string) {
    const order: Array<'ok' | 'reserve' | 'non_applicable'> = ['ok', 'reserve', 'non_applicable'];
    const item = opr.items.find(i => i.id === itemId);
    if (!item) return;
    const idx = order.indexOf(item.status);
    const newStatus = order[(idx + 1) % order.length];
    const updated = opr.items.map(i =>
      i.id === itemId ? { ...i, status: newStatus } : i
    );
    updateOpr({ ...opr, items: updated });
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

  const STATUS_ORDER: Record<OprStatus, number> = { draft: 0, in_progress: 1, signed: 2 };
  const STATUS_CFG: Record<OprStatus, { label: string; color: string }> = {
    draft: { label: 'Brouillon', color: C.textMuted },
    in_progress: { label: 'En cours', color: C.inProgress },
    signed: { label: 'Signé', color: C.closed },
  };

  return (
    <View style={styles.container}>
      <Header
        title="OPR / Réception"
        subtitle={`${chantierOprs.length} procès-verbal${chantierOprs.length !== 1 ? 'x' : ''}`}
        showBack
        rightIcon={permissions.canCreate ? 'add-circle-outline' : undefined}
        onRightPress={permissions.canCreate ? () => setShowNew(v => !v) : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {showNew && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Nouveau procès-verbal de réception</Text>

            <Text style={styles.label}>Titre *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: OPR Bâtiment A — Réception R+1"
              placeholderTextColor={C.textMuted}
              value={title}
              onChangeText={setTitle}
            />

            <Text style={styles.label}>Maître d'ouvrage</Text>
            <TextInput
              style={styles.input}
              placeholder="Nom du maître d'ouvrage"
              placeholderTextColor={C.textMuted}
              value={maireOuvrage}
              onChangeText={setMaireOuvrage}
            />

            <Text style={styles.label}>Bâtiment</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {RESERVE_BUILDINGS.map(b => (
                  <TouchableOpacity
                    key={b}
                    style={[styles.chip, building === b && styles.chipActive]}
                    onPress={() => setBuilding(b)}
                  >
                    <Text style={[styles.chipText, building === b && styles.chipTextActive]}>Bât. {b}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={[styles.label, { marginTop: 10 }]}>Niveau</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {RESERVE_LEVELS.map(l => (
                  <TouchableOpacity
                    key={l}
                    style={[styles.chip, level === l && styles.chipActive]}
                    onPress={() => setLevel(l)}
                  >
                    <Text style={[styles.chipText, level === l && styles.chipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={{ marginTop: 10 }}>
              <DateInput label="Date de visite contradictoire" value={visitDateForm} onChange={setVisitDateForm} optional />
            </View>

            <TouchableOpacity style={styles.lotsToggle} onPress={() => setShowLotsConfig(v => !v)}>
              <Ionicons name="list-outline" size={14} color={C.primary} />
              <Text style={styles.lotsToggleText}>
                Corps d'état — {formLots.filter(l => l.name.trim()).length} lot{formLots.filter(l => l.name.trim()).length !== 1 ? 's' : ''}
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
                        placeholder="Nom du lot"
                        placeholderTextColor={C.textMuted}
                      />
                      <TextInput
                        style={styles.lotEntrepriseInput}
                        value={lot.entreprise}
                        onChangeText={v => setFormLots(prev => prev.map(l => l.id === lot.id ? { ...l, entreprise: v } : l))}
                        placeholder="Entreprise responsable"
                        placeholderTextColor={C.textMuted}
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() => setFormLots(prev => prev.filter(l => l.id !== lot.id))}
                      hitSlop={8} style={{ padding: 4 }}
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
                    placeholder="Ajouter un lot…"
                    placeholderTextColor={C.textMuted}
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
                  >
                    <Ionicons name="add" size={18} color={C.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNew(false)}>
                <Text style={styles.cancelBtnText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.createBtn} onPress={createOpr}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.createBtnText}>Créer le PV</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {chantierOprs.length === 0 && !showNew ? (
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyTitle}>Aucun procès-verbal</Text>
            <Text style={styles.emptyText}>Créez un OPR pour formaliser la réception de chantier</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)}>
                <Text style={styles.emptyBtnText}>Créer un PV</Text>
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
                  {(['Création', 'Visite', 'Levée', 'Signé'] as const).map((label, idx) => {
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
                <Text style={styles.oprMeta}>Bât. {opr.building} — {opr.level} · {opr.conducteur}</Text>
                {opr.maireOuvrage ? (
                  <Text style={styles.oprMeta}>MO : {opr.maireOuvrage}</Text>
                ) : null}
                {opr.visitContradictoire ? (
                  <View>
                    <View style={styles.visiteMeta}>
                      <Ionicons name="calendar-outline" size={12} color="#7C3AED" />
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
                            >
                              <Ionicons name="checkmark" size={13} color="#fff" />
                              <Text style={styles.visitDateSaveBtnText}>Confirmer</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setEditingVisitOprId(null)} hitSlop={8}>
                              <Ionicons name="close" size={14} color={C.textMuted} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                            onPress={() => setExpandedParticipantsOpr(p => p === opr.id ? null : opr.id)}
                          >
                            <Text style={styles.visiteMetaText}>Visite : {opr.visitContradictoire}</Text>
                            <Text style={styles.participantsCountText}>
                              {(opr.visitParticipants ?? []).length > 0
                                ? `${(opr.visitParticipants ?? []).length} participant${(opr.visitParticipants ?? []).length > 1 ? 's' : ''}`
                                : '+ Participants'}
                            </Text>
                            <Ionicons name={expandedParticipantsOpr === opr.id ? 'chevron-up' : 'chevron-down'} size={11} color="#7C3AED" />
                          </TouchableOpacity>
                          {permissions.canEdit && opr.status !== 'signed' && (
                            <TouchableOpacity
                              onPress={() => { setEditingVisitDate(opr.visitContradictoire ?? ''); setEditingVisitOprId(opr.id); }}
                              hitSlop={8}
                              style={{ paddingLeft: 4 }}
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
                          <Text style={styles.participantsEmpty}>Aucun participant enregistré</Text>
                        ) : (
                          (opr.visitParticipants ?? []).map(p => (
                            <View key={p.id} style={styles.participantRow}>
                              <TouchableOpacity
                                style={[styles.presenceBtn, p.present && styles.presenceBtnActive]}
                                onPress={() => toggleParticipantPresent(opr, p.id)}
                              >
                                <Ionicons name={p.present ? 'checkmark' : 'close'} size={10} color={p.present ? '#fff' : C.textMuted} />
                              </TouchableOpacity>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.participantName}>{p.name}</Text>
                                {p.company ? <Text style={styles.participantCompany}>{p.company}</Text> : null}
                              </View>
                              <Text style={[styles.participantBadge, p.present ? styles.participantPresent : styles.participantAbsent]}>
                                {p.present ? 'Présent' : 'Absent'}
                              </Text>
                              {permissions.canEdit && opr.status !== 'signed' && (
                                <TouchableOpacity onPress={() => removeParticipant(opr, p.id)} hitSlop={8}>
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
                              placeholder="Nom"
                              placeholderTextColor={C.textMuted}
                              value={newParticipantName}
                              onChangeText={setNewParticipantName}
                            />
                            <TextInput
                              style={[styles.detailInput, { flex: 1 }]}
                              placeholder="Entreprise"
                              placeholderTextColor={C.textMuted}
                              value={newParticipantCompany}
                              onChangeText={setNewParticipantCompany}
                            />
                            <TouchableOpacity style={styles.addParticipantBtn} onPress={() => addParticipant(opr)}>
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
                          >
                            <Ionicons name="checkmark" size={13} color="#fff" />
                            <Text style={styles.visitDateSaveBtnText}>Confirmer</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setEditingVisitOprId(null)} hitSlop={8}>
                            <Ionicons name="close" size={14} color={C.textMuted} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.planifierVisiteBtn}
                        onPress={() => { setEditingVisitDate(''); setEditingVisitOprId(opr.id); }}
                      >
                        <Ionicons name="calendar-outline" size={12} color="#7C3AED" />
                        <Text style={styles.planifierVisiteText}>Planifier la visite contradictoire</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}

                <View style={styles.oprStats}>
                  <View style={styles.oprStat}>
                    <Ionicons name="checkmark-circle" size={13} color={C.closed} />
                    <Text style={[styles.oprStatText, { color: C.closed }]}>{countOk} conforme{countOk !== 1 ? 's' : ''}</Text>
                  </View>
                  <View style={styles.oprStat}>
                    <Ionicons name="warning" size={13} color={C.open} />
                    <Text style={[styles.oprStatText, { color: C.open }]}>{countRes} réserve{countRes !== 1 ? 's' : ''}</Text>
                  </View>
                  <Text style={styles.oprStatSep}>·</Text>
                  <Text style={styles.oprStatText}>{opr.items.length} points</Text>
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
                                {item.verifiedAt ? <Text style={[styles.itemSubText, { color: C.closed }]}>✓ Vérifié</Text> : null}
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
                                  >
                                    <Ionicons name={cfg.icon as any} size={14} color={active ? cfg.color : C.textMuted} />
                                  </TouchableOpacity>
                                );
                              })}
                              {item.status === 'reserve' && (
                                <TouchableOpacity onPress={() => toggleItemExpand(opr, item.id)} hitSlop={8} style={{ paddingLeft: 4 }}>
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
                            <Text style={styles.detailPanelTitle}>Détail — {item.lotName}</Text>

                            <Text style={styles.detailLabel}>ENTREPRISE RESPONSABLE</Text>
                            <TextInput
                              style={styles.detailInput}
                              placeholder="Nom de l'entreprise…"
                              placeholderTextColor={C.textMuted}
                              value={edit.entreprise}
                              onChangeText={v => setItemEdits(prev => ({ ...prev, [item.id]: { ...edit, entreprise: v } }))}
                            />

                            <Text style={styles.detailLabel}>DÉLAI DE LEVÉE</Text>
                            <DateInput
                              value={edit.deadline}
                              onChange={v => setItemEdits(prev => ({ ...prev, [item.id]: { ...edit, deadline: v } }))}
                              optional
                            />

                            <Text style={styles.detailLabel}>OBSERVATION / NOTE</Text>
                            <TextInput
                              style={[styles.detailInput, { minHeight: 60, textAlignVertical: 'top' }]}
                              placeholder="Description de l'observation…"
                              placeholderTextColor={C.textMuted}
                              value={edit.note}
                              onChangeText={v => setItemEdits(prev => ({ ...prev, [item.id]: { ...edit, note: v } }))}
                              multiline
                            />

                            <Text style={styles.detailLabel}>RÉSERVE LIÉE</Text>
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
                                >
                                  <Ionicons name="close-circle" size={15} color={C.textMuted} />
                                </TouchableOpacity>
                              </View>
                            ) : (
                              <TouchableOpacity
                                style={styles.linkReserveBtn}
                                onPress={() => setLinkReserveModal({ opr, itemId: item.id })}
                              >
                                <Ionicons name="link-outline" size={13} color={C.primary} />
                                <Text style={styles.linkReserveBtnText}>Lier une réserve existante</Text>
                              </TouchableOpacity>
                            )}

                            <View style={styles.detailActions}>
                              {isLevee && !item.verifiedAt && (
                                <TouchableOpacity style={styles.verifyBtn} onPress={() => verifyLevee(opr, item.id)}>
                                  <Ionicons name="checkmark-circle-outline" size={14} color={C.closed} />
                                  <Text style={styles.verifyBtnText}>Vérifier la levée</Text>
                                </TouchableOpacity>
                              )}
                              {item.verifiedAt && (
                                <View style={styles.verifiedBadge}>
                                  <Ionicons name="checkmark-circle" size={14} color={C.closed} />
                                  <Text style={styles.verifiedBadgeText}>Vérifié le {item.verifiedAt}</Text>
                                </View>
                              )}
                              <TouchableOpacity style={styles.detailSaveBtn} onPress={() => saveItemDetail(opr, item.id)}>
                                <Ionicons name="save-outline" size={14} color="#fff" />
                                <Text style={styles.detailSaveBtnText}>Enregistrer</Text>
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
                      <Text style={styles.suiviTitle}>Suivi des délais de levée</Text>
                      <Text style={styles.suiviProgress}>{leveedCount}/{countRes} levée{countRes > 1 ? 's' : ''}</Text>
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
                              isLev ? { color: '#059669' } :
                              over ? { color: C.open } :
                              { color: C.textMuted },
                            ]}>
                              {isVer ? '✓ Vérifié' : isLev ? 'Levée' : over ? 'En retard' : 'En attente'}
                            </Text>
                          </View>
                          {isLev && !isVer && permissions.canEdit && opr.status !== 'signed' && (
                            <TouchableOpacity onPress={() => verifyLevee(opr, item.id)} hitSlop={8} style={{ marginLeft: 4 }}>
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
                    <TouchableOpacity style={styles.actionBtn} onPress={() => exportOprPDF(opr)}>
                      <Ionicons name="download-outline" size={14} color={C.primary} />
                      <Text style={[styles.actionBtnText, { color: C.primary }]}>PV Réception</Text>
                    </TouchableOpacity>
                  )}
                  {permissions.canExport && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: '#F59E0B40', backgroundColor: '#FFFBEB' }]}
                      onPress={() => exportConvocationPDF(opr)}
                    >
                      <Ionicons name="mail-outline" size={14} color="#D97706" />
                      <Text style={[styles.actionBtnText, { color: '#D97706' }]}>Convocation</Text>
                    </TouchableOpacity>
                  )}
                  {permissions.canExport && opr.items.some(i => i.status === 'reserve') && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: C.closed + '40', backgroundColor: C.closedBg }]}
                      onPress={() => exportLeveePDF(opr)}
                    >
                      <Ionicons name="checkmark-done-outline" size={14} color={C.closed} />
                      <Text style={[styles.actionBtnText, { color: C.closed }]}>PV Levée</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: '#8B5CF620', backgroundColor: '#F5F3FF' }]} onPress={() => shareOprLink(opr)}>
                    <Ionicons name="link-outline" size={14} color="#7C3AED" />
                    <Text style={[styles.actionBtnText, { color: '#7C3AED' }]}>Lien session</Text>
                  </TouchableOpacity>
                  {permissions.canEdit && opr.status !== 'signed' && (
                    <TouchableOpacity style={[styles.actionBtn, styles.signBtn]} onPress={() => openSignModal(opr)}>
                      <Ionicons name="create-outline" size={14} color={C.closed} />
                      <Text style={[styles.actionBtnText, { color: C.closed }]}>Signer le PV</Text>
                    </TouchableOpacity>
                  )}
                  {opr.status === 'signed' && (
                    <View style={styles.signedBadge}>
                      <Ionicons name="checkmark-circle" size={14} color={C.closed} />
                      <Text style={styles.signedText}>PV signé le {opr.signedAt}</Text>
                    </View>
                  )}
                  {permissions.canDelete && (
                    <TouchableOpacity
                      onPress={() => Alert.alert('Supprimer', `Supprimer "${opr.title}" ?`, [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Supprimer', style: 'destructive', onPress: () => deleteOpr(opr.id) },
                      ])}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={15} color={C.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.signatoryPanel}>
                  <View style={styles.signatoryHeader}>
                    <Ionicons name="people-outline" size={13} color={C.textSub} />
                    <Text style={styles.signatoryTitle}>Signataires collaboratifs</Text>
                    {permissions.canEdit && opr.status !== 'signed' && (
                      <TouchableOpacity style={styles.inviteBtn} onPress={() => setInviteModal({ opr })}>
                        <Ionicons name="person-add-outline" size={12} color={C.primary} />
                        <Text style={styles.inviteBtnText}>Inviter</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {(opr.signatories ?? []).length === 0 ? (
                    <Text style={styles.signatoryEmpty}>Aucun signataire invité — appuyez sur "Inviter" pour ajouter des participants</Text>
                  ) : (
                    (opr.signatories ?? []).map(sig => (
                      <View key={sig.id} style={styles.signatoryRow}>
                        <View style={styles.signatoryAvatar}>
                          <Text style={styles.signatoryAvatarText}>{sig.name.slice(0, 1).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.signatoryName}>{sig.name}</Text>
                          <Text style={styles.signatoryRole}>{sig.role}{sig.email ? ' · ' + sig.email : ''}</Text>
                        </View>
                        {sig.signedAt ? (
                          <View style={styles.sigSignedBadge}>
                            <Ionicons name="checkmark-circle" size={12} color={C.closed} />
                            <Text style={styles.sigSignedText}>{sig.signedAt}</Text>
                          </View>
                        ) : (
                          <View style={styles.sigPendingBadge}>
                            <Text style={styles.sigPendingText}>En attente</Text>
                          </View>
                        )}
                        {permissions.canDelete && (
                          <TouchableOpacity onPress={() => removeSignatory(opr, sig.id)} hitSlop={8}>
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
              <Text style={styles.inviteTitle}>Inviter un signataire</Text>
              <Text style={styles.modalLabel}>Nom *</Text>
              <TextInput
                style={styles.input}
                placeholder="Prénom Nom"
                placeholderTextColor={C.textMuted}
                value={inviteName}
                onChangeText={setInviteName}
                autoFocus
              />
              <Text style={styles.modalLabel}>Rôle / Fonction</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Maître d'œuvre, BET Structure…"
                placeholderTextColor={C.textMuted}
                value={inviteRole}
                onChangeText={setInviteRole}
              />
              <Text style={styles.modalLabel}>Email (optionnel)</Text>
              <TextInput
                style={styles.input}
                placeholder="prenom.nom@entreprise.fr"
                placeholderTextColor={C.textMuted}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <View style={styles.inviteActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setInviteModal(null); setInviteName(''); setInviteRole(''); setInviteEmail(''); }}>
                  <Text style={styles.cancelBtnText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.createBtn} onPress={addSignatory}>
                  <Ionicons name="person-add-outline" size={15} color="#fff" />
                  <Text style={styles.createBtnText}>Ajouter</Text>
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
            <Text style={styles.inviteTitle}>Lier une réserve existante</Text>
            <Text style={[styles.label, { marginBottom: 10 }]}>Sélectionnez la réserve correspondant à ce lot</Text>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {chantierReserves.length === 0 ? (
                <Text style={styles.participantsEmpty}>Aucune réserve dans ce chantier</Text>
              ) : (
                chantierReserves.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.reservePickerRow}
                    onPress={() => linkReserveModal && linkReserveToItem(linkReserveModal.opr, linkReserveModal.itemId, r.id)}
                  >
                    <View style={[styles.reservePickerDot, { backgroundColor: r.status === 'closed' ? C.closed : C.open }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reservePickerTitle}>{r.title}</Text>
                      <Text style={styles.reservePickerMeta}>{r.company} · {r.building} {r.level}</Text>
                    </View>
                    <View style={[styles.suiviBadge, r.status === 'closed' ? styles.suiviBadgeLevee : styles.suiviBadgePending]}>
                      <Text style={[styles.suiviBadgeText, { color: r.status === 'closed' ? '#059669' : C.textMuted }]}>
                        {r.status === 'closed' ? 'Levée' : 'Ouverte'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 12 }]} onPress={() => setLinkReserveModal(null)}>
              <Text style={styles.cancelBtnText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={signModalOpr !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSignModalOpr(null)}
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
              <Text style={styles.modalTitle}>Signature électronique du PV</Text>
            </View>

            {signModalOpr && (
              <View style={styles.modalPvInfo}>
                <Text style={styles.modalPvTitle}>{signModalOpr.title}</Text>
                <Text style={styles.modalPvMeta}>Date : {signModalOpr.date} · Bât. {signModalOpr.building}</Text>
              </View>
            )}

            <View style={styles.signStepRow}>
              <TouchableOpacity
                style={[styles.signStepTab, signStep === 'conducteur' && styles.signStepTabActive]}
                onPress={() => setSignStep('conducteur')}
              >
                <Ionicons name="person-outline" size={14} color={signStep === 'conducteur' ? C.primary : C.textMuted} />
                <Text style={[styles.signStepTabText, signStep === 'conducteur' && { color: C.primary }]}>Conducteur</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.signStepTab, signStep === 'mo' && styles.signStepTabActive]}
                onPress={() => setSignStep('mo')}
              >
                <Ionicons name="business-outline" size={14} color={signStep === 'mo' ? C.primary : C.textMuted} />
                <Text style={[styles.signStepTabText, signStep === 'mo' && { color: C.primary }]}>Maître d'ouvrage</Text>
              </TouchableOpacity>
            </View>

            {signStep === 'conducteur' && (
              <View style={styles.signBlock}>
                <Text style={styles.modalLabel}>NOM COMPLET *</Text>
                <View style={styles.signInputWrap}>
                  <Ionicons name="person-outline" size={15} color={C.textMuted} />
                  <TextInput
                    style={styles.signInput}
                    value={signConducteurName}
                    onChangeText={setSignConducteurName}
                    placeholder="Votre nom complet..."
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="words"
                  />
                </View>
                <Text style={styles.modalLabel}>SIGNATURE (dessiner ci-dessous)</Text>
                <View style={styles.padContainer}>
                  <SignaturePad ref={conducteurPadRef} />
                  <TouchableOpacity
                    style={styles.clearPadBtn}
                    onPress={() => conducteurPadRef.current?.clear()}
                  >
                    <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                    <Text style={styles.clearPadText}>Effacer</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.nextStepBtn} onPress={() => setSignStep('mo')}>
                  <Text style={styles.nextStepBtnText}>Suivant — Maître d'ouvrage</Text>
                  <Ionicons name="arrow-forward" size={15} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            {signStep === 'mo' && (
              <View style={styles.signBlock}>
                <Text style={styles.modalLabel}>NOM DU MAÎTRE D'OUVRAGE *</Text>
                <View style={styles.signInputWrap}>
                  <Ionicons name="business-outline" size={15} color={C.textMuted} />
                  <TextInput
                    style={styles.signInput}
                    value={signMoName}
                    onChangeText={setSignMoName}
                    placeholder="Nom du maître d'ouvrage..."
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="words"
                  />
                </View>
                <Text style={styles.modalLabel}>SIGNATURE (dessiner ci-dessous)</Text>
                <View style={styles.padContainer}>
                  <SignaturePad ref={moPadRef} />
                  <TouchableOpacity
                    style={styles.clearPadBtn}
                    onPress={() => moPadRef.current?.clear()}
                  >
                    <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                    <Text style={styles.clearPadText}>Effacer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.signNotice}>
              <Ionicons name="shield-checkmark-outline" size={14} color={C.closed} />
              <Text style={styles.signNoticeText}>
                En signant, les deux parties confirment avoir vérifié tous les points de contrôle. Les signatures sont horodatées.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setSignModalOpr(null)}>
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={confirmSign}>
                <Ionicons name="ribbon-outline" size={16} color="#fff" />
                <Text style={styles.modalConfirmText}>Valider les signatures</Text>
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
  sigPendingBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: '#FEF3C7' },
  sigPendingText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: '#92400E' },

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
  visiteMetaText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#7C3AED' },
  visitDateEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  visitDateInput: {
    flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: '#8B5CF6',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text,
  },
  visitDateSaveBtn: {
    backgroundColor: '#7C3AED', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  visitDateSaveBtnText: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff',
  },
  planifierVisiteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#8B5CF620', backgroundColor: '#F5F3FF',
    alignSelf: 'flex-start', marginBottom: 2,
  },
  planifierVisiteText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#7C3AED' },

  itemRowOverdue: { backgroundColor: '#FFF1F1' },
  itemSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' },
  itemSubText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  itemDetailPanel: {
    backgroundColor: '#F8F9FF', padding: 14, gap: 8,
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
  suiviRowOverdue: { backgroundColor: '#FFF1F1' },
  suiviLot: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text },
  suiviEntreprise: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  suiviDeadline: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, minWidth: 70, textAlign: 'right' },
  suiviBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  suiviBadgeVerified: { backgroundColor: C.closedBg },
  suiviBadgeLevee: { backgroundColor: '#ECFDF5' },
  suiviBadgeOverdue: { backgroundColor: '#FEF2F2' },
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

  participantsCountText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#7C3AED', marginLeft: 'auto' as any, marginRight: 4 },
  participantsPanel: {
    backgroundColor: '#F5F3FF', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#DDD6FE', gap: 8, marginTop: 4, marginBottom: 6,
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
  participantAbsent: { backgroundColor: '#FEF2F2', color: C.open },
  addParticipantRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#DDD6FE' },
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
