import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Image, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import {
  exportPDF as exportPDFHelper,
  loadPhotoAsDataUrl, loadPhotoAsDataUrlForPdf,
  svgStringToDataUrl,
  buildPhotoGrid,
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
import { useLanguage } from '@/context/LanguageContext';
import { Visite, Reserve, VisiteStatus, OprStatus } from '@/constants/types';
import { formatDateFR, nowTimestampFR } from '@/lib/utils';
import { formatDate } from '@/lib/reserveUtils';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';
import SignaturePad, { SignaturePadRef } from '@/components/SignaturePad';
import LocationPicker from '@/components/LocationPicker';
import {
  enrichReservesForPdf as enrichReserveListForPdf,
  formatReserveLocation,
  getReservePdfPhotos,
} from '@/lib/pdfReserveHelpers';
import { buildPdfFilename } from '@/lib/pdfFilename';
import {
  RESERVE_PRIORITY_COLORS as SHARED_PRIORITY_COLORS,
  RESERVE_PRIORITY_LABELS as SHARED_PRIORITY_LABELS,
  RESERVE_STATUS_COLORS as SHARED_STATUS_COLORS,
  RESERVE_STATUS_LABELS as SHARED_STATUS_LABELS,
} from '@/lib/reserveLabels';
import { getReserveDescriptionText } from '@/lib/reserveDescription';
import PageContainer from '@/components/PageContainer';
import { showAlert } from '@/lib/appAlert';

const STATUS_CFG: Record<VisiteStatus, { color: string }> = {
  planned: { color: '#6366F1' },
  in_progress: { color: C.inProgress },
  completed: { color: C.closed },
};

const RESERVE_STATUS_LABELS = SHARED_STATUS_LABELS as Record<string, string>;
const RESERVE_STATUS_COLORS = SHARED_STATUS_COLORS as Record<string, string>;
const PRIORITY_LABELS = SHARED_PRIORITY_LABELS as Record<string, string>;
const PRIORITY_COLORS = SHARED_PRIORITY_COLORS as Record<string, string>;

const VISITE_TYPE_LABELS: Record<string, string> = {
  controle: 'Contrôle',
  opr: 'OPR',
  securite: 'Sécurité',
  reception: 'Réception',
  synthese: 'Synthèse',
  autre: 'Autre',
};

type VisitReportLanguage = 'fr' | 'en' | 'es';

const VISIT_REPORT_LANGUAGES: Array<{ code: VisitReportLanguage; label: string; title: string }> = [
  { code: 'fr', label: 'FR', title: 'Français' },
  { code: 'en', label: 'EN', title: 'English' },
  { code: 'es', label: 'ES', title: 'Español' },
];

type VisitReportCopy = {
  locale: string;
  uiTitle: string;
  uiSubtitle: string;
  uiLanguageLabel: string;
  uiExportButton: string;
  letterheadTitle: string;
  letterheadTagline: string;
  projectLabel: string;
  refLabel: string;
  dateLabel: string;
  footerGeneratedBy: string;
  footerConfidential: string;
  windowTitlePrefix: string;
  visitDefaultType: string;
  visitStatus: Record<string, string>;
  visitTypes: Record<string, string>;
  reserveStatus: Record<string, string>;
  reservePriority: Record<string, string>;
  noCompany: string;
  noDeadline: string;
  noLocation: string;
  noBuilding: string;
  noZone: string;
  noPlan: string;
  pinPositioned: string;
  infoVisitType: string;
  infoConductor: string;
  infoVisitDate: string;
  infoVisitScope: string;
  infoLocation: string;
  infoVisitStatus: string;
  infoDeadline: string;
  infoTags: string;
  executiveTitle: string;
  priorityCardTitle: string;
  priorityHighText: (count: number) => string;
  priorityNoneText: string;
  deadlineCardTitle: string;
  overdueText: (count: number) => string;
  deadlineFilledText: (count: number) => string;
  companiesCardTitle: string;
  companiesText: (count: number) => string;
  companiesNoneText: string;
  checklistCardTitle: string;
  checklistText: (done: number, total: number, pct: number) => string;
  checklistNoneText: string;
  deadlinesTitle: string;
  deadlineTableHeaders: string[];
  noDeadlineRows: string;
  actionsTitle: string;
  noActions: string;
  actionCount: (count: number) => string;
  deadlineMeta: string;
  planMeta: string;
  reservesTitle: (count: number) => string;
  reserveTableHeaders: string[];
  noReserves: string;
  plansTitle: string;
  planSummary: (reserves: number, pins: number) => string;
  statusDistributionTitle: string;
  companyDistributionTitle: string;
  noReserveDistribution: string;
  noCompanyDistribution: string;
  pilotageTitle: string;
  participantsTitle: (count: number) => string;
  participantHeaders: string[];
  checklistSectionTitle: (done: number, total: number, pct: number) => string;
  photoSectionTitle: (count: number) => string;
  photoGridTitle: (count: number) => string;
  photoResolutionBadge: string;
  photoObservationBadge: string;
  decisionsTitle: string;
  signaturesTitle: string;
  signatureConductor: string;
  signatureCompany: string;
  signatureDate: string;
  kpiReserves: string;
  kpiOpen: string;
  kpiInProgress: string;
  kpiToValidate: string;
  kpiClosed: string;
  kpiOverdue: string;
};

const VISIT_REPORT_COPY: Record<VisitReportLanguage, VisitReportCopy> = {
  fr: {
    locale: 'fr-FR',
    uiTitle: 'Compte-rendu PDF',
    uiSubtitle: 'Choisissez la langue de la structure du rapport.',
    uiLanguageLabel: 'Langue du PDF',
    uiExportButton: 'Exporter le compte-rendu PDF',
    letterheadTitle: 'Compte-rendu de visite de chantier',
    letterheadTagline: 'Gestion de chantier numérique',
    projectLabel: 'Projet',
    refLabel: 'Réf.',
    dateLabel: 'Date',
    footerGeneratedBy: 'Généré par BuildTrack',
    footerConfidential: 'Document confidentiel',
    windowTitlePrefix: 'CR Visite',
    visitDefaultType: 'Visite chantier',
    visitStatus: { planned: 'Planifiée', in_progress: 'En cours', completed: 'Terminée' },
    visitTypes: VISITE_TYPE_LABELS,
    reserveStatus: RESERVE_STATUS_LABELS,
    reservePriority: PRIORITY_LABELS,
    noCompany: 'Sans entreprise',
    noDeadline: 'Non définie',
    noLocation: 'Localisation non précisée',
    noBuilding: 'Sans bâtiment',
    noZone: 'Zone non précisée',
    noPlan: 'Sans plan associé',
    pinPositioned: 'Épingle positionnée',
    infoVisitType: 'Type de visite',
    infoConductor: 'Conducteur de travaux',
    infoVisitDate: 'Date de visite',
    infoVisitScope: 'Périmètre de visite',
    infoLocation: 'Localisation',
    infoVisitStatus: 'Statut de la visite',
    infoDeadline: 'Délai cible de levée',
    infoTags: 'Tags',
    executiveTitle: 'Synthèse exécutive',
    priorityCardTitle: 'Priorités de sortie de visite',
    priorityHighText: count => `${count} réserve${count > 1 ? 's' : ''} haute${count > 1 ? 's' : ''} ou critique${count > 1 ? 's' : ''} à traiter en premier.`,
    priorityNoneText: 'Aucune réserve haute ou critique relevée sur cette visite.',
    deadlineCardTitle: 'Échéances sensibles',
    overdueText: count => `${count} réserve${count > 1 ? 's' : ''} déjà en retard.`,
    deadlineFilledText: count => `${count} réserve${count > 1 ? 's' : ''} avec échéance renseignée.`,
    companiesCardTitle: 'Entreprises concernées',
    companiesText: count => `${count} entreprise${count > 1 ? 's' : ''} concernée${count > 1 ? 's' : ''} par les actions de ce compte-rendu.`,
    companiesNoneText: 'Aucune entreprise responsable renseignée.',
    checklistCardTitle: 'Checklist de contrôle',
    checklistText: (done, total, pct) => `${done}/${total} point${total > 1 ? 's' : ''} validé${done > 1 ? 's' : ''} (${pct}%).`,
    checklistNoneText: 'Aucune checklist associée à cette visite.',
    deadlinesTitle: 'Synthèse des échéances principales',
    deadlineTableHeaders: ['Échéance', 'Bâtiment / zone', 'Action ou réserve', 'Responsable', 'Statut'],
    noDeadlineRows: 'Aucune échéance renseignée pour les réserves de cette visite.',
    actionsTitle: 'Actions par bâtiment, zone et entreprise',
    noActions: 'Aucune action à regrouper pour cette visite.',
    actionCount: count => `${count} action${count > 1 ? 's' : ''}`,
    deadlineMeta: 'Échéance',
    planMeta: 'Plan',
    reservesTitle: count => `Réserves relevées pendant la visite (${count})`,
    reserveTableHeaders: ['ID', 'Titre / description', 'Lieu', 'Entreprise', 'Priorité', 'Statut', 'Échéance'],
    noReserves: 'Aucune réserve rattachée à cette visite.',
    plansTitle: 'Plans associés et épingles',
    planSummary: (reserveCount, pinCount) => `${reserveCount} réserve${reserveCount > 1 ? 's' : ''} · ${pinCount} épingle${pinCount > 1 ? 's' : ''} positionnée${pinCount > 1 ? 's' : ''}`,
    statusDistributionTitle: 'Répartition par statut',
    companyDistributionTitle: 'Répartition par entreprise',
    noReserveDistribution: 'Aucune réserve',
    noCompanyDistribution: 'Aucune entreprise',
    pilotageTitle: 'Pilotage et répartition',
    participantsTitle: count => `Participants (${count})`,
    participantHeaders: ['Nom', 'Fonction', 'Entreprise'],
    checklistSectionTitle: (done, total, pct) => `Checklist de contrôle (${done}/${total} — ${pct}%)`,
    photoSectionTitle: count => `Photos terrain (${count} photo${count > 1 ? 's' : ''})`,
    photoGridTitle: count => `Photos (${count})`,
    photoResolutionBadge: 'Levée',
    photoObservationBadge: 'Constat',
    decisionsTitle: 'Décisions, blocages et observations',
    signaturesTitle: 'Diffusion et signatures',
    signatureConductor: 'Conducteur de travaux',
    signatureCompany: 'Lu et approuvé — Entreprise(s)',
    signatureDate: 'Date',
    kpiReserves: 'Réserves relevées',
    kpiOpen: 'Ouvertes',
    kpiInProgress: 'En cours',
    kpiToValidate: 'À valider',
    kpiClosed: 'Clôturées',
    kpiOverdue: 'En retard',
  },
  en: {
    locale: 'en-US',
    uiTitle: 'PDF report',
    uiSubtitle: 'Choose the language used for the report structure.',
    uiLanguageLabel: 'PDF language',
    uiExportButton: 'Export inspection report PDF',
    letterheadTitle: 'Site inspection report',
    letterheadTagline: 'Digital construction site management',
    projectLabel: 'Project',
    refLabel: 'Ref.',
    dateLabel: 'Date',
    footerGeneratedBy: 'Generated by BuildTrack',
    footerConfidential: 'Confidential document',
    windowTitlePrefix: 'Inspection Report',
    visitDefaultType: 'Site inspection',
    visitStatus: { planned: 'Planned', in_progress: 'In progress', completed: 'Completed' },
    visitTypes: { controle: 'Inspection', opr: 'Handover inspection', securite: 'Safety', reception: 'Handover', synthese: 'Summary', autre: 'Other' },
    reserveStatus: { open: 'Open', in_progress: 'In progress', waiting: 'Pending', verification: 'Verification', closed: 'Closed' },
    reservePriority: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
    noCompany: 'No company',
    noDeadline: 'Not defined',
    noLocation: 'Location not specified',
    noBuilding: 'No building',
    noZone: 'Zone not specified',
    noPlan: 'No linked drawing',
    pinPositioned: 'Pin positioned',
    infoVisitType: 'Inspection type',
    infoConductor: 'Site manager',
    infoVisitDate: 'Inspection date',
    infoVisitScope: 'Inspection scope',
    infoLocation: 'Location',
    infoVisitStatus: 'Inspection status',
    infoDeadline: 'Target clearance deadline',
    infoTags: 'Tags',
    executiveTitle: 'Executive summary',
    priorityCardTitle: 'Exit priorities',
    priorityHighText: count => `${count} high or critical punch item${count > 1 ? 's' : ''} to handle first.`,
    priorityNoneText: 'No high or critical punch item recorded during this inspection.',
    deadlineCardTitle: 'Sensitive deadlines',
    overdueText: count => `${count} punch item${count > 1 ? 's are' : ' is'} already overdue.`,
    deadlineFilledText: count => `${count} punch item${count > 1 ? 's have' : ' has'} a deadline.`,
    companiesCardTitle: 'Companies involved',
    companiesText: count => `${count} compan${count > 1 ? 'ies are' : 'y is'} involved in this report's actions.`,
    companiesNoneText: 'No responsible company specified.',
    checklistCardTitle: 'Inspection checklist',
    checklistText: (done, total, pct) => `${done}/${total} checkpoint${total > 1 ? 's' : ''} completed (${pct}%).`,
    checklistNoneText: 'No checklist linked to this inspection.',
    deadlinesTitle: 'Main deadlines summary',
    deadlineTableHeaders: ['Deadline', 'Building / zone', 'Action or punch item', 'Owner', 'Status'],
    noDeadlineRows: 'No deadline specified for this inspection’s punch items.',
    actionsTitle: 'Actions by building, zone and company',
    noActions: 'No action to group for this inspection.',
    actionCount: count => `${count} action${count > 1 ? 's' : ''}`,
    deadlineMeta: 'Deadline',
    planMeta: 'Drawing',
    reservesTitle: count => `Punch items recorded during the inspection (${count})`,
    reserveTableHeaders: ['ID', 'Title / description', 'Location', 'Company', 'Priority', 'Status', 'Deadline'],
    noReserves: 'No punch item linked to this inspection.',
    plansTitle: 'Linked drawings and pins',
    planSummary: (reserveCount, pinCount) => `${reserveCount} punch item${reserveCount > 1 ? 's' : ''} · ${pinCount} pin${pinCount > 1 ? 's' : ''} positioned`,
    statusDistributionTitle: 'Distribution by status',
    companyDistributionTitle: 'Distribution by company',
    noReserveDistribution: 'No punch item',
    noCompanyDistribution: 'No company',
    pilotageTitle: 'Management and distribution',
    participantsTitle: count => `Participants (${count})`,
    participantHeaders: ['Name', 'Role', 'Company'],
    checklistSectionTitle: (done, total, pct) => `Inspection checklist (${done}/${total} — ${pct}%)`,
    photoSectionTitle: count => `Field photos (${count} photo${count > 1 ? 's' : ''})`,
    photoGridTitle: count => `Photos (${count})`,
    photoResolutionBadge: 'Cleared',
    photoObservationBadge: 'Observation',
    decisionsTitle: 'Decisions, blockers and observations',
    signaturesTitle: 'Distribution and signatures',
    signatureConductor: 'Site manager',
    signatureCompany: 'Read and approved — Company(ies)',
    signatureDate: 'Date',
    kpiReserves: 'Punch items',
    kpiOpen: 'Open',
    kpiInProgress: 'In progress',
    kpiToValidate: 'To validate',
    kpiClosed: 'Closed',
    kpiOverdue: 'Overdue',
  },
  es: {
    locale: 'es-ES',
    uiTitle: 'Informe PDF',
    uiSubtitle: 'Elija el idioma de la estructura del informe.',
    uiLanguageLabel: 'Idioma del PDF',
    uiExportButton: 'Exportar informe de visita PDF',
    letterheadTitle: 'Informe de visita de obra',
    letterheadTagline: 'Gestión digital de obra',
    projectLabel: 'Proyecto',
    refLabel: 'Ref.',
    dateLabel: 'Fecha',
    footerGeneratedBy: 'Generado por BuildTrack',
    footerConfidential: 'Documento confidencial',
    windowTitlePrefix: 'Informe de visita',
    visitDefaultType: 'Visita de obra',
    visitStatus: { planned: 'Planificada', in_progress: 'En curso', completed: 'Terminada' },
    visitTypes: { controle: 'Control', opr: 'Recepción', securite: 'Seguridad', reception: 'Recepción', synthese: 'Síntesis', autre: 'Otro' },
    reserveStatus: { open: 'Abierta', in_progress: 'En curso', waiting: 'En espera', verification: 'Verificación', closed: 'Cerrada' },
    reservePriority: { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' },
    noCompany: 'Sin empresa',
    noDeadline: 'No definida',
    noLocation: 'Ubicación no especificada',
    noBuilding: 'Sin edificio',
    noZone: 'Zona no especificada',
    noPlan: 'Sin plano asociado',
    pinPositioned: 'Pin posicionado',
    infoVisitType: 'Tipo de visita',
    infoConductor: 'Jefe de obra',
    infoVisitDate: 'Fecha de visita',
    infoVisitScope: 'Perímetro de visita',
    infoLocation: 'Ubicación',
    infoVisitStatus: 'Estado de la visita',
    infoDeadline: 'Fecha objetivo de levantamiento',
    infoTags: 'Etiquetas',
    executiveTitle: 'Síntesis ejecutiva',
    priorityCardTitle: 'Prioridades de salida de visita',
    priorityHighText: count => `${count} incidencia${count > 1 ? 's' : ''} alta${count > 1 ? 's' : ''} o crítica${count > 1 ? 's' : ''} a tratar primero.`,
    priorityNoneText: 'No se registró ninguna incidencia alta o crítica durante esta visita.',
    deadlineCardTitle: 'Plazos sensibles',
    overdueText: count => `${count} incidencia${count > 1 ? 's ya están' : ' ya está'} en retraso.`,
    deadlineFilledText: count => `${count} incidencia${count > 1 ? 's tienen' : ' tiene'} fecha límite indicada.`,
    companiesCardTitle: 'Empresas afectadas',
    companiesText: count => `${count} empresa${count > 1 ? 's están' : ' está'} afectada${count > 1 ? 's' : ''} por las acciones de este informe.`,
    companiesNoneText: 'No se indicó ninguna empresa responsable.',
    checklistCardTitle: 'Checklist de control',
    checklistText: (done, total, pct) => `${done}/${total} punto${total > 1 ? 's' : ''} validado${done > 1 ? 's' : ''} (${pct}%).`,
    checklistNoneText: 'No hay checklist asociada a esta visita.',
    deadlinesTitle: 'Síntesis de los principales plazos',
    deadlineTableHeaders: ['Plazo', 'Edificio / zona', 'Acción o incidencia', 'Responsable', 'Estado'],
    noDeadlineRows: 'No se indicó ningún plazo para las incidencias de esta visita.',
    actionsTitle: 'Acciones por edificio, zona y empresa',
    noActions: 'No hay acciones que agrupar para esta visita.',
    actionCount: count => `${count} acción${count > 1 ? 'es' : ''}`,
    deadlineMeta: 'Plazo',
    planMeta: 'Plano',
    reservesTitle: count => `Incidencias registradas durante la visita (${count})`,
    reserveTableHeaders: ['ID', 'Título / descripción', 'Lugar', 'Empresa', 'Prioridad', 'Estado', 'Plazo'],
    noReserves: 'No hay incidencia asociada a esta visita.',
    plansTitle: 'Planos asociados y pins',
    planSummary: (reserveCount, pinCount) => `${reserveCount} incidencia${reserveCount > 1 ? 's' : ''} · ${pinCount} pin${pinCount > 1 ? 's' : ''} posicionado${pinCount > 1 ? 's' : ''}`,
    statusDistributionTitle: 'Distribución por estado',
    companyDistributionTitle: 'Distribución por empresa',
    noReserveDistribution: 'Ninguna incidencia',
    noCompanyDistribution: 'Ninguna empresa',
    pilotageTitle: 'Seguimiento y distribución',
    participantsTitle: count => `Participantes (${count})`,
    participantHeaders: ['Nombre', 'Función', 'Empresa'],
    checklistSectionTitle: (done, total, pct) => `Checklist de control (${done}/${total} — ${pct}%)`,
    photoSectionTitle: count => `Fotos de campo (${count} foto${count > 1 ? 's' : ''})`,
    photoGridTitle: count => `Fotos (${count})`,
    photoResolutionBadge: 'Levantada',
    photoObservationBadge: 'Constatación',
    decisionsTitle: 'Decisiones, bloqueos y observaciones',
    signaturesTitle: 'Difusión y firmas',
    signatureConductor: 'Jefe de obra',
    signatureCompany: 'Leído y aprobado — Empresa(s)',
    signatureDate: 'Fecha',
    kpiReserves: 'Incidencias',
    kpiOpen: 'Abiertas',
    kpiInProgress: 'En curso',
    kpiToValidate: 'Por validar',
    kpiClosed: 'Cerradas',
    kpiOverdue: 'En retraso',
  },
};

function cleanValue(value?: string | null, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function htmlText(value?: string | null, fallback = '—') {
  return escapeHtml(cleanValue(value, fallback));
}

function htmlMultiline(value?: string | null, fallback = '—') {
  return htmlText(value, fallback).replace(/\n/g, '<br/>');
}

function reserveCompanies(reserve: Reserve) {
  const names = reserve.companies?.length ? reserve.companies : reserve.company ? [reserve.company] : [];
  return Array.from(new Set(names.map(name => name.trim()).filter(Boolean)));
}

function reserveCompanyLabel(reserve: Reserve, copy: VisitReportCopy = VISIT_REPORT_COPY.fr) {
  return reserveCompanies(reserve).join(', ') || copy.noCompany;
}

function reserveDeadlineValue(reserve: Reserve, copy: VisitReportCopy = VISIT_REPORT_COPY.fr) {
  const deadline = cleanValue(reserve.deadline, '');
  return deadline && deadline !== '—' ? deadline : copy.noDeadline;
}

function parseDateValue(value?: string | null) {
  const text = String(value ?? '').trim();
  const fr = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (fr) {
    const year = fr[3].length === 2 ? Number(`20${fr[3]}`) : Number(fr[3]);
    return new Date(year, Number(fr[2]) - 1, Number(fr[1])).getTime();
  }
  const iso = Date.parse(text);
  return Number.isNaN(iso) ? Number.MAX_SAFE_INTEGER : iso;
}

function isReserveOverdue(reserve: Reserve) {
  if (reserve.status === 'closed') return false;
  const deadlineTime = parseDateValue(reserve.deadline);
  if (deadlineTime === Number.MAX_SAFE_INTEGER) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return deadlineTime < today.getTime();
}

function reserveLocationLabel(reserve: Reserve, copy: VisitReportCopy = VISIT_REPORT_COPY.fr) {
  return formatReserveLocation(reserve) || copy.noLocation;
}

function reservePriorityBadge(priority: string, copy: VisitReportCopy = VISIT_REPORT_COPY.fr) {
  const bg: Record<string, string> = { low: '#F0FDF4', medium: '#FFFBEB', high: '#FEF2F2', critical: '#F5F3FF' };
  return `<span class="badge" style="background:${bg[priority] ?? '#F9FAFB'};color:${PRIORITY_COLORS[priority] ?? '#6B7280'}">${escapeHtml(copy.reservePriority[priority] ?? PRIORITY_LABELS[priority] ?? priority)}</span>`;
}

function reserveStatusBadge(status: string, copy: VisitReportCopy = VISIT_REPORT_COPY.fr) {
  const bg: Record<string, string> = { open: '#FEF2F2', in_progress: '#EFF6FF', waiting: '#FFFBEB', verification: '#F5F3FF', closed: '#ECFDF5' };
  return `<span class="badge" style="background:${bg[status] ?? '#F9FAFB'};color:${RESERVE_STATUS_COLORS[status] ?? '#6B7280'}">${escapeHtml(copy.reserveStatus[status] ?? RESERVE_STATUS_LABELS[status] ?? status)}</span>`;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function buildVisitePDF(
  visite: Visite,
  reserves: Reserve[],
  projectName: string,
  reservePhotoMap?: Map<string, string[]>,
  coverPhotoDataUrl?: string | null,
  language: VisitReportLanguage = 'fr',
): string {
  const copy = VISIT_REPORT_COPY[language] ?? VISIT_REPORT_COPY.fr;
  const totalOpen = reserves.filter(r => r.status === 'open').length;
  const totalInProgress = reserves.filter(r => r.status === 'in_progress').length;
  const totalWaiting = reserves.filter(r => r.status === 'waiting').length;
  const totalVerification = reserves.filter(r => r.status === 'verification').length;
  const totalClosed = reserves.filter(r => r.status === 'closed').length;
  const totalCritical = reserves.filter(r => r.priority === 'critical' || r.priority === 'high').length;
  const totalOverdue = reserves.filter(isReserveOverdue).length;
  const companiesCount = new Set(reserves.flatMap(reserveCompanies)).size;

  const sortedReserves = [...reserves].sort((a, b) => {
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
      || parseDateValue(a.deadline) - parseDateValue(b.deadline)
      || a.id.localeCompare(b.id, language);
  });

  const docRef = `CR-${visite.id}`;
  const statusVisiteLabel = copy.visitStatus[visite.status] ?? copy.visitStatus.planned;
  const horaire = [visite.startTime, visite.endTime].filter(Boolean).join(' → ');
  const visiteLocationValue = visite.visitedLocations?.length
    ? visite.visitedLocations.map(loc => loc.buildingName).join(' — ')
    : [visite.building, visite.level, visite.zone].filter(Boolean).join(' — ');
  const checklistTotal = visite.checklistItems?.length ?? 0;
  const checklistDone = visite.checklistItems?.filter(item => item.checked).length ?? 0;
  const checklistPct = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0;

  const infoItems = [
    { label: copy.infoVisitType, value: visite.visitType ? copy.visitTypes[visite.visitType] ?? visite.visitType : copy.visitDefaultType },
    { label: copy.infoConductor, value: visite.conducteur },
    { label: copy.infoVisitDate, value: visite.date + (horaire ? `  ·  ${horaire}` : '') },
    ...(visiteLocationValue ? [{ label: visite.visitedLocations?.length ? copy.infoVisitScope : copy.infoLocation, value: visiteLocationValue }] : []),
    { label: copy.infoVisitStatus, value: statusVisiteLabel },
    ...(visite.reserveDeadlineDate ? [{ label: copy.infoDeadline, value: visite.reserveDeadlineDate }] : []),
    ...(visite.tags && visite.tags.length > 0 ? [{ label: copy.infoTags, value: visite.tags.join(', ') }] : []),
  ];

  const localStyles = `
    <style>
      .visit-cover { width:100%; max-height:260px; object-fit:cover; border-radius:12px; border:1.5px solid #DDE4EE; margin-bottom:18px; }
      .summary-grid { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:18px; }
      .summary-card { flex:1; min-width:220px; border:1.5px solid #DDE4EE; border-radius:10px; padding:13px 15px; background:#FAFBFF; page-break-inside:avoid; }
      .summary-card strong { display:block; font-size:13px; color:#1A2742; margin-bottom:4px; }
      .summary-card span { display:block; font-size:11px; color:#6B7280; line-height:1.5; }
      .note-box { background:#F4F7FB; border-left:4px solid #003082; border-radius:0 10px 10px 0; padding:14px 18px; font-size:13px; color:#1A2742; line-height:1.6; margin-bottom:18px; }
      .building-block { border:1.5px solid #DDE4EE; border-radius:12px; margin-bottom:16px; overflow:hidden; page-break-inside:avoid; }
      .building-title { background:#F4F7FB; padding:11px 14px; font-size:14px; font-weight:800; color:#003082; display:flex; justify-content:space-between; gap:10px; }
      .building-count { font-size:11px; color:#6B7280; font-weight:700; }
      .zone-block { padding:12px 14px; border-top:1px solid #DDE4EE; }
      .zone-title { font-size:12px; font-weight:800; color:#1A2742; margin-bottom:8px; }
      .company-title { font-size:10px; text-transform:uppercase; letter-spacing:.6px; color:#6B7280; font-weight:800; margin:10px 0 6px; }
      .action-list { margin-left:16px; }
      .action-list li { margin-bottom:8px; padding-left:3px; }
      .action-title { font-size:12px; font-weight:700; color:#1A2742; }
      .action-meta { font-size:10px; color:#6B7280; margin-top:2px; }
      .action-desc { font-size:11px; color:#334155; margin-top:3px; line-height:1.45; }
      .plan-card { border:1.5px solid #DDE4EE; border-radius:10px; padding:12px 14px; margin-bottom:10px; page-break-inside:avoid; }
      .plan-title { font-size:12px; font-weight:800; color:#1A2742; margin-bottom:4px; }
      .plan-meta { font-size:10px; color:#6B7280; }
      .check-row { display:flex; align-items:flex-start; gap:9px; padding:7px 10px; border-bottom:1px solid #EEF3FA; }
      .check-box { display:inline-block; width:14px; height:14px; border-radius:3px; text-align:center; line-height:12px; font-size:10px; color:#fff; flex-shrink:0; }
      .check-label { font-size:12px; color:#1A2742; line-height:1.35; }
      .muted-empty { padding:18px; text-align:center; color:#6B7280; background:#F9FAFB; border:1px dashed #DDE4EE; border-radius:10px; }
    </style>
  `;

  const reservesWithDeadlineCount = sortedReserves.filter(r => reserveDeadlineValue(r, copy) !== copy.noDeadline).length;
  const summaryCards = [
    {
      title: copy.priorityCardTitle,
      text: totalCritical > 0 ? copy.priorityHighText(totalCritical) : copy.priorityNoneText,
    },
    {
      title: copy.deadlineCardTitle,
      text: totalOverdue > 0 ? copy.overdueText(totalOverdue) : copy.deadlineFilledText(reservesWithDeadlineCount),
    },
    {
      title: copy.companiesCardTitle,
      text: companiesCount > 0 ? copy.companiesText(companiesCount) : copy.companiesNoneText,
    },
    {
      title: copy.checklistCardTitle,
      text: checklistTotal > 0 ? copy.checklistText(checklistDone, checklistTotal, checklistPct) : copy.checklistNoneText,
    },
  ];

  const executiveSection = `
    <div class="section-header">${escapeHtml(copy.executiveTitle)}</div>
    <div class="summary-grid">
      ${summaryCards.map(card => `
        <div class="summary-card">
          <strong>${escapeHtml(card.title)}</strong>
          <span>${escapeHtml(card.text)}</span>
        </div>
      `).join('')}
    </div>
  `;

  const deadlineRows = sortedReserves
    .filter(r => reserveDeadlineValue(r, copy) !== copy.noDeadline)
    .sort((a, b) => parseDateValue(a.deadline) - parseDateValue(b.deadline))
    .map((r, i) => `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#F9FAFB'}">
        <td style="white-space:nowrap;font-weight:700">${htmlText(r.deadline)}</td>
        <td>${escapeHtml(reserveLocationLabel(r, copy))}</td>
        <td><strong>${escapeHtml(r.id)}</strong> — ${escapeHtml(r.title)}<br/><span style="color:#6B7280">${escapeHtml(getReserveDescriptionText(r.description, r.title, ''))}</span></td>
        <td>${escapeHtml(reserveCompanyLabel(r, copy))}</td>
        <td>${reserveStatusBadge(r.status, copy)}</td>
      </tr>
    `).join('');

  const deadlinesSection = `
    <div class="section-header">${escapeHtml(copy.deadlinesTitle)}</div>
    <table>
      <thead><tr>${copy.deadlineTableHeaders.map(label => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
      <tbody>${deadlineRows || `<tr><td colspan="5" class="muted-empty">${escapeHtml(copy.noDeadlineRows)}</td></tr>`}</tbody>
    </table>
  `;

  const buildingMap = new Map<string, Map<string, Map<string, Reserve[]>>>();
  sortedReserves.forEach(reserve => {
    const building = cleanValue(reserve.building, copy.noBuilding);
    const zone = [reserve.level, reserve.zone].map(v => cleanValue(v, '')).filter(Boolean).join(' · ') || copy.noZone;
    const company = reserveCompanyLabel(reserve, copy);
    if (!buildingMap.has(building)) buildingMap.set(building, new Map());
    const zoneMap = buildingMap.get(building)!;
    if (!zoneMap.has(zone)) zoneMap.set(zone, new Map());
    const companyMap = zoneMap.get(zone)!;
    if (!companyMap.has(company)) companyMap.set(company, []);
    companyMap.get(company)!.push(reserve);
  });

  const actionsByBuildingSection = `
    <div class="section-header">${escapeHtml(copy.actionsTitle)}</div>
    ${buildingMap.size === 0 ? `<div class="muted-empty">${escapeHtml(copy.noActions)}</div>` : Array.from(buildingMap.entries()).map(([building, zoneMap]) => {
      const buildingCount = Array.from(zoneMap.values()).reduce((acc, companyMap) => (
        acc + Array.from(companyMap.values()).reduce((sum, list) => sum + list.length, 0)
      ), 0);
      return `
        <div class="building-block">
          <div class="building-title">
            <span>${escapeHtml(building)}</span>
            <span class="building-count">${escapeHtml(copy.actionCount(buildingCount))}</span>
          </div>
          ${Array.from(zoneMap.entries()).map(([zone, companyMap]) => `
            <div class="zone-block">
              <div class="zone-title">${escapeHtml(zone)}</div>
              ${Array.from(companyMap.entries()).map(([company, items]) => `
                <div class="company-title">${escapeHtml(company)}</div>
                <ul class="action-list">
                  ${items.map(r => `
                    <li>
                      <div class="action-title">${escapeHtml(r.id)} — ${escapeHtml(r.title)} ${reservePriorityBadge(r.priority, copy)} ${reserveStatusBadge(r.status, copy)}</div>
                      <div class="action-desc">${escapeHtml(getReserveDescriptionText(r.description, r.title, ''))}</div>
                      <div class="action-meta">${escapeHtml(copy.deadlineMeta)} : ${htmlText(reserveDeadlineValue(r, copy))}${r.planId ? ` · ${escapeHtml(copy.planMeta)} : ${htmlText(r.planId)}` : ''}${r.planX != null && r.planY != null ? ` · ${escapeHtml(copy.pinPositioned)}` : ''}</div>
                    </li>
                  `).join('')}
                </ul>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `;
    }).join('')}
  `;

  const reserveRows = sortedReserves.map((r, idx) => `
    <tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="font-weight:700;white-space:nowrap">${escapeHtml(r.id)}</td>
      <td><strong>${escapeHtml(r.title)}</strong><br/><span style="color:#6B7280">${escapeHtml(getReserveDescriptionText(r.description, r.title, ''))}</span></td>
      <td>${escapeHtml(reserveLocationLabel(r, copy))}</td>
      <td>${escapeHtml(reserveCompanyLabel(r, copy))}</td>
      <td style="text-align:center">${reservePriorityBadge(r.priority, copy)}</td>
      <td style="text-align:center">${reserveStatusBadge(r.status, copy)}</td>
      <td style="white-space:nowrap">${htmlText(reserveDeadlineValue(r, copy))}</td>
    </tr>
  `).join('');

  const reservesSection = `
    <div class="section-header">${escapeHtml(copy.reservesTitle(reserves.length))}</div>
    <table>
      <thead>
        <tr>
          ${copy.reserveTableHeaders.map((label, index) => `<th${index === 4 || index === 5 ? ' style="text-align:center"' : ''}>${escapeHtml(label)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>${reserveRows || `<tr><td colspan="7" class="muted-empty">${escapeHtml(copy.noReserves)}</td></tr>`}</tbody>
    </table>
  `;

  const planMap = new Map<string, Reserve[]>();
  sortedReserves.forEach(reserve => {
    const planKey = reserve.planId || visite.defaultPlanId || copy.noPlan;
    if (!planMap.has(planKey)) planMap.set(planKey, []);
    planMap.get(planKey)!.push(reserve);
  });
  const plansSection = planMap.size > 0 ? `
    <div class="section-header">${escapeHtml(copy.plansTitle)}</div>
    ${Array.from(planMap.entries()).map(([plan, items]) => {
      const pinnedCount = items.filter(r => r.planX != null && r.planY != null).length;
      return `
        <div class="plan-card">
          <div class="plan-title">${escapeHtml(plan)}</div>
          <div class="plan-meta">${escapeHtml(copy.planSummary(items.length, pinnedCount))}</div>
          <div style="font-size:11px;color:#1A2742;margin-top:7px">${items.map(r => `${escapeHtml(r.id)} — ${escapeHtml(r.title)}`).join('<br/>')}</div>
        </div>
      `;
    }).join('')}
  ` : '';

  const statusCounts = countBy(reserves, r => r.status);
  const companyCounts = countBy(reserves.flatMap(r => reserveCompanies(r).length ? reserveCompanies(r) : [copy.noCompany]), name => name);
  const statusDistribution = Object.entries(statusCounts).map(([status, count]) => `${copy.reserveStatus[status] ?? RESERVE_STATUS_LABELS[status] ?? status} : ${count}`).join(' · ') || copy.noReserveDistribution;
  const companyDistribution = Object.entries(companyCounts).map(([company, count]) => `${company} : ${count}`).join(' · ') || copy.noCompanyDistribution;
  const pilotageSection = `
    <div class="section-header">${escapeHtml(copy.pilotageTitle)}</div>
    <div class="summary-grid">
      <div class="summary-card">
        <strong>${escapeHtml(copy.statusDistributionTitle)}</strong>
        <span>${escapeHtml(statusDistribution)}</span>
      </div>
      <div class="summary-card">
        <strong>${escapeHtml(copy.companyDistributionTitle)}</strong>
        <span>${escapeHtml(companyDistribution)}</span>
      </div>
    </div>
  `;

  const participantsSection = visite.participants && visite.participants.length > 0
    ? `<div class="section-header">${escapeHtml(copy.participantsTitle(visite.participants.length))}</div>
       <table>
         <thead><tr>${copy.participantHeaders.map(label => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
         <tbody>${visite.participants.map((p, i) =>
           `<tr style="background:${i % 2 === 0 ? '#fff' : '#F9FAFB'}">
             <td style="font-weight:600">${htmlText(p.name)}</td>
             <td>${htmlText(p.role)}</td>
             <td>${htmlText(p.company)}</td>
           </tr>`
         ).join('')}</tbody>
       </table>`
    : '';

  const checklistSection = visite.checklistItems && visite.checklistItems.length > 0
    ? `<div class="section-header">${escapeHtml(copy.checklistSectionTitle(checklistDone, checklistTotal, checklistPct))}</div>
       <div style="margin-bottom:20px;border:1px solid #DDE4EE;border-radius:10px;overflow:hidden">
         ${visite.checklistItems.map(item => `
           <div class="check-row">
             <span class="check-box" style="border:1.5px solid ${item.checked ? '#059669' : '#CBD5E1'};background:${item.checked ? '#059669' : 'transparent'}">${item.checked ? '✓' : ''}</span>
             <span class="check-label" style="${item.checked ? 'color:#6B7280;text-decoration:line-through' : ''}">${htmlText(item.label, '')}</span>
           </div>
         `).join('')}
       </div>`
    : '';

  const reservesWithPhotos = reservePhotoMap && reservePhotoMap.size > 0
    ? sortedReserves.filter(r => (reservePhotoMap.get(r.id)?.length ?? 0) > 0)
    : [];
  const photoCount = reservesWithPhotos.reduce((acc, r) => acc + (reservePhotoMap?.get(r.id)?.length ?? 0), 0);
  const photoGallery = reservesWithPhotos.length > 0
    ? `<div class="section-header">${escapeHtml(copy.photoSectionTitle(photoCount))}</div>
       ${reservesWithPhotos.map(r => {
          const srcs = reservePhotoMap?.get(r.id) ?? [];
          const rawPhotos = getReservePdfPhotos(r);
          return `<div style="margin-bottom:18px;padding:12px 16px;border:1.5px solid #DDE4EE;border-radius:10px;page-break-inside:avoid">
            <div style="font-size:11px;font-weight:700;color:#1A2742;margin-bottom:6px">${escapeHtml(r.id)} — ${escapeHtml(r.title)} <span style="color:#6B7280;font-weight:400">· ${escapeHtml(reserveCompanyLabel(r, copy))} · ${escapeHtml(reserveLocationLabel(r, copy))}</span></div>
            ${buildPhotoGrid(srcs.slice(0, 4).map((src, i) => ({
              src,
              badge: (rawPhotos[i]?.kind === 'resolution') ? copy.photoResolutionBadge : copy.photoObservationBadge,
              badgeColor: (rawPhotos[i]?.kind === 'resolution') ? '#ECFDF5' : '#FEF2F2',
              badgeTextColor: (rawPhotos[i]?.kind === 'resolution') ? '#059669' : '#DC2626',
              caption: [rawPhotos[i]?.label, rawPhotos[i]?.takenBy, rawPhotos[i]?.takenAt].filter(Boolean).join(' · '),
              annotations: rawPhotos[i]?.annotations,
            })), copy.photoGridTitle(Math.min(srcs.length, 4)))}
          </div>`;
        }).join('')}`
    : '';

  const conducteurSigHtml = visite.conducteurSignature
    ? `<img src="${svgStringToDataUrl(visite.conducteurSignature)}" style="height:70px;width:100%;object-fit:contain;border-bottom:2px solid #1A2742;margin-bottom:8px;display:block" />`
    : '<div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>';
  const entrepriseSigHtml = visite.entrepriseSignature
    ? `<img src="${svgStringToDataUrl(visite.entrepriseSignature)}" style="height:70px;width:100%;object-fit:contain;border-bottom:2px solid #1A2742;margin-bottom:8px;display:block" />`
    : '<div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>';

  const signaturesSection = `
    <div class="section-header">${escapeHtml(copy.signaturesTitle)}</div>
    <div class="sig-row">
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(copy.signatureConductor)}</div>
        ${conducteurSigHtml}
        <div class="sig-name">${htmlText(visite.conducteur)}</div>
        <div class="sig-date">${escapeHtml(copy.signatureDate)} : ${htmlText(visite.signedAt ? formatDate(visite.signedAt) : visite.date)}</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(copy.signatureCompany)}</div>
        ${entrepriseSigHtml}
        <div class="sig-name">${htmlText(visite.entrepriseSignataire, '')}</div>
        <div class="sig-date">${escapeHtml(copy.signatureDate)} : ${htmlText(visite.signedAt ? formatDate(visite.signedAt) : '', '')}</div>
      </div>
    </div>
  `;

  const body = `
    ${localStyles}
    ${buildLetterhead(copy.letterheadTitle, visite.title, docRef, visite.date, projectName, {
      tagline: copy.letterheadTagline,
      projectLabel: copy.projectLabel,
      refLabel: copy.refLabel,
      dateLabel: copy.dateLabel,
    })}
    ${coverPhotoDataUrl ? `<img class="visit-cover" src="${coverPhotoDataUrl}" />` : ''}
    ${buildInfoGrid(infoItems)}
    ${buildKpiRow([
      { val: reserves.length, label: copy.kpiReserves, color: '#1A2742' },
      { val: totalOpen, label: copy.kpiOpen, color: '#DC2626' },
      { val: totalInProgress, label: copy.kpiInProgress, color: '#2563EB' },
      { val: totalWaiting + totalVerification, label: copy.kpiToValidate, color: '#7C3AED' },
      { val: totalClosed, label: copy.kpiClosed, color: '#059669' },
      ...(totalOverdue > 0 ? [{ val: totalOverdue, label: copy.kpiOverdue, color: '#B91C1C' }] : []),
    ])}
    ${executiveSection}
    ${deadlinesSection}
    ${participantsSection}
    ${visite.notes ? `
      <div class="section-header">${escapeHtml(copy.decisionsTitle)}</div>
      <div class="note-box">${htmlMultiline(visite.notes)}</div>
    ` : ''}
    ${actionsByBuildingSection}
    ${reservesSection}
    ${plansSection}
    ${checklistSection}
    ${pilotageSection}
    ${photoGallery}
    ${signaturesSection}
    ${buildDocFooter(projectName, {
      generatedBy: copy.footerGeneratedBy,
      confidential: copy.footerConfidential,
      locale: copy.locale,
    })}
  `;

  return wrapHTML(body, `${copy.windowTitlePrefix} — ${visite.title}`);
}

export default function VisiteDetailScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { effectiveLanguage } = useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    visites,
    reserves,
    updateVisite,
    deleteVisite,
    deleteReserve,
    archiveReserve,
    unarchiveReserve,
    attachReservesToVisite,
    unlinkReservesFromVisite,
    activeChantier,
    oprs,
    photos,
  } = useApp();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();

  const [signModalVisible, setSignModalVisible] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [signingTab, setSigningTab] = useState<'conducteur' | 'entreprise'>('conducteur');
  const [entrepriseSignataire, setEntrepriseSignataire] = useState('');
  const [isSigning, setIsSigning] = useState(false);
  const conducteurSigRef = useRef<SignaturePadRef>(null);
  const entrepriseSigRef = useRef<SignaturePadRef>(null);

  const [editLocModal, setEditLocModal] = useState(false);
  const [editBuilding, setEditBuilding] = useState('');
  const [editLevel, setEditLevel] = useState('');
  const [editZone, setEditZone] = useState('');
  const [attachModalVisible, setAttachModalVisible] = useState(false);
  const [attachSearch, setAttachSearch] = useState('');
  const [attachSelectedIds, setAttachSelectedIds] = useState<string[]>([]);
  const [attachScopeOnly, setAttachScopeOnly] = useState(true);
  const [attachSubmitting, setAttachSubmitting] = useState(false);
  const [reserveVisitActionLoadingId, setReserveVisitActionLoadingId] = useState<string | null>(null);
  const [reportLanguage, setReportLanguage] = useState<VisitReportLanguage>(effectiveLanguage as VisitReportLanguage);

  const visite = visites.find(v => v.id === id);
  const visiteReserveIds = useMemo(() => new Set(visite?.reserveIds ?? []), [visite?.reserveIds]);
  const visitedBuildingNames = useMemo(() => {
    const names = new Set<string>();
    visite?.visitedLocations?.forEach(loc => {
      if (loc.buildingName) names.add(loc.buildingName);
    });
    if (visite?.building) names.add(visite.building);
    return names;
  }, [visite?.visitedLocations, visite?.building]);
  const visiteReserves = useMemo(
    () => enrichReserveListForPdf(
      reserves.filter(r => !!visite && (visiteReserveIds.has(r.id) || r.visiteId === visite.id)),
      photos
    ),
    [reserves, visite, visiteReserveIds, photos]
  );
  const attachableReserves = useMemo(() => {
    if (!visite) return [];
    const query = attachSearch.trim().toLowerCase();
    return reserves
      .filter(r => {
        if (visiteReserveIds.has(r.id) || r.visiteId === visite.id) return false;
        if (visite.chantierId && r.chantierId && r.chantierId !== visite.chantierId) return false;
        if (attachScopeOnly && visitedBuildingNames.size > 0 && r.building && !visitedBuildingNames.has(r.building)) return false;
        if (!query) return true;
        const haystack = [
          r.id,
          r.title,
          r.description,
          r.company,
          ...(r.companies ?? []),
          r.building,
          r.level,
          r.zone,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const aMoved = (a.visiteId || visites.some(v => v.id !== visite.id && (v.reserveIds ?? []).includes(a.id))) ? 1 : 0;
        const bMoved = (b.visiteId || visites.some(v => v.id !== visite.id && (v.reserveIds ?? []).includes(b.id))) ? 1 : 0;
        if (aMoved !== bMoved) return aMoved - bMoved;
        const aScope = visitedBuildingNames.has(a.building) ? 0 : 1;
        const bScope = visitedBuildingNames.has(b.building) ? 0 : 1;
        if (aScope !== bScope) return aScope - bScope;
        return a.id.localeCompare(b.id);
      });
  }, [reserves, visites, visite, visiteReserveIds, attachSearch, attachScopeOnly, visitedBuildingNames]);

  const tunnelData = useMemo(() => {
    if (!visite) return null;
    const total = visiteReserves.length;
    const closed = visiteReserves.filter(r => r.status === 'closed').length;
    const pctLevees = total > 0 ? Math.round((closed / total) * 100) : 0;
    const chantierId = visite.chantierId ?? activeChantier?.id;
    const chantierOprs = oprs.filter(o => !chantierId || o.chantierId === chantierId);
    const signedOpr = chantierOprs.find(o => o.status === 'signed');
    const anyOpr = chantierOprs.length > 0;
    return { total, closed, pctLevees, anyOpr, signedOpr };
  }, [visite, visiteReserves, oprs, activeChantier]);

  if (user?.role === 'sous_traitant') {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, marginBottom: 8 }}>{t('visits.detail.restrictedTitle')}</Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginBottom: 24 }}>
          {t('visits.detail.restrictedText')}
        </Text>
        <TouchableOpacity onPress={() => goBack()} style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40' }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary }}>{t('visits.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!visite) {
    return (
      <View style={styles.container}>
        <Header title={t('visits.detail.headerFallback')} showBack />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={40} color={C.textMuted} />
          <Text style={styles.notFoundText}>{t('visits.detail.notFound')}</Text>
        </View>
      </View>
    );
  }

  const cfg = STATUS_CFG[visite.status];
  const reportCopy = VISIT_REPORT_COPY[reportLanguage];
  const visiteLocationDisplay = visite.visitedLocations?.length
    ? visite.visitedLocations.map(loc => loc.buildingName).join(' — ')
    : [visite.building, visite.level, visite.zone].filter(Boolean).join(' — ');

  function setVisitStatus(next: VisiteStatus) {
    if (!visite) return;
    updateVisite({ ...visite, id: visite.id!, status: next });
    setStatusModalVisible(false);
  }

  function toggleChecklistItem(itemId: string) {
    if (!visite || !permissions.canEdit || !visite.checklistItems) return;
    updateVisite({
      ...visite,
      id: visite.id!,
      status: visite.status === 'planned' ? 'in_progress' : visite.status,
      checklistItems: visite.checklistItems.map(item =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      ),
    });
  }

  function handleDelete() {
    if (!visite) return;
    showAlert(t('visits.deleteTitle'), t('visits.deleteText', { title: visite.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive', onPress: () => {
          deleteVisite(visite.id!);
          goBack();
        },
      },
    ]);
  }

  async function handleSaveSignature() {
    if (!visite) return;
    if (isSigning) return;
    setIsSigning(true);
    try {
      const conducteurSig = conducteurSigRef.current?.getSVGData() ?? visite.conducteurSignature ?? null;
      const entrepriseSig = entrepriseSigRef.current?.getSVGData() ?? visite.entrepriseSignature ?? null;
      const signataire = entrepriseSignataire.trim() || visite.entrepriseSignataire;
      if (!conducteurSig && !entrepriseSig) {
        showAlert(t('visits.detail.signatureRequiredTitle'), t('visits.detail.signatureRequiredText'));
        return;
      }
      if (entrepriseSig && !signataire) {
        showAlert(t('visits.detail.signerRequiredTitle'), t('visits.detail.signerRequiredText'));
        setSigningTab('entreprise');
        return;
      }
      const today = nowTimestampFR();
      updateVisite({
        ...visite,
        id: visite.id!,
        conducteurSignature: conducteurSig ?? undefined,
        entrepriseSignature: entrepriseSig ?? undefined,
        signedAt: today,
        entrepriseSignataire: signataire,
        status: 'completed',
      });
      setSignModalVisible(false);
      showAlert(t('visits.detail.signedTitle'), t('visits.detail.signedText'));
    } finally {
      setIsSigning(false);
    }
  }

  function openEditLoc() {
    if (!visite) return;
    setEditBuilding(visite.building ?? '');
    setEditLevel(visite.level ?? '');
    setEditZone(visite.zone ?? '');
    setEditLocModal(true);
  }

  function saveEditLoc() {
    if (!visite) return;
    updateVisite({ ...visite, id: visite.id!, building: editBuilding || undefined, level: editLevel || undefined, zone: editZone || undefined });
    setEditLocModal(false);
  }

  function openAttachModal() {
    setAttachSearch('');
    setAttachSelectedIds([]);
    setAttachScopeOnly(true);
    setAttachModalVisible(true);
  }

  function toggleAttachReserve(reserveId: string) {
    setAttachSelectedIds(prev =>
      prev.includes(reserveId)
        ? prev.filter(id => id !== reserveId)
        : [...prev, reserveId]
    );
  }

  async function applyAttachReserves(forceMove = false) {
    if (attachSubmitting) return;
    if (!visite || attachSelectedIds.length === 0) return;
    const selected = reserves.filter(r => attachSelectedIds.includes(r.id));
    if (selected.length === 0) return;
    const selectedIds = selected.map(r => r.id);

    const reservesAlreadyInOtherVisit = selected.filter(r =>
      (r.visiteId && r.visiteId !== visite.id)
      || visites.some(v => v.id !== visite.id && (v.reserveIds ?? []).includes(r.id))
    );
    if (reservesAlreadyInOtherVisit.length > 0 && !forceMove) {
      showAlert(
        t('visits.detail.moveReservesTitle'),
        t('visits.detail.moveReservesText', { count: reservesAlreadyInOtherVisit.length }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('visits.detail.move'), style: 'destructive', onPress: () => { void applyAttachReserves(true); } },
        ]
      );
      return;
    }

    setAttachSubmitting(true);
    try {
      const result = await attachReservesToVisite(visite.id, selectedIds);
      if (!result.success) {
        showAlert(t('visits.detail.attachImpossibleTitle'), result.error ?? t('visits.detail.attachImpossibleText'));
        return;
      }

      setAttachSelectedIds([]);
      setAttachSearch('');
      setAttachModalVisible(false);
      showAlert(
        result.queued ? t('visits.detail.attachQueuedTitle') : t('visits.detail.attachDoneTitle'),
        result.queued
          ? t('visits.detail.attachQueuedText', { count: selected.length })
          : t('visits.detail.attachDoneText', { count: selected.length })
      );
    } finally {
      setAttachSubmitting(false);
    }
  }

  async function removeReserveFromVisit(reserve: Reserve) {
    if (!visite || reserveVisitActionLoadingId) return;
    setReserveVisitActionLoadingId(reserve.id);
    try {
      const result = await unlinkReservesFromVisite(visite.id, [reserve.id]);
      if (!result.success) {
        showAlert(t('visits.detail.unlinkImpossibleTitle'), result.error ?? t('visits.detail.unlinkImpossibleText'));
        return;
      }
      showAlert(
        result.queued ? t('visits.detail.unlinkQueuedTitle') : t('visits.detail.unlinkDoneTitle'),
        result.queued
          ? t('visits.detail.unlinkQueuedText')
          : t('visits.detail.unlinkDoneText')
      );
    } finally {
      setReserveVisitActionLoadingId(null);
    }
  }

  function confirmRemoveReserveFromVisit(reserve: Reserve) {
    showAlert(
      t('visits.detail.removeFromVisitTitle'),
      t('visits.detail.removeFromVisitText', { title: reserve.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('visits.detail.remove'), style: 'destructive', onPress: () => { void removeReserveFromVisit(reserve); } },
      ],
    );
  }

  function toggleArchiveReserveFromVisit(reserve: Reserve) {
    if (reserve.archivedAt) {
      showAlert(
        t('visits.detail.unarchiveReserveTitle'),
        t('visits.detail.unarchiveReserveText', { title: reserve.title }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('visits.detail.unarchive'), onPress: () => unarchiveReserve(reserve.id, user?.name ?? t('visits.detail.defaultConductor')) },
        ],
      );
      return;
    }

    showAlert(
      t('visits.detail.archiveReserveTitle'),
      t('visits.detail.archiveReserveText', { title: reserve.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('visits.detail.archive'), style: 'destructive', onPress: () => archiveReserve(reserve.id, user?.name ?? t('visits.detail.defaultConductor')) },
      ],
    );
  }

  function confirmDeleteReserveFromVisit(reserve: Reserve) {
    showAlert(
      t('visits.detail.deleteReserveForeverTitle'),
      t('visits.detail.deleteReserveForeverText', { title: reserve.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => deleteReserve(reserve.id) },
      ],
    );
  }

  function openReserveVisitActions(reserve: Reserve) {
    const buttons: any[] = [
      { text: t('visits.detail.openReserve'), onPress: () => router.push(`/reserve/${reserve.id}` as any) },
      { text: t('visits.detail.removeFromVisitTitle'), style: 'destructive', onPress: () => confirmRemoveReserveFromVisit(reserve) },
      {
        text: reserve.archivedAt ? t('visits.detail.unarchiveReserveTitle') : t('visits.detail.archiveReserveTitle'),
        onPress: () => toggleArchiveReserveFromVisit(reserve),
      },
    ];
    if (permissions.canDelete) {
      buttons.push({ text: t('visits.detail.deleteReserveForeverTitle'), style: 'destructive', onPress: () => confirmDeleteReserveFromVisit(reserve) });
    }
    buttons.push({ text: t('common.cancel'), style: 'cancel' });
    showAlert(reserve.id, reserve.title, buttons);
  }

  function renderAttachReserve({ item: reserve }: { item: Reserve }) {
    if (!visite) return null;
    const visiteId = visite.id;
    const selected = attachSelectedIds.includes(reserve.id);
    const statusColor = RESERVE_STATUS_COLORS[reserve.status] ?? C.textMuted;
    const priorityColor = PRIORITY_COLORS[reserve.priority] ?? C.textMuted;
    const alreadyLinked =
      (!!reserve.visiteId && reserve.visiteId !== visiteId)
      || visites.some(v => v.id !== visiteId && (v.reserveIds ?? []).includes(reserve.id));
    const meta = [reserve.building, reserve.level, reserve.zone].filter(Boolean).join(' · ');

    return (
      <TouchableOpacity
        style={[styles.attachReserveRow, selected && styles.attachReserveRowSelected]}
        onPress={() => toggleAttachReserve(reserve.id)}
        activeOpacity={0.8}
      >
        <View style={[styles.attachCheckbox, selected && styles.attachCheckboxSelected]}>
          {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
        <View style={styles.attachReserveBody}>
          <View style={styles.attachReserveTopRow}>
            <Text style={styles.attachReserveId}>{reserve.id}</Text>
            <View style={[styles.attachStatusBadge, { backgroundColor: statusColor + '18' }]}>
              <Text style={[styles.attachStatusText, { color: statusColor }]}>
                {t(`reserveLabels.status.${reserve.status}`, { defaultValue: RESERVE_STATUS_LABELS[reserve.status] ?? reserve.status })}
              </Text>
            </View>
          </View>
          <Text style={styles.attachReserveTitle} numberOfLines={2}>{reserve.title}</Text>
          <View style={styles.attachReserveMetaRow}>
            <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
            <Text style={styles.attachReserveMeta} numberOfLines={1}>
              {[t(`reserveLabels.priority.${reserve.priority}`, { defaultValue: PRIORITY_LABELS[reserve.priority] ?? reserve.priority }), reserveCompanyLabel(reserve), meta].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {alreadyLinked && (
            <View style={styles.attachMoveBadge}>
              <Ionicons name="swap-horizontal-outline" size={12} color={C.waiting} />
              <Text style={styles.attachMoveBadgeText}>{t('visits.detail.alreadyLinked')}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  async function exportPDF(language: VisitReportLanguage = reportLanguage) {
    if (!visite) return;
    try {
      const reservePhotoMap = new Map<string, string[]>();
      await Promise.all(
        visiteReserves.map(async r => {
          const rawPhotos = getReservePdfPhotos(r);
          if (rawPhotos.length > 0) {
            const srcs = (await Promise.all(rawPhotos.slice(0, 4).map(p => loadPhotoAsDataUrlForPdf(p.uri))))
              .filter((src): src is string => typeof src === 'string');
            reservePhotoMap.set(r.id, srcs);
          }
        })
      );
      const coverPhotoDataUrl = visite.coverPhotoUri
        ? await loadPhotoAsDataUrlForPdf(visite.coverPhotoUri)
        : null;
      const html = buildVisitePDF(visite, visiteReserves, projectName, reservePhotoMap, coverPhotoDataUrl, language);
      await exportPDFHelper(html, buildPdfFilename(`CR_Visite_${language.toUpperCase()}`, [visite.title, visite.level, projectName]));
    } catch (e: any) {
      showAlert(t('common.error'), e?.message ?? t('visits.detail.pdfError'));
    }
  }

  return (
    <View style={styles.container}>
      <Header
        title={visite.title}
        subtitle={visite.date}
        showBack
        rightIcon={permissions.canExport ? 'download-outline' : undefined}
        onRightPress={permissions.canExport ? () => exportPDF(reportLanguage) : undefined}
      />

      <PageContainer maxWidth={1000}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Cover photo */}
        {visite.coverPhotoUri ? (
          <View style={styles.coverPhotoCard}>
            <Image source={{ uri: visite.coverPhotoUri }} style={styles.coverPhoto} resizeMode="cover" />
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <TouchableOpacity
              style={[styles.statusPill, { backgroundColor: cfg.color + '20', borderColor: cfg.color }]}
              onPress={permissions.canEdit ? () => setStatusModalVisible(true) : undefined}
            >
              <Text style={[styles.statusText, { color: cfg.color }]}>{t(`visits.status.${visite.status}`)}</Text>
              {permissions.canEdit && <Ionicons name="chevron-down" size={12} color={cfg.color} />}
            </TouchableOpacity>
            {permissions.canDelete && (
              <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={16} color={C.open} />
                <Text style={styles.deleteBtnText}>{t('common.delete')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoItem}>
              <Ionicons name="person-outline" size={14} color={C.textMuted} />
              <View>
                <Text style={styles.infoLabel}>{t('visits.detail.conductor')}</Text>
                <Text style={styles.infoVal}>{visite.conducteur}</Text>
              </View>
            </View>
            <View style={styles.infoItem}>
              <Ionicons name="calendar-outline" size={14} color={C.textMuted} />
              <View>
                <Text style={styles.infoLabel}>{t('visits.new.date')}</Text>
                <Text style={styles.infoVal}>
                  {visite.date}
                  {(visite.startTime || visite.endTime)
                    ? `  ·  ${[visite.startTime, visite.endTime].filter(Boolean).join(' → ')}`
                    : ''}
                </Text>
              </View>
            </View>
            <View style={styles.infoItem}>
              <Ionicons name="business-outline" size={14} color={C.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>{visite.visitedLocations?.length ? t('visits.detail.visitScope') : t('visits.detail.location')}</Text>
                <Text style={styles.infoVal}>
                  {visiteLocationDisplay || '—'}
                </Text>
              </View>
              {permissions.canEdit && !visite.visitedLocations?.length && (
                <TouchableOpacity onPress={openEditLoc} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="pencil-outline" size={14} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            {visite.defaultPlanId ? (
              <View style={styles.infoItem}>
              <Ionicons name="map-outline" size={14} color={C.textMuted} />
              <View>
                  <Text style={styles.infoLabel}>{t('visits.detail.referencePlan')}</Text>
                  <Text style={styles.infoVal}>{visite.defaultPlanId}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {visite.reserveDeadlineDate && (
            <View style={styles.deadlineBox}>
              <Ionicons name="time-outline" size={13} color={C.inProgress} />
              <Text style={styles.deadlineBoxText}>
                {t('visits.detail.reserveDeadlinePrefix')} <Text style={{ fontFamily: 'Inter_600SemiBold' }}>{visite.reserveDeadlineDate}</Text>
              </Text>
            </View>
          )}

          {visite.tags && visite.tags.length > 0 && (
            <View style={styles.tagsRow}>
              {visite.tags.map(tag => (
                <View key={tag} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {visite.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesLabel}>{t('visits.detail.notes')}</Text>
              <Text style={styles.notesText}>{visite.notes}</Text>
            </View>
          ) : null}
        </View>

        {/* Participants */}
        {visite.participants && visite.participants.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {t('visits.new.participants', { count: visite.participants.length })}
            </Text>
            <View style={{ marginTop: 10, gap: 8 }}>
              {visite.participants.map(p => (
                <View key={p.id} style={styles.participantRow}>
                  <View style={styles.participantAvatar}>
                    <Text style={styles.participantAvatarText}>
                      {p.name.split(' ').map((w: string) => w[0] ?? '').join('').toUpperCase().slice(0, 2)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.participantName}>{p.name}</Text>
                    {(p.role || p.company) ? (
                      <Text style={styles.participantMeta}>
                        {[p.role, p.company].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Checklist */}
        {visite.checklistItems && visite.checklistItems.length > 0 && (
          <View style={styles.card}>
            {(() => {
              const total  = visite.checklistItems!.length;
              const done   = visite.checklistItems!.filter(i => i.checked).length;
              const pct    = Math.round((done / total) * 100);
              return (
                <>
                  <View style={styles.checklistHeaderRow}>
                    <Text style={styles.sectionTitle}>{t('visits.new.checklist')}</Text>
                    <Text style={styles.checklistCounter}>{done}/{total}</Text>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${pct}%` as any }]} />
                  </View>
                  {permissions.canEdit && (
                    <Text style={styles.checklistHint}>{t('visits.detail.checklistTouchHint')}</Text>
                  )}
                  <View style={{ marginTop: 10, gap: 6 }}>
                    {visite.checklistItems!.map(item => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.checklistItem}
                        onPress={() => toggleChecklistItem(item.id)}
                        disabled={!permissions.canEdit}
                        activeOpacity={0.75}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: item.checked, disabled: !permissions.canEdit }}
                      >
                        <View style={[styles.checkboxView, item.checked && styles.checkboxViewDone]}>
                          {item.checked && <Ionicons name="checkmark" size={11} color="#fff" />}
                        </View>
                        <Text style={[styles.checklistItemText, item.checked && styles.checklistItemTextDone]}>
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              );
            })()}
          </View>
        )}

        {tunnelData && (
          <View style={styles.tunnelCard}>
            <Text style={styles.tunnelTitle}>{t('visits.detail.tunnelTitle')}</Text>
            <View style={styles.tunnelSteps}>
              {[
                { label: t('visits.detail.tunnelVisit'), done: true, icon: 'eye-outline' as const, color: '#6366F1' },
                { label: t('visits.detail.tunnelReserves'), done: tunnelData.total > 0, icon: 'warning-outline' as const, color: C.open, sub: tunnelData.total > 0 ? t('visits.detail.raisedCount', { count: tunnelData.total }) : t('visits.detail.none') },
                { label: t('visits.detail.tunnelClosed'), done: tunnelData.closed > 0, icon: 'checkmark-circle-outline' as const, color: C.closed, sub: tunnelData.total > 0 ? `${tunnelData.pctLevees}%` : '—' },
                { label: 'OPR', done: tunnelData.anyOpr, icon: 'document-text-outline' as const, color: C.inProgress, sub: tunnelData.anyOpr ? t('visits.detail.created') : t('reserveLabels.status.waiting') },
                { label: t('visits.detail.signedPv'), done: !!tunnelData.signedOpr, icon: 'ribbon-outline' as const, color: C.closed, sub: tunnelData.signedOpr ? t('visits.detail.signedOn', { date: tunnelData.signedOpr.signedAt }) : t('visits.detail.notSigned') },
              ].map((step, i, arr) => (
                <View key={step.label} style={styles.tunnelStepWrap}>
                  <View style={[styles.tunnelStep, step.done && { backgroundColor: step.color + '15', borderColor: step.color + '50' }]}>
                    <Ionicons name={step.icon} size={16} color={step.done ? step.color : C.textMuted} />
                    <View>
                      <Text style={[styles.tunnelStepLabel, step.done && { color: step.color }]}>{step.label}</Text>
                      {step.sub && <Text style={[styles.tunnelStepSub, step.done && { color: step.color + 'CC' }]}>{step.sub}</Text>}
                    </View>
                    {step.done && <Ionicons name="checkmark" size={12} color={step.color} style={{ marginLeft: 'auto' }} />}
                  </View>
                  {i < arr.length - 1 && (
                    <View style={[styles.tunnelArrow, step.done && arr[i + 1].done && { backgroundColor: arr[i + 1].color }]} />
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('visits.detail.visitReserves', { count: visiteReserves.length })}</Text>
          {permissions.canCreate && (
            <View style={styles.sectionActions}>
              <TouchableOpacity style={styles.secondaryAddBtn} onPress={openAttachModal}>
                <Ionicons name="link-outline" size={14} color={C.primary} />
                <Text style={styles.secondaryAddBtnText}>{t('visits.detail.existing')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => router.push(`/reserve/new?visiteId=${visite.id}` as any)}
              >
                <Ionicons name="add" size={15} color={C.primary} />
                <Text style={styles.addBtnText}>{t('visits.detail.newReserve')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {visiteReserves.length === 0 ? (
          <View style={styles.emptyReserves}>
            <Ionicons name="warning-outline" size={32} color={C.textMuted} />
            <Text style={styles.emptyText}>{t('visits.detail.noLinkedReserve')}</Text>
            <Text style={styles.emptySubText}>{t('visits.detail.noLinkedReserveHint')}</Text>
            {permissions.canCreate && (
              <View style={styles.emptyActions}>
                <TouchableOpacity style={styles.emptySecondaryBtn} onPress={openAttachModal}>
                  <Ionicons name="link-outline" size={15} color={C.primary} />
                  <Text style={styles.emptySecondaryBtnText}>{t('visits.detail.attachReserve')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.emptyPrimaryBtn}
                  onPress={() => router.push(`/reserve/new?visiteId=${visite.id}` as any)}
                >
                  <Ionicons name="add" size={15} color="#fff" />
                  <Text style={styles.emptyPrimaryBtnText}>{t('visits.detail.newReserve')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          visiteReserves.map(r => {
            const sColor = RESERVE_STATUS_COLORS[r.status] ?? C.textMuted;
            const pColor = PRIORITY_COLORS[r.priority] ?? C.textMuted;
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.reserveCard, { borderLeftColor: sColor }]}
                onPress={() => router.push(`/reserve/${r.id}` as any)}
                activeOpacity={0.75}
              >
                <View style={styles.reserveHeader}>
                  <Text style={styles.reserveId}>{r.id}</Text>
                  <View style={styles.reserveHeaderRight}>
                    {r.archivedAt ? (
                      <View style={styles.reserveArchiveBadge}>
                        <Ionicons name="archive-outline" size={11} color={C.textMuted} />
                        <Text style={styles.reserveArchiveBadgeText}>{t('reserveCard.archived')}</Text>
                      </View>
                    ) : null}
                    <View style={[styles.statusBadge, { backgroundColor: sColor + '20' }]}>
                      <Text style={[styles.statusBadgeText, { color: sColor }]}>{t(`reserveLabels.status.${r.status}`, { defaultValue: RESERVE_STATUS_LABELS[r.status] ?? r.status })}</Text>
                    </View>
                    {permissions.canEdit && (
                      <TouchableOpacity
                        style={styles.reserveMenuBtn}
                        onPress={() => openReserveVisitActions(r)}
                        hitSlop={8}
                      >
                        <Ionicons name="ellipsis-horizontal" size={16} color={C.textSub} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <Text style={styles.reserveTitle}>{r.title}</Text>
                <View style={styles.reserveMeta}>
                  <View style={[styles.priorityDot, { backgroundColor: pColor }]} />
                  <Text style={styles.reserveMetaText}>{t(`reserveLabels.priority.${r.priority}`, { defaultValue: PRIORITY_LABELS[r.priority] ?? r.priority })}</Text>
                  <Text style={styles.reserveMetaDot}>·</Text>
                  <Text style={styles.reserveMetaText}>{r.company}</Text>
                  <Text style={styles.reserveMetaDot}>·</Text>
                  {r.building ? <Text style={styles.reserveMetaText}>{r.building}</Text> : null}
                </View>
                {permissions.canEdit && (
                  <View style={styles.reserveVisitActions}>
                    <TouchableOpacity
                      style={[styles.reserveVisitActionBtn, styles.reserveVisitActionDanger]}
                      onPress={() => confirmRemoveReserveFromVisit(r)}
                      disabled={reserveVisitActionLoadingId === r.id}
                    >
                      {reserveVisitActionLoadingId === r.id ? (
                        <ActivityIndicator size="small" color={C.open} />
                      ) : (
                        <Ionicons name="remove-circle-outline" size={15} color={C.open} />
                      )}
                      <Text style={[styles.reserveVisitActionText, { color: C.open }]}>{t('visits.detail.remove')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reserveVisitActionBtn}
                      onPress={() => toggleArchiveReserveFromVisit(r)}
                    >
                      <Ionicons name={r.archivedAt ? 'archive' : 'archive-outline'} size={15} color={C.textSub} />
                      <Text style={styles.reserveVisitActionText}>{r.archivedAt ? t('visits.detail.unarchive') : t('visits.detail.archive')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}

        {permissions.canEdit && (
          <TouchableOpacity
            style={[styles.signBtn, visite.signedAt && styles.signBtnSigned]}
            onPress={() => {
              setEntrepriseSignataire(visite.entrepriseSignataire ?? '');
              setSignModalVisible(true);
            }}
          >
            <Ionicons
              name={visite.signedAt ? 'checkmark-circle' : 'pencil-outline'}
              size={16}
              color={visite.signedAt ? C.closed : C.primary}
            />
            <Text style={[styles.signBtnText, visite.signedAt && styles.signBtnTextSigned]}>
              {visite.signedAt ? t('visits.detail.pvSignedOn', { date: formatDate(visite.signedAt) }) : t('visits.detail.signVisitPv')}
            </Text>
          </TouchableOpacity>
        )}

        {permissions.canExport && (
          <View style={styles.reportExportCard}>
            <View style={styles.reportExportHeader}>
              <View style={styles.reportExportIcon}>
                <Ionicons name="document-text-outline" size={18} color={C.verification} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportExportTitle}>{reportCopy.uiTitle}</Text>
                <Text style={styles.reportExportSubtitle}>{reportCopy.uiSubtitle}</Text>
              </View>
            </View>
            <Text style={styles.reportLanguageLabel}>{reportCopy.uiLanguageLabel}</Text>
            <View style={styles.reportLanguageRow}>
              {VISIT_REPORT_LANGUAGES.map(item => {
                const active = item.code === reportLanguage;
                return (
                  <TouchableOpacity
                    key={item.code}
                    style={[styles.reportLanguageChip, active && styles.reportLanguageChipActive]}
                    onPress={() => setReportLanguage(item.code)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.reportLanguageChipCode, active && styles.reportLanguageChipCodeActive]}>
                      {item.label}
                    </Text>
                    <Text style={[styles.reportLanguageChipTitle, active && styles.reportLanguageChipTitleActive]}>
                      {item.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.exportBtn} onPress={() => exportPDF(reportLanguage)}>
              <Ionicons name="download-outline" size={16} color={C.verification} />
              <Text style={styles.exportBtnText}>{reportCopy.uiExportButton}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      </PageContainer>

      <Modal visible={statusModalVisible} transparent animationType="fade" onRequestClose={() => setStatusModalVisible(false)}>
        <View style={styles.statusModalOverlay}>
          <View style={styles.statusModal}>
            <View style={styles.statusModalHeader}>
              <Text style={styles.statusModalTitle}>{t('visits.detail.statusModalTitle')}</Text>
              <TouchableOpacity onPress={() => setStatusModalVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={C.text} />
              </TouchableOpacity>
            </View>
            {(['planned', 'in_progress', 'completed'] as VisiteStatus[]).map(nextStatus => {
              const option = STATUS_CFG[nextStatus];
              const active = visite.status === nextStatus;
              return (
                <TouchableOpacity
                  key={nextStatus}
                  style={[styles.statusOption, active && { borderColor: option.color, backgroundColor: option.color + '12' }]}
                  onPress={() => setVisitStatus(nextStatus)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.statusOptionIcon, { backgroundColor: option.color + '18' }]}>
                    <Ionicons
                      name={nextStatus === 'planned' ? 'calendar-outline' : nextStatus === 'in_progress' ? 'walk-outline' : 'checkmark-circle-outline'}
                      size={17}
                      color={option.color}
                    />
                  </View>
                  <Text style={[styles.statusOptionText, active && { color: option.color }]}>{t(`visits.status.${nextStatus}`)}</Text>
                  {active && <Ionicons name="checkmark" size={16} color={option.color} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal visible={signModalVisible} transparent animationType="slide" onRequestClose={() => setSignModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}>
          <View style={styles.signModal}>
            <View style={styles.signModalHeader}>
              <Text style={styles.signModalTitle}>{t('visits.detail.signModalTitle')}</Text>
              <TouchableOpacity onPress={() => setSignModalVisible(false)}>
                <Ionicons name="close" size={22} color={C.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.signTabs}>
              <TouchableOpacity
                style={[styles.signTab, signingTab === 'conducteur' && styles.signTabActive]}
                onPress={() => setSigningTab('conducteur')}
              >
                <Ionicons name="person-outline" size={13} color={signingTab === 'conducteur' ? C.primary : C.textSub} />
                <Text style={[styles.signTabText, signingTab === 'conducteur' && styles.signTabTextActive]}>
                  {t('visits.detail.conductor')}
                </Text>
                {visite.conducteurSignature && <Ionicons name="checkmark-circle" size={12} color={C.closed} />}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.signTab, signingTab === 'entreprise' && styles.signTabActive]}
                onPress={() => setSigningTab('entreprise')}
              >
                <Ionicons name="business-outline" size={13} color={signingTab === 'entreprise' ? C.primary : C.textSub} />
                <Text style={[styles.signTabText, signingTab === 'entreprise' && styles.signTabTextActive]}>
                  {t('visits.detail.company')}
                </Text>
                {visite.entrepriseSignature && <Ionicons name="checkmark-circle" size={12} color={C.closed} />}
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.signModalContent}>
              {signingTab === 'conducteur' ? (
                <View style={styles.signSection}>
                  <Text style={styles.signSectionLabel}>{t('visits.detail.conductor')}</Text>
                  <Text style={styles.signSectionName}>{visite.conducteur}</Text>
                  <Text style={styles.signInstruction}>{t('visits.detail.signInstruction')}</Text>
                  <SignaturePad ref={conducteurSigRef} />
                  <TouchableOpacity style={styles.clearBtn} onPress={() => conducteurSigRef.current?.clear()}>
                    <Ionicons name="refresh-outline" size={14} color={C.textSub} />
                    <Text style={styles.clearBtnText}>{t('visits.detail.clear')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.signSection}>
                  <Text style={styles.signSectionLabel}>{t('visits.detail.companyRepresentative')}</Text>
                  <TextInput
                    style={styles.signNameInput}
                    placeholder={t('visits.detail.signerNamePlaceholder')}
                    placeholderTextColor={C.textMuted}
                    value={entrepriseSignataire}
                    onChangeText={setEntrepriseSignataire}
                  />
                  <Text style={styles.signInstruction}>{t('visits.detail.signInstruction')}</Text>
                  <SignaturePad ref={entrepriseSigRef} />
                  <TouchableOpacity style={styles.clearBtn} onPress={() => entrepriseSigRef.current?.clear()}>
                    <Ionicons name="refresh-outline" size={14} color={C.textSub} />
                    <Text style={styles.clearBtnText}>{t('visits.detail.clear')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.saveSignBtn, isSigning && { opacity: 0.6 }]}
              onPress={handleSaveSignature}
              disabled={isSigning}
            >
              {isSigning ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
              )}
              <Text style={styles.saveSignBtnText}>
                {isSigning ? t('visits.detail.saving') : t('visits.detail.validateSignatures')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={editLocModal} transparent animationType="slide" onRequestClose={() => setEditLocModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={styles.locModal}>
              <View style={styles.locModalHeader}>
                <Text style={styles.locModalTitle}>{t('visits.detail.editLocation')}</Text>
                <TouchableOpacity onPress={() => setEditLocModal(false)}>
                  <Ionicons name="close" size={22} color={C.text} />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={styles.locModalContent} keyboardShouldPersistTaps="handled">
                <LocationPicker
                  buildings={activeChantier?.buildings ?? []}
                  building={editBuilding}
                  level={editLevel}
                  zone={editZone}
                  onBuildingChange={setEditBuilding}
                  onLevelChange={setEditLevel}
                  onZoneChange={setEditZone}
                />
              </ScrollView>
              <TouchableOpacity style={styles.locSaveBtn} onPress={saveEditLoc}>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={styles.locSaveBtnText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={attachModalVisible} transparent animationType="slide" onRequestClose={() => setAttachModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={styles.attachModal}>
              <View style={styles.attachHandle} />
              <View style={styles.attachModalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.attachModalTitle}>{t('visits.detail.attachExistingTitle')}</Text>
                  <Text style={styles.attachModalSubtitle}>
                    {t('visits.detail.attachSubtitle')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setAttachModalVisible(false)} style={styles.attachCloseBtn}>
                  <Ionicons name="close" size={22} color={C.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.attachSearchBox}>
                <Ionicons name="search-outline" size={18} color={C.textMuted} />
                <TextInput
                  style={styles.attachSearchInput}
                  placeholder={t('visits.detail.attachSearchPlaceholder')}
                  placeholderTextColor={C.textMuted}
                  value={attachSearch}
                  onChangeText={setAttachSearch}
                />
                {attachSearch ? (
                  <TouchableOpacity onPress={() => setAttachSearch('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={C.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.attachScopeRow}>
                <TouchableOpacity
                  style={[styles.attachScopeBtn, attachScopeOnly && styles.attachScopeBtnActive]}
                  onPress={() => setAttachScopeOnly(true)}
                >
                  <Ionicons name="map-outline" size={14} color={attachScopeOnly ? C.primary : C.textSub} />
                  <Text style={[styles.attachScopeText, attachScopeOnly && styles.attachScopeTextActive]}>{t('visits.detail.visitScopeShort')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.attachScopeBtn, !attachScopeOnly && styles.attachScopeBtnActive]}
                  onPress={() => setAttachScopeOnly(false)}
                >
                  <Ionicons name="business-outline" size={14} color={!attachScopeOnly ? C.primary : C.textSub} />
                  <Text style={[styles.attachScopeText, !attachScopeOnly && styles.attachScopeTextActive]}>{t('visits.detail.wholeProject')}</Text>
                </TouchableOpacity>
              </View>

              <FlatList
                style={styles.attachList}
                contentContainerStyle={styles.attachListContent}
                data={attachableReserves}
                keyExtractor={item => item.id}
                renderItem={renderAttachReserve}
                extraData={attachSelectedIds}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={7}
                removeClippedSubviews={Platform.OS !== 'web'}
                ListEmptyComponent={
                  <View style={styles.attachEmpty}>
                    <Ionicons name="file-tray-outline" size={32} color={C.textMuted} />
                    <Text style={styles.attachEmptyTitle}>{t('visits.detail.noAttachableReserve')}</Text>
                    <Text style={styles.attachEmptyText}>
                      {attachScopeOnly
                        ? t('visits.detail.noAttachableInScope')
                        : t('visits.detail.noAttachableSearch')}
                    </Text>
                  </View>
                }
              />

              <View style={styles.attachFooter}>
                <TouchableOpacity
                  style={[styles.attachSubmitBtn, (attachSelectedIds.length === 0 || attachSubmitting) && styles.attachSubmitBtnDisabled]}
                  onPress={() => { void applyAttachReserves(false); }}
                  disabled={attachSelectedIds.length === 0 || attachSubmitting}
                >
                  {attachSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="link-outline" size={18} color="#fff" />}
                  <Text style={styles.attachSubmitText}>
                    {attachSubmitting ? t('visits.detail.adding') : t('visits.detail.addSelected', { count: attachSelectedIds.length })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 100 },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  notFoundText: { fontSize: 16, fontFamily: 'Inter_500Medium', color: C.textSub },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  deleteBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.open },

  infoGrid: { gap: 10 },
  infoItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  infoVal: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },

  deadlineBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, backgroundColor: C.inProgress + '12', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: C.inProgress + '30' },
  deadlineBoxText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress, lineHeight: 16 },
  notesBox: { marginTop: 12, backgroundColor: C.bg, borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: C.primary },
  notesLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  notesText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },

  coverPhotoCard: { borderRadius: 14, overflow: 'hidden', marginBottom: 16 },
  coverPhoto: { width: '100%', height: 180 },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tagChip: { backgroundColor: C.primary + '15', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: C.primary + '30' },
  tagChipText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.primary },

  participantRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  participantAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.primary + '20', alignItems: 'center', justifyContent: 'center' },
  participantAvatarText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary },
  participantName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  participantMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },

  checklistHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checklistCounter: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  progressBarBg: { height: 4, backgroundColor: C.border, borderRadius: 2, marginTop: 8 },
  progressBarFill: { height: 4, backgroundColor: C.closed, borderRadius: 2 },
  checklistHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8 },
  checklistItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 2, borderRadius: 8,
  },
  checkboxView: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxViewDone: { backgroundColor: C.closed, borderColor: C.closed },
  checklistItemText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  checklistItemTextDone: { color: C.textMuted, textDecorationLine: 'line-through' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, flexShrink: 1 },
  sectionActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },
  secondaryAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primary + '10', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.primary + '25',
  },
  secondaryAddBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  emptyReserves: { alignItems: 'center', padding: 32, gap: 8, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  emptySubText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center' },
  emptyActions: { width: '100%', gap: 10, marginTop: 12 },
  emptySecondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: C.primary + '35', backgroundColor: C.primary + '10',
    borderRadius: 12, paddingVertical: 12,
  },
  emptySecondaryBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  emptyPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12,
  },
  emptyPrimaryBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },

  reserveCard: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4, marginBottom: 10,
  },
  reserveHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  reserveHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  reserveId: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  reserveMenuBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  reserveArchiveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  reserveArchiveBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  reserveTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 6 },
  reserveMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  priorityDot: { width: 7, height: 7, borderRadius: 4 },
  reserveMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  reserveMetaDot: { fontSize: 12, color: C.textMuted },
  reserveVisitActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 11 },
  reserveVisitActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  reserveVisitActionDanger: { backgroundColor: C.open + '08', borderColor: C.open + '24' },
  reserveVisitActionText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textSub },

  reportExportCard: {
    backgroundColor: C.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: C.border, marginTop: 0, marginBottom: 18,
    gap: 12,
  },
  reportExportHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reportExportIcon: {
    width: 38, height: 38, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.verification + '14', borderWidth: 1, borderColor: C.verification + '25',
  },
  reportExportTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text },
  reportExportSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2, lineHeight: 17 },
  reportLanguageLabel: {
    fontSize: 10, fontFamily: 'Inter_700Bold', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  reportLanguageRow: { flexDirection: 'row', gap: 8 },
  reportLanguageChip: {
    flex: 1, minHeight: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  reportLanguageChipActive: {
    backgroundColor: C.primary, borderColor: C.primary,
  },
  reportLanguageChipCode: { fontSize: 13, fontFamily: 'Inter_800ExtraBold', color: C.textSub },
  reportLanguageChipCodeActive: { color: '#fff' },
  reportLanguageChipTitle: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.textMuted, marginTop: 2 },
  reportLanguageChipTitleActive: { color: 'rgba(255,255,255,0.82)' },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.verification + '15', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: C.verification + '30',
  },
  exportBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.verification },

  tunnelCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  tunnelTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 },
  tunnelSteps: { gap: 0 },
  tunnelStepWrap: { flexDirection: 'column' },
  tunnelStep: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface2, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.border,
  },
  tunnelStepLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  tunnelStepSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  tunnelArrow: {
    width: 2, height: 10, backgroundColor: C.border,
    alignSelf: 'center', marginVertical: 2,
  },

  signBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary + '15', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: C.primary + '40', marginTop: 0, marginBottom: 10,
  },
  signBtnSigned: {
    backgroundColor: C.closed + '10', borderColor: C.closed + '40',
  },
  signBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  signBtnTextSigned: { color: C.closed },

  statusModalOverlay: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.35)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  statusModal: {
    width: '100%', maxWidth: 420, backgroundColor: C.surface,
    borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.border,
  },
  statusModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusModalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  statusOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, backgroundColor: C.surface2, marginTop: 8,
  },
  statusOptionIcon: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  statusOptionText: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end',
  },
  signModal: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '90%', paddingBottom: 34,
    width: '100%', maxWidth: 640, alignSelf: 'center',
  },
  signModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 18, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  signModalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  signTabs: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border,
  },
  signTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  signTabActive: { borderBottomColor: C.primary },
  signTabText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  signTabTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  signModalContent: { padding: 18, paddingBottom: 8 },
  signSection: { gap: 10 },
  signSectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  signSectionName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  signInstruction: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  signNameInput: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
  },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end',
    paddingVertical: 4, paddingHorizontal: 10,
  },
  clearBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  saveSignBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, marginHorizontal: 18, marginTop: 12, borderRadius: 14,
    paddingVertical: 14,
  },
  saveSignBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  locModal: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '60%', paddingBottom: 34,
    width: '100%', maxWidth: 640, alignSelf: 'center',
  },
  locModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 18, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  locModalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  locModalContent: { padding: 16 },
  locSaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, marginHorizontal: 18, marginTop: 12, borderRadius: 14,
    paddingVertical: 14,
  },
  locSaveBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  attachModal: {
    backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    maxHeight: '88%', paddingBottom: 28,
    width: '100%', maxWidth: 640, alignSelf: 'center',
  },
  attachHandle: {
    width: 44, height: 5, borderRadius: 999, backgroundColor: C.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  attachModalHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14,
  },
  attachModalTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: C.text },
  attachModalSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 4, lineHeight: 17 },
  attachCloseBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface2, marginLeft: 12,
  },
  attachSearchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 18, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
  },
  attachSearchInput: {
    flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    paddingVertical: Platform.OS === 'ios' ? 4 : 0,
  },
  attachScopeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 12 },
  attachScopeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface2,
  },
  attachScopeBtnActive: { borderColor: C.primary + '55', backgroundColor: C.primary + '12' },
  attachScopeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  attachScopeTextActive: { color: C.primary },
  attachList: { marginTop: 12 },
  attachListContent: { paddingHorizontal: 18, paddingBottom: 12, gap: 8 },
  attachReserveRow: {
    flexDirection: 'row', gap: 12, padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  attachReserveRowSelected: { borderColor: C.primary + '80', backgroundColor: C.primary + '08' },
  attachCheckbox: {
    width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 2, backgroundColor: C.surface2,
  },
  attachCheckboxSelected: { backgroundColor: C.primary, borderColor: C.primary },
  attachReserveBody: { flex: 1, minWidth: 0 },
  attachReserveTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  attachReserveId: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.textMuted },
  attachStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  attachStatusText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  attachReserveTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text, lineHeight: 18 },
  attachReserveMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  attachReserveMeta: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  attachMoveBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5,
    marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: C.waiting + '14', borderWidth: 1, borderColor: C.waiting + '30',
  },
  attachMoveBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.waiting },
  attachEmpty: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 36, paddingHorizontal: 20,
    borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  attachEmptyTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text, marginTop: 10 },
  attachEmptyText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 17, marginTop: 4 },
  attachFooter: { paddingHorizontal: 18, paddingTop: 10 },
  attachSubmitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14,
  },
  attachSubmitBtnDisabled: { backgroundColor: C.primary + '45' },
  attachSubmitText: { fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#fff' },
});
