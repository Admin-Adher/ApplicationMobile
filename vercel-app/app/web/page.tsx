'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase-browser';
import styles from './web.module.css';

type Role = 'super_admin' | 'admin' | 'conducteur' | 'chef_equipe' | 'sous_traitant' | 'observateur' | string;

type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  role_label?: string | null;
  organization_id?: string | null;
  company_id?: string | null;
  preferred_language?: 'fr' | 'en' | 'es' | null;
};

type WebState = {
  chantiers: any[];
  reserves: any[];
  sitePlans: any[];
  companies: any[];
  visites: any[];
  messages: any[];
  channels: any[];
  profiles: Profile[];
  lots: any[];
  tasks: any[];
  incidents: any[];
  documents: any[];
  photos: any[];
  oprs: any[];
  notificationPreferences: any[];
};

type ReserveDraft = {
  kind: 'reserve' | 'observation';
  title: string;
  description: string;
  chantierId: string;
  building: string;
  buildingId: string;
  level: string;
  levelId: string;
  zone: string;
  priority: string;
  status: string;
  deadline: string;
  planId: string;
  planX?: number | null;
  planY?: number | null;
  lotId: string;
  visiteId: string;
  companies: string[];
  photos: WebPhotoDraft[];
};

type WebPhotoDraft = {
  id: string;
  uri: string;
  name?: string;
  kind?: 'defect' | 'resolution';
  file?: File;
  existing?: boolean;
};

type ReservePinDraft = {
  planId?: string;
  x: number;
  y: number;
};

type PlanPin = {
  reserve: any;
  number: number;
  x: number;
  y: number;
};

type PinPlacementPreview = {
  id: string;
  planId: string;
  x: number;
  y: number;
  label: string;
};

type VisitDraft = {
  title: string;
  chantierId: string;
  date: string;
  startTime: string;
  endTime: string;
  conducteur: string;
  status: 'planned' | 'in_progress' | 'completed';
  visitType: 'controle' | 'opr' | 'securite' | 'reception' | 'synthese' | 'autre';
  building: string;
  level: string;
  zone: string;
  defaultPlanId: string;
  visitedLocations: Array<{
    buildingId?: string;
    buildingName: string;
    defaultPlanId?: string;
  }>;
  reserveDeadlineDate: string;
  notes: string;
  checklistItems: Array<{ id: string; label: string; checked: boolean }>;
  companyIds: string[];
  participants: Array<{ id: string; name: string; role?: string; company?: string; companyId?: string; profileId?: string; email?: string }>;
  tags: string[];
  recurrence: 'none' | 'weekly' | 'bimonthly';
  coverPhoto: WebPhotoDraft | null;
};

const EMPTY_DATA: WebState = {
  chantiers: [],
  reserves: [],
  sitePlans: [],
  companies: [],
  visites: [],
  messages: [],
  channels: [],
  profiles: [],
  lots: [],
  tasks: [],
  incidents: [],
  documents: [],
  photos: [],
  oprs: [],
  notificationPreferences: [],
};

const PDFJS_VERSION = '5.7.284';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'reserves', label: 'Réserves', icon: '⚠' },
  { id: 'plans', label: 'Plans', icon: '▤' },
  { id: 'visites', label: 'Visites', icon: '☑' },
  { id: 'planning', label: 'Planning', icon: '◷' },
  { id: 'messages', label: 'Messages', icon: '○' },
  { id: 'terrain', label: 'Terrain', icon: '⌁' },
  { id: 'media', label: 'Médias', icon: '▧' },
  { id: 'rapports', label: 'Rapports', icon: '▤' },
  { id: 'equipes', label: 'Équipes', icon: '◎' },
  { id: 'settings', label: 'Réglages', icon: '☰' },
  { id: 'admin', label: 'Admin', icon: '⚙' },
] as const;

type TabId = typeof TABS[number]['id'];

const NAV_GROUPS: { label: string; items: TabId[] }[] = [
  { label: 'Pilotage', items: ['dashboard', 'reserves', 'plans', 'visites', 'planning'] },
  { label: 'Collaboration', items: ['messages', 'terrain', 'media', 'rapports'] },
  { label: 'Administration', items: ['equipes', 'settings', 'admin'] },
];

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  in_progress: 'En cours',
  waiting: 'En attente',
  verification: 'Vérification',
  closed: 'Clôturé',
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critique',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS);
const RESERVE_FILTER_OPTIONS = [
  { key: 'all', label: 'Tous' },
  ...STATUS_OPTIONS.map(([key, label]) => ({ key, label })),
  { key: 'overdue', label: 'En retard' },
  { key: 'due_soon', label: 'Échéance proche' },
  { key: 'ack_missing', label: 'AR manquants' },
  { key: 'ack_received', label: 'AR reçus' },
  { key: 'archived', label: 'Archivées' },
] as const;

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  conducteur: 'Conducteur de travaux',
  chef_equipe: "Chef d'équipe",
  sous_traitant: 'Sous-traitant',
  observateur: 'Observateur',
};

const VISIT_TYPE_LABELS: Record<VisitDraft['visitType'], string> = {
  controle: 'Contrôle',
  opr: 'OPR',
  securite: 'Sécurité',
  reception: 'Réception',
  synthese: 'Synthèse',
  autre: 'Autre',
};

const VISIT_STATUS_LABELS: Record<VisitDraft['status'], string> = {
  planned: 'Planifiée',
  in_progress: 'En cours',
  completed: 'Terminée',
};

const VISIT_CHECKLIST_TEMPLATES: Record<VisitDraft['visitType'], string[]> = {
  controle: ['Avancement des travaux', 'Matériaux et stockages', 'Coordination entreprises', 'Réserves précédentes', 'Sécurité et propreté'],
  opr: ['Nettoyage final', 'Essais techniques', 'Finitions', 'Plans d’exécution', 'DOE / documents'],
  securite: ['EPI', 'Signalisation', 'Propreté chantier', 'Installations électriques provisoires', 'Accès et circulations'],
  reception: ['Nettoyage', 'Mise en service', 'Essais fonctionnels', 'Plans d’exécution', 'Notices et DOE'],
  synthese: ['Participants', 'Avancement', 'Points bloquants', 'Planning', 'Questions diverses'],
  autre: ['État constaté', 'Actions à mener', 'Prochaine étape'],
};

const VISIT_TYPE_OPTIONS: Array<{ value: VisitDraft['visitType']; label: string; icon: string; color: string }> = [
  { value: 'controle', label: 'Contrôle', icon: '☑', color: '#6366f1' },
  { value: 'opr', label: 'OPR', icon: '▤', color: '#f59e0b' },
  { value: 'securite', label: 'Sécurité', icon: '◇', color: '#ef4444' },
  { value: 'reception', label: 'Réception', icon: '✓', color: '#10b981' },
  { value: 'synthese', label: 'Synthèse', icon: '◎', color: '#3b82f6' },
  { value: 'autre', label: 'Autre', icon: '…', color: '#64748b' },
];

const VISIT_DEADLINE_SUGGESTIONS = [
  { label: '7 j', days: 7 },
  { label: '15 j', days: 15 },
  { label: '30 j', days: 30 },
  { label: '60 j', days: 60 },
] as const;

const VISIT_RECURRENCE_OPTIONS: Array<{ value: VisitDraft['recurrence']; label: string; desc: string }> = [
  { value: 'none', label: 'Unique', desc: 'Créer uniquement cette visite.' },
  { value: 'weekly', label: 'Hebdomadaire', desc: 'Créer 4 visites sur 4 semaines.' },
  { value: 'bimonthly', label: 'Bi-mensuelle', desc: 'Créer 4 visites espacées de 2 semaines.' },
];

const TEXT_LANG_OPTIONS = [
  { value: 'fr', label: 'FR', speech: 'fr-FR', name: 'français' },
  { value: 'en', label: 'EN', speech: 'en-US', name: 'anglais' },
  { value: 'es', label: 'ES', speech: 'es-ES', name: 'espagnol' },
] as const;

type TextLang = typeof TEXT_LANG_OPTIONS[number]['value'];

const RESERVE_TEMPLATE_GROUPS = [
  {
    category: 'Gros oeuvre',
    items: [
      { title: 'Fissure enduit', description: "Fissure constatee sur l'enduit. Reprendre avec un produit adapte et une finition homogene." },
      { title: 'Ragreage sol', description: 'Sol a reprendre avant pose du revetement final. Respecter les niveaux de reference.' },
      { title: 'Humidite / traces', description: "Traces d'humidite constatees. Identifier l'origine et traiter avant finition." },
    ],
  },
  {
    category: 'Menuiseries',
    items: [
      { title: 'Reglage porte', description: 'Porte mal reglee : fermeture difficile ou gene au passage. Reglage des charnieres requis.' },
      { title: 'Joint manquant', description: "Joint d'etancheite absent ou decolle. Remplacer avec un joint adapte." },
      { title: 'Serrure defectueuse', description: 'Serrure bloquee ou mecanisme defaillant. Verification et remplacement si necessaire.' },
    ],
  },
  {
    category: 'Peinture / finitions',
    items: [
      { title: 'Peinture a reprendre', description: 'Peinture rayee, manquante ou mal appliquee. Reprise avec la meme teinte.' },
      { title: 'Fissure platrerie', description: 'Fissure sur enduit interieur. Rebouchage, poncage et reprise de peinture.' },
      { title: 'Faux plafond incomplet', description: 'Dalle ou plaque de faux plafond manquante ou mal posee. Completer et aligner.' },
    ],
  },
  {
    category: 'Electricite / plomberie',
    items: [
      { title: 'Prise non fonctionnelle', description: 'Prise de courant hors service. Verification electrique et remise en etat obligatoires.' },
      { title: 'Fuite constatee', description: "Fuite d'eau detectee. Localiser precisement et reparer immediatement." },
      { title: 'Evacuation bouchee', description: "Mauvaise evacuation constatee. Debouchage et verification du reseau necessaires." },
    ],
  },
];

function isAdmin(profile: Profile | null) {
  return profile?.role === 'super_admin' || profile?.role === 'admin';
}

function canEdit(profile: Profile | null) {
  return ['super_admin', 'admin', 'conducteur', 'chef_equipe'].includes(String(profile?.role ?? ''));
}

function userLabel(profile: Profile | null, authUser?: SupabaseUser | null) {
  return profile?.name || profile?.email || authUser?.email || 'BuildTrack Web';
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(value: string, days: number) {
  const base = value ? new Date(`${value}T12:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return todayISO();
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function suggestedDeadlineForPriority(priority: string) {
  if (priority === 'critical') return addDaysISO(todayISO(), 2);
  if (priority === 'high') return addDaysISO(todayISO(), 7);
  if (priority === 'medium') return addDaysISO(todayISO(), 30);
  return '';
}

function isReserveDescriptionMissing(description: any) {
  const text = String(description ?? '').trim();
  return !text || text === '-' || /^aucune description/i.test(text);
}

function isoWeekFromISO(value: string) {
  const source = value ? new Date(`${value}T12:00:00`) : new Date();
  const date = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function autoVisitTitle(type: VisitDraft['visitType'], date: string) {
  return `${VISIT_TYPE_LABELS[type]} — S${isoWeekFromISO(date)}`;
}

function makeVisitChecklist(type: VisitDraft['visitType']) {
  return (VISIT_CHECKLIST_TEMPLATES[type] ?? []).map(label => ({
    id: crypto.randomUUID(),
    label,
    checked: false,
  }));
}

function nowFR() {
  return new Date().toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function prettyDate(value?: string | null, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function isReserveArchived(reserve: any) {
  return Boolean(reserve?.archived_at ?? reserve?.archivedAt);
}

function isReserveOverdue(reserve: any) {
  if (!reserve?.deadline || ['closed', 'verification'].includes(String(reserve?.status ?? ''))) return false;
  const deadline = new Date(reserve.deadline);
  return !Number.isNaN(deadline.getTime()) && deadline < new Date();
}

function isReserveDueSoon(reserve: any, days = 3) {
  if (!reserve?.deadline || ['closed', 'verification'].includes(String(reserve?.status ?? ''))) return false;
  const deadline = new Date(`${String(reserve.deadline).slice(0, 10)}T23:59:59`);
  if (Number.isNaN(deadline.getTime())) return false;
  const now = new Date();
  const limit = new Date(now);
  limit.setDate(limit.getDate() + days);
  return deadline >= now && deadline <= limit;
}

function needsEnterpriseAck(reserve: any) {
  return reserveCompanies(reserve).length > 0 && !reserve?.enterprise_acknowledged_at && !reserve?.enterpriseAcknowledgedAt;
}

function hasEnterpriseAck(reserve: any) {
  return Boolean(reserve?.enterprise_acknowledged_at ?? reserve?.enterpriseAcknowledgedAt);
}

function sameName(a?: string | null, b?: string | null) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function getChantierId(item: any) {
  return item?.chantier_id ?? item?.chantierId ?? '';
}

function normalizeSearchText(value: any) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function initials(value?: string | null) {
  const words = String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  return words
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase();
}

function getPlanBuildingName(plan: any) {
  return String(plan?.building_name ?? plan?.building ?? plan?.batiment ?? '').trim() || 'Sans bâtiment';
}

function getPlanBuildingKey(plan: any) {
  const id = plan?.building_id ?? plan?.buildingId;
  if (id) return `id:${id}`;
  const name = getPlanBuildingName(plan);
  return name === 'Sans bâtiment' ? '__none__' : `name:${normalizeSearchText(name)}`;
}

function getPlanLevelName(plan: any) {
  return String(plan?.level_name ?? plan?.level ?? plan?.niveau ?? '').trim();
}

function projectBuildings(project?: any | null): any[] {
  return Array.isArray(project?.buildings) ? project.buildings : [];
}

function getPlanBuildingId(plan: any) {
  return String(plan?.building_id ?? plan?.buildingId ?? '').trim();
}

function getPlanLevelId(plan: any) {
  return String(plan?.level_id ?? plan?.levelId ?? '').trim();
}

function getBuildingNameById(project: any, buildingId?: string | null) {
  if (!buildingId) return '';
  return projectBuildings(project).find((building: any) => building.id === buildingId)?.name ?? '';
}

function getLevelNameById(project: any, buildingId?: string | null, levelId?: string | null) {
  if (!buildingId || !levelId) return '';
  const building = projectBuildings(project).find((item: any) => item.id === buildingId);
  return (building?.levels ?? []).find((level: any) => level.id === levelId)?.name ?? '';
}

function getPlanDisplayLocation(plan: any, project?: any | null) {
  const buildingId = getPlanBuildingId(plan);
  const levelId = getPlanLevelId(plan);
  const building = getBuildingNameById(project, buildingId) || getPlanBuildingName(plan);
  const level = getLevelNameById(project, buildingId, levelId) || getPlanLevelName(plan);
  return { building, buildingId, level, levelId };
}

function getVisitCompanyIds(visit: any): string[] {
  return Array.isArray(visit?.concerned_company_ids)
    ? visit.concerned_company_ids
    : Array.isArray(visit?.concernedCompanyIds)
      ? visit.concernedCompanyIds
      : [];
}

function getVisitLocations(visit: any): any[] {
  return Array.isArray(visit?.visited_locations)
    ? visit.visited_locations
    : Array.isArray(visit?.visitedLocations)
      ? visit.visitedLocations
      : [];
}

function getVisitDefaultPlanId(visit: any) {
  return String(visit?.default_plan_id ?? visit?.defaultPlanId ?? '').trim();
}

function getVisitReserveDeadline(visit: any) {
  return String(visit?.reserve_deadline_date ?? visit?.reserveDeadlineDate ?? '').trim();
}

function getReserveBuildingKey(reserve: any) {
  const id = reserve?.building_id ?? reserve?.buildingId;
  if (id) return `id:${id}`;
  const name = String(reserve?.building_name ?? reserve?.building ?? reserve?.batiment ?? '').trim();
  return name ? `name:${normalizeSearchText(name)}` : '__none__';
}

function parseBuildingFamily(name: string) {
  const trimmed = name.trim();
  const match = trimmed.match(/^([^\d]*?[^\d\s])[\s\-_.#]*(\d+.*)$/);
  if (!match) return null;
  const label = match[1].trim().replace(/[\s\-_.#]+$/, '');
  if (!label) return null;
  return { key: normalizeSearchText(label).replace(/\s+/g, ' '), label };
}

function storagePublicUrl(raw: any, bucket: 'photos' | 'documents') {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value || /^file:\/\//i.test(value)) return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  const path = value
    .replace(/^\/+/, '')
    .replace(new RegExp(`^${bucket}/`, 'i'), '');
  if (!path) return '';
  const { data } = supabaseBrowser.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function assetUrl(item: any, bucket: 'photos' | 'documents' = 'photos') {
  const raw =
    item?.uri ??
    item?.photoUri ??
    item?.url ??
    item?.file_url ??
    item?.fileUrl ??
    item?.public_url ??
    item?.publicUrl ??
    item?.signed_url ??
    item?.signedUrl ??
    item?.download_url ??
    item?.downloadUrl ??
    item?.photo_uri ??
    item?.src ??
    item?.storage_path ??
    item?.storagePath ??
    item?.file_path ??
    item?.filePath ??
    item?.path ??
    '';
  return storagePublicUrl(raw, bucket);
}

function reservePhotoItems(reserve: any, photos: any[]) {
  if (!reserve) return [];
  const fromReserve = Array.isArray(reserve.photos) ? reserve.photos : [];
  const legacyPhotoUri = reserve.photo_uri ?? reserve.photoUri;
  const legacyReservePhotos = legacyPhotoUri
    ? [{ id: `${reserve.id}-legacy`, uri: legacyPhotoUri, comment: 'Photo' }]
    : [];
  const fromTable = photos.filter(photo => {
    const reserveId = photo.reserve_id ?? photo.reserveId;
    return reserveId && String(reserveId) === String(reserve.id);
  });
  const byKey = new Map<string, any>();
  [...fromReserve, ...legacyReservePhotos, ...fromTable].forEach(photo => {
    const uri = assetUrl(photo, 'photos');
    if (!uri) return;
    byKey.set(String(photo.id ?? uri), { ...photo, uri });
  });
  return Array.from(byKey.values());
}

function localOnlyPhotoCount(reserve: any, photos: any[]) {
  if (!reserve) return 0;
  const rawPhotoUrl = (photo: any) => String(
    photo?.uri ??
    photo?.photoUri ??
    photo?.photo_uri ??
    photo?.url ??
    photo?.path ??
    '',
  ).trim();
  const fromReserve = Array.isArray(reserve.photos) ? reserve.photos : [];
  const legacyPhotoUri = reserve.photo_uri ?? reserve.photoUri;
  const legacyReservePhotos = legacyPhotoUri ? [{ uri: legacyPhotoUri }] : [];
  const fromTable = photos.filter(photo => {
    const reserveId = photo.reserve_id ?? photo.reserveId;
    return reserveId && String(reserveId) === String(reserve.id);
  });
  return [...fromReserve, ...legacyReservePhotos, ...fromTable]
    .filter(photo => /^file:\/\//i.test(rawPhotoUrl(photo)))
    .length;
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizePlanPercent(value?: any) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(clampPercent(num));
}

function planCoordinateToPercent(value: any, ratioMode = false) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return clampPercent(ratioMode ? num * 100 : num, 2, 98);
}

function toBase64Download(pdfBase64: string, filename: string) {
  if (typeof window === 'undefined') return;
  const byteChars = atob(pdfBase64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i += 1) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function reserveCompanies(reserve: any): string[] {
  if (Array.isArray(reserve.companies) && reserve.companies.length) return reserve.companies;
  return reserve.company ? [reserve.company] : [];
}

function makeHistory(action: string, author: string, oldValue?: string, newValue?: string) {
  return {
    id: crypto.randomUUID(),
    action,
    author,
    createdAt: nowFR(),
    ...(oldValue !== undefined ? { oldValue } : {}),
    ...(newValue !== undefined ? { newValue } : {}),
  };
}

function generateReserveId(reserves: any[], lots: any[], lotId?: string) {
  const lot = lots.find(item => item.id === lotId);
  const suffix = () => Math.random().toString(36).slice(2, 5).toUpperCase();
  const existing = new Set(reserves.map(r => String(r.id)));
  const prefix = lot?.code
    ? String(lot.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
    : 'RSV';
  let max = 0;
  for (const reserve of reserves) {
    const match = String(reserve.id).match(new RegExp(`^${prefix}-(\\d+)`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  let next = max + 1;
  let candidate = `${prefix}-${String(next).padStart(3, '0')}-${suffix()}`;
  while (existing.has(candidate)) {
    next += 1;
    candidate = `${prefix}-${String(next).padStart(3, '0')}-${suffix()}`;
  }
  return candidate;
}

function safeStorageName(value: string) {
  return String(value || 'fichier')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

async function uploadWebFile(bucket: 'photos' | 'documents', file: File, prefix: string) {
  const extension = file.name.includes('.') ? file.name.split('.').pop() : '';
  const fileName = `${safeStorageName(prefix)}_${Date.now()}_${safeStorageName(file.name || `upload.${extension || 'jpg'}`)}`;
  const path = fileName;
  const { data, error } = await supabaseBrowser.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw error;
  const { data: urlData } = supabaseBrowser.storage.from(bucket).getPublicUrl(data.path);
  return urlData.publicUrl;
}

async function requestWebTranslation(params: { text: string; source: TextLang; target: TextLang; context: string }) {
  const text = params.text.trim();
  if (!text || params.source === params.target) return text;
  const { data: authData } = await supabaseBrowser.auth.getSession();
  const response = await fetch('/api/translate-text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authData.session?.access_token ? { Authorization: `Bearer ${authData.session.access_token}` } : {}),
    },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success || typeof payload?.text !== 'string') {
    throw new Error(payload?.detail || payload?.error || 'Traduction indisponible.');
  }
  return String(payload.text).trim();
}

function defaultTextLang(): TextLang {
  if (typeof window === 'undefined') return 'fr';
  const stored = window.localStorage.getItem('buildtrack-web-dictation-lang');
  if (stored === 'fr' || stored === 'en' || stored === 'es') return stored;
  const nav = window.navigator.language.toLowerCase();
  if (nav.startsWith('en')) return 'en';
  if (nav.startsWith('es')) return 'es';
  return 'fr';
}

function createReserveDraft(projectId: string, plan?: any | null, visit?: any | null, pin?: ReservePinDraft | null): ReserveDraft {
  const firstVisitLocation = getVisitLocations(visit)[0] ?? null;
  const planId = pin?.planId ?? firstVisitLocation?.defaultPlanId ?? firstVisitLocation?.default_plan_id ?? getVisitDefaultPlanId(visit) ?? plan?.id ?? '';
  const planX = normalizePlanPercent(pin?.x);
  const planY = normalizePlanPercent(pin?.y);
  return {
    kind: 'reserve',
    title: '',
    description: '',
    chantierId: getChantierId(visit) || getChantierId(plan) || projectId,
    building: firstVisitLocation?.buildingName ?? firstVisitLocation?.building_name ?? visit?.building ?? plan?.building ?? '',
    buildingId: firstVisitLocation?.buildingId ?? firstVisitLocation?.building_id ?? getPlanBuildingId(plan) ?? '',
    level: visit?.level ?? plan?.level ?? '',
    levelId: getPlanLevelId(plan) ?? '',
    zone: visit?.zone ?? '',
    priority: 'medium',
    status: 'open',
    deadline: getVisitReserveDeadline(visit),
    planId,
    planX,
    planY,
    lotId: '',
    visiteId: visit?.id ?? '',
    companies: [],
    photos: [],
  };
}

function reserveToDraft(reserve: any): ReserveDraft {
  return {
    kind: reserve.kind ?? 'reserve',
    title: reserve.title ?? '',
    description: reserve.description ?? '',
    chantierId: reserve.chantier_id ?? '',
    building: reserve.building ?? '',
    buildingId: reserve.building_id ?? reserve.buildingId ?? '',
    level: reserve.level ?? '',
    levelId: reserve.level_id ?? reserve.levelId ?? '',
    zone: reserve.zone ?? '',
    priority: reserve.priority ?? 'medium',
    status: reserve.status ?? 'open',
    deadline: reserve.deadline ?? '',
    planId: reserve.plan_id ?? '',
    planX: normalizePlanPercent(reserve.plan_x),
    planY: normalizePlanPercent(reserve.plan_y),
    lotId: reserve.lot_id ?? '',
    visiteId: reserve.visite_id ?? '',
    companies: reserveCompanies(reserve),
    photos: Array.isArray(reserve.photos)
      ? reserve.photos.map((photo: any) => ({
          id: String(photo.id ?? crypto.randomUUID()),
          uri: assetUrl(photo, 'photos'),
          name: photo.name ?? 'Photo',
          kind: photo.kind === 'resolution' ? 'resolution' : 'defect',
          existing: true,
        })).filter((photo: WebPhotoDraft) => !!photo.uri)
      : (reserve.photo_uri ?? reserve.photoUri)
        ? [{
            id: 'legacy',
            uri: assetUrl({ uri: reserve.photo_uri ?? reserve.photoUri }, 'photos'),
            name: 'Photo',
            kind: 'defect' as const,
            existing: true,
          }].filter((photo: WebPhotoDraft) => !!photo.uri)
        : [],
  };
}

function createVisitDraft(projectId: string, conducteur: string): VisitDraft {
  const date = todayISO();
  const visitType: VisitDraft['visitType'] = 'controle';
  return {
    title: autoVisitTitle(visitType, date),
    chantierId: projectId,
    date,
    startTime: '08:00',
    endTime: '10:00',
    conducteur,
    status: 'planned',
    visitType,
    building: '',
    level: '',
    zone: '',
    defaultPlanId: '',
    visitedLocations: [],
    reserveDeadlineDate: '',
    notes: '',
    checklistItems: makeVisitChecklist(visitType),
    companyIds: [],
    participants: [],
    tags: [],
    recurrence: 'none',
    coverPhoto: null,
  };
}

function channelLabel(channel: any, companies: any[]) {
  if (channel?.type === 'company' && String(channel.id ?? '').startsWith('company-')) {
    const company = companies.find(c => c.id === String(channel.id).replace('company-', ''));
    return company?.name ?? channel.name;
  }
  return channel?.name ?? channel?.id ?? 'Canal';
}

async function fetchScopedTable<T = any>(
  table: string,
  profile: Profile,
  options: { order?: string; ascending?: boolean; limit?: number; scoped?: boolean } = {},
): Promise<T[]> {
  try {
    let query = supabaseBrowser.from(table).select('*');
    if (options.scoped !== false && profile.role !== 'super_admin' && profile.organization_id) {
      query = query.eq('organization_id', profile.organization_id);
    }
    if (options.order) query = query.order(options.order, { ascending: options.ascending ?? false });
    if (options.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error) {
      console.warn(`[web] ${table}`, error.message);
      return [];
    }
    return (data ?? []) as T[];
  } catch (error) {
    console.warn(`[web] ${table}`, error);
    return [];
  }
}

export default function BuildTrackWebPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<WebState>(EMPTY_DATA);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedReserveId, setSelectedReserveId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [buildingFilter, setBuildingFilter] = useState('all');
  const [pinFilter, setPinFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [reserveModalMode, setReserveModalMode] = useState<'create' | 'edit' | null>(null);
  const [reserveDraft, setReserveDraft] = useState<ReserveDraft>(() => createReserveDraft(''));
  const [editingReserveId, setEditingReserveId] = useState<string | null>(null);
  const [visitModalOpen, setVisitModalOpen] = useState(false);
  const [visitDraft, setVisitDraft] = useState<VisitDraft>(() => createVisitDraft('', ''));
  const [reportLanguage, setReportLanguage] = useState<'fr' | 'en' | 'es'>('fr');
  const [generatingReport, setGeneratingReport] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('buildtrack-web-sidebar-collapsed') === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('buildtrack-web-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    let alive = true;
    supabaseBrowser.auth.getSession().then(({ data: authData }) => {
      if (!alive) return;
      setSession(authData.session ?? null);
      setAuthUser(authData.session?.user ?? null);
    });
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthUser(nextSession?.user ?? null);
      if (!nextSession) {
        setProfile(null);
        setData(EMPTY_DATA);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setLoading(false);
      return;
    }
    loadEverything(session.user);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function loadEverything(user: SupabaseUser) {
    setLoading(true);
    setError('');
    try {
      const { data: profileRows, error: profileError } = await supabaseBrowser
        .from('profiles')
        .select('*')
        .or(`id.eq.${user.id},email.eq.${user.email ?? ''}`)
        .limit(1);
      if (profileError) throw profileError;
      const loadedProfile = (profileRows?.[0] ?? null) as Profile | null;
      if (!loadedProfile) {
        setError("Profil introuvable. Vérifiez que l'invitation a bien été acceptée.");
        setLoading(false);
        return;
      }

      setProfile(loadedProfile);
      const [
        chantiers,
        reserves,
        sitePlans,
        companies,
        visites,
        messages,
        channels,
        profiles,
        lots,
        tasks,
        incidents,
        documents,
        photos,
        oprs,
        notificationPreferences,
      ] = await Promise.all([
        fetchScopedTable('chantiers', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('reserves', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('site_plans', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('companies', loadedProfile, { order: 'name', ascending: true }),
        fetchScopedTable('visites', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('messages', loadedProfile, { order: 'created_at', ascending: false, limit: 800 }),
        fetchScopedTable('channels', loadedProfile, { order: 'created_at' }),
        fetchScopedTable<Profile>('profiles', loadedProfile, { order: 'name', ascending: true }),
        fetchScopedTable('lots', loadedProfile, { order: 'name', ascending: true }),
        fetchScopedTable('tasks', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('incidents', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('documents', loadedProfile, { order: 'uploaded_at' }),
        fetchScopedTable('photos', loadedProfile, { order: 'taken_at', scoped: false }),
        fetchScopedTable('oprs', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('notification_preferences', loadedProfile, { scoped: false }),
      ]);

      const nextData = {
        chantiers,
        reserves,
        sitePlans,
        companies,
        visites,
        messages,
        channels,
        profiles,
        lots,
        tasks,
        incidents,
        documents,
        photos,
        oprs,
        notificationPreferences,
      };
      setData(nextData);
      setSelectedProjectId(prev => prev !== 'all' && chantiers.some((c: any) => c.id === prev) ? prev : chantiers[0]?.id ?? 'all');
      setSelectedReserveId(prev => prev && reserves.some((r: any) => r.id === prev) ? prev : reserves[0]?.id ?? null);
      setSelectedPlanId(prev => prev && sitePlans.some((p: any) => p.id === prev) ? prev : sitePlans[0]?.id ?? null);
      setSelectedChannelId(prev => prev && channels.some((c: any) => c.id === prev) ? prev : channels[0]?.id ?? null);
    } catch (err: any) {
      setError(err?.message ?? 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const { error: loginError } = await supabaseBrowser.auth.signInWithPassword({ email, password });
    if (loginError) setError(loginError.message);
    setSaving(false);
  }

  async function updateReserveStatus(reserveId: string, status: string) {
    if (!canEdit(profile)) return;
    setSaving(true);
    const { error: updateError } = await supabaseBrowser
      .from('reserves')
      .update({ status })
      .eq('id', reserveId);
    if (updateError) setError(updateError.message);
    else setData(prev => ({ ...prev, reserves: prev.reserves.map(r => r.id === reserveId ? { ...r, status } : r) }));
    setSaving(false);
  }

  async function toggleArchive(reserve: any) {
    if (!canEdit(profile)) return;
    setSaving(true);
    const next = reserve.archived_at
      ? { archived_at: null, archived_by: null }
      : { archived_at: new Date().toISOString(), archived_by: profile?.name ?? profile?.email ?? 'Web' };
    const { error: archiveError } = await supabaseBrowser.from('reserves').update(next).eq('id', reserve.id);
    if (archiveError) setError(archiveError.message);
    else setData(prev => ({ ...prev, reserves: prev.reserves.map(r => r.id === reserve.id ? { ...r, ...next } : r) }));
    setSaving(false);
  }

  async function deleteReserveWeb(reserve: any) {
    if (!canEdit(profile) || !reserve?.id) return;
    const confirmed = window.confirm(`Supprimer définitivement la réserve ${reserve.id} ? Cette action ne pourra pas être annulée.`);
    if (!confirmed) return;
    setSaving(true);
    setError('');
    const { error: deleteError } = await supabaseBrowser.from('reserves').delete().eq('id', reserve.id);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setData(prev => {
        const reserves = prev.reserves.filter(item => item.id !== reserve.id);
        setSelectedReserveId(current => current === reserve.id ? reserves[0]?.id ?? null : current);
        return { ...prev, reserves };
      });
    }
    setSaving(false);
  }

  async function addReserveComment(reserve: any, content: string) {
    if (!profile || !content.trim()) return;
    const nextComment = {
      id: crypto.randomUUID(),
      author: userLabel(profile, authUser),
      content: content.trim(),
      createdAt: nowFR(),
    };
    const comments = [...(reserve.comments ?? []), nextComment];
    const history = [
      ...(reserve.history ?? []),
      makeHistory('Commentaire ajouté depuis le web', userLabel(profile, authUser)),
    ];
    setData(prev => ({
      ...prev,
      reserves: prev.reserves.map(item => item.id === reserve.id ? { ...item, comments, history } : item),
    }));
    const { error: commentError } = await supabaseBrowser
      .from('reserves')
      .update({ comments, history })
      .eq('id', reserve.id);
    if (commentError) setError(commentError.message);
  }

  async function fillMissingReserveDescriptions(targets: any[]) {
    if (!isAdmin(profile)) return;
    const missing = targets.filter(reserve => reserve.title?.trim() && isReserveDescriptionMissing(reserve.description));
    if (!missing.length) {
      setError('Aucune réserve sans description dans cette sélection.');
      return;
    }
    if (!window.confirm(`Copier le titre dans la description de ${missing.length} réserve${missing.length > 1 ? 's' : ''} ?`)) return;
    setSaving(true);
    setError('');
    try {
      const updates: any[] = [];
      for (const reserve of missing) {
        const history = [
          ...(reserve.history ?? []),
          makeHistory('Description complétée depuis le web', userLabel(profile, authUser), reserve.description ?? '', reserve.title),
        ];
        const patch = { description: reserve.title, history };
        const { error: updateError } = await supabaseBrowser.from('reserves').update(patch).eq('id', reserve.id);
        if (updateError) throw updateError;
        updates.push({ id: reserve.id, ...patch });
      }
      const updateById = new Map(updates.map(update => [update.id, update]));
      setData(prev => ({
        ...prev,
        reserves: prev.reserves.map(reserve => updateById.has(reserve.id) ? { ...reserve, ...updateById.get(reserve.id) } : reserve),
      }));
    } catch (err: any) {
      setError(err?.message ?? 'Assistant réserves indisponible.');
    } finally {
      setSaving(false);
    }
  }

  async function translateReserveTexts(targets: any[], language: TextLang) {
    if (!isAdmin(profile)) return;
    const candidates = targets.filter(reserve => reserve.title?.trim() || reserve.description?.trim());
    const langLabel = TEXT_LANG_OPTIONS.find(option => option.value === language)?.label ?? language.toUpperCase();
    if (!candidates.length) {
      setError('Aucune réserve à traduire dans cette sélection.');
      return;
    }
    if (!window.confirm(`Traduire les titres, descriptions et commentaires de ${candidates.length} réserve${candidates.length > 1 ? 's' : ''} en ${langLabel} ?`)) return;
    setSaving(true);
    setError('');
    try {
      const updates: any[] = [];
      for (const reserve of candidates) {
        const sourceDescription = isReserveDescriptionMissing(reserve.description) ? reserve.title : reserve.description;
        const source = defaultTextLang();
        const [title, description, comments] = await Promise.all([
          reserve.title?.trim() ? requestWebTranslation({ text: reserve.title, source, target: language, context: 'reserve title' }) : Promise.resolve(reserve.title ?? ''),
          sourceDescription?.trim() ? requestWebTranslation({ text: sourceDescription, source, target: language, context: 'reserve description' }) : Promise.resolve(sourceDescription ?? ''),
          Promise.all((reserve.comments ?? []).map(async (comment: any) => ({
            ...comment,
            content: comment?.content?.trim()
              ? await requestWebTranslation({ text: comment.content, source, target: language, context: 'reserve comment' })
              : comment?.content,
          }))),
        ]);
        const history = [
          ...(reserve.history ?? []),
          makeHistory(`Textes traduits en ${langLabel} depuis le web`, userLabel(profile, authUser)),
        ];
        const patch = { title, description: description || title, comments, history };
        const { error: updateError } = await supabaseBrowser.from('reserves').update(patch).eq('id', reserve.id);
        if (updateError) throw updateError;
        updates.push({ id: reserve.id, ...patch });
      }
      const updateById = new Map(updates.map(update => [update.id, update]));
      setData(prev => ({
        ...prev,
        reserves: prev.reserves.map(reserve => updateById.has(reserve.id) ? { ...reserve, ...updateById.get(reserve.id) } : reserve),
      }));
    } catch (err: any) {
      setError(err?.message ?? 'Traduction des réserves impossible.');
    } finally {
      setSaving(false);
    }
  }

  function currentProjectId() {
    return selectedProjectId !== 'all' ? selectedProjectId : data.chantiers[0]?.id ?? '';
  }

  function openReserveCreate(prefill?: { plan?: any; visit?: any; pin?: ReservePinDraft }) {
    setError('');
    setEditingReserveId(null);
    const prefillPlan = prefill?.plan ?? (prefill?.pin?.planId ? data.sitePlans.find(plan => plan.id === prefill.pin?.planId) : null);
    const baseDraft = createReserveDraft(currentProjectId(), prefillPlan, prefill?.visit, prefill?.pin);
    const project = data.chantiers.find(item => item.id === baseDraft.chantierId);
    const selectedPlan = prefillPlan ?? data.sitePlans.find(plan => plan.id === baseDraft.planId);
    const planLocation = selectedPlan ? getPlanDisplayLocation(selectedPlan, project) : null;
    const visitCompanyNames = getVisitCompanyIds(prefill?.visit)
      .map(companyId => data.companies.find(company => company.id === companyId)?.name)
      .filter((name): name is string => !!name);
    setReserveDraft({
      ...baseDraft,
      building: planLocation?.building || baseDraft.building,
      buildingId: planLocation?.buildingId || baseDraft.buildingId,
      level: planLocation?.level || baseDraft.level,
      levelId: planLocation?.levelId || baseDraft.levelId,
      companies: visitCompanyNames,
    });
    setReserveModalMode('create');
  }

  function openReserveEdit(reserve: any) {
    setError('');
    setEditingReserveId(reserve.id);
    setReserveDraft(reserveToDraft(reserve));
    setReserveModalMode('edit');
  }

  function closeReserveModal() {
    setReserveModalMode(null);
    setEditingReserveId(null);
  }

  function openVisitCreate() {
    setError('');
    setVisitDraft(createVisitDraft(currentProjectId(), userLabel(profile, authUser)));
    setVisitModalOpen(true);
  }

  function toggleReserveCompany(companyName: string) {
    setReserveDraft(prev => ({
      ...prev,
      companies: prev.companies.includes(companyName)
        ? prev.companies.filter(name => name !== companyName)
        : [...prev.companies, companyName],
    }));
  }

  function toggleVisitCompany(companyId: string) {
    setVisitDraft(prev => ({
      ...prev,
      companyIds: prev.companyIds.includes(companyId)
        ? prev.companyIds.filter(id => id !== companyId)
        : [...prev.companyIds, companyId],
    }));
  }

  async function syncVisitReserveLink(reserveId: string, nextVisitId?: string | null, previousVisitId?: string | null) {
    const updates: Array<PromiseLike<any>> = [];
    const nextVisites = data.visites.map(visit => {
      if (previousVisitId && visit.id === previousVisitId && previousVisitId !== nextVisitId) {
        const reserveIds = (visit.reserve_ids ?? []).filter((id: string) => id !== reserveId);
        updates.push(supabaseBrowser.from('visites').update({ reserve_ids: reserveIds }).eq('id', visit.id));
        return { ...visit, reserve_ids: reserveIds };
      }
      if (nextVisitId && visit.id === nextVisitId) {
        const reserveIds = Array.from(new Set([...(visit.reserve_ids ?? []), reserveId]));
        updates.push(supabaseBrowser.from('visites').update({ reserve_ids: reserveIds }).eq('id', visit.id));
        return { ...visit, reserve_ids: reserveIds };
      }
      return visit;
    });
    if (updates.length) {
      await Promise.all(updates);
      setData(prev => ({ ...prev, visites: nextVisites }));
    }
  }

  async function unlinkReserveFromVisitWeb(visit: any, reserve: any) {
    if (!canEdit(profile) || !visit?.id || !reserve?.id) return;
    const confirmed = window.confirm(`Délier la réserve ${reserve.id} de la visite "${visit.title}" ? La réserve restera disponible dans l'onglet Réserves.`);
    if (!confirmed) return;

    setSaving(true);
    setError('');
    let unlinkError: any = null;
    const rpcResult = await (supabaseBrowser as any).rpc('unlink_reserves_from_visite', {
      p_visite_id: visit.id,
      p_reserve_ids: [reserve.id],
    });
    unlinkError = rpcResult?.error ?? null;

    if (unlinkError) {
      const reserveIds = (visit.reserve_ids ?? []).filter((id: string) => id !== reserve.id);
      const [visitResult, reserveResult] = await Promise.all([
        supabaseBrowser.from('visites').update({ reserve_ids: reserveIds }).eq('id', visit.id),
        supabaseBrowser.from('reserves').update({ visite_id: null }).eq('id', reserve.id).eq('visite_id', visit.id),
      ]);
      unlinkError = visitResult.error ?? reserveResult.error ?? null;
    }

    if (unlinkError) {
      setError(unlinkError.message ?? 'Impossible de délier cette réserve de la visite.');
    } else {
      setData(prev => ({
        ...prev,
        visites: prev.visites.map(item => item.id === visit.id
          ? { ...item, reserve_ids: (item.reserve_ids ?? []).filter((id: string) => id !== reserve.id) }
          : item),
        reserves: prev.reserves.map(item => item.id === reserve.id ? { ...item, visite_id: null } : item),
      }));
    }
    setSaving(false);
  }

  async function buildReservePhotoPatch(reserveId: string, draft: ReserveDraft) {
    const existingPhotos = draft.photos
      .filter(photo => photo.existing && photo.uri)
      .map(photo => ({
        id: photo.id,
        uri: photo.uri,
        kind: photo.kind ?? 'defect',
        takenAt: new Date().toISOString(),
        takenBy: userLabel(profile, authUser),
        name: photo.name ?? 'Photo',
      }));
    const newPhotos = draft.photos.filter(photo => photo.file);
    const uploadedPhotos: any[] = [];
    const photoRows: any[] = [];
    for (const photo of newPhotos) {
      if (!photo.file) continue;
      const url = await uploadWebFile('photos', photo.file, `reserve_${reserveId}_${photo.kind ?? 'defect'}`);
      const takenAt = new Date().toISOString();
      const photoId = crypto.randomUUID();
      uploadedPhotos.push({
        id: photoId,
        uri: url,
        kind: photo.kind ?? 'defect',
        takenAt,
        takenBy: userLabel(profile, authUser),
        name: photo.name ?? photo.file.name,
      });
      photoRows.push({
        id: photoId,
        comment: photo.kind === 'resolution' ? 'Photo de levee' : 'Photo de reserve',
        location: [draft.building, draft.level, draft.zone].filter(Boolean).join(' · '),
        taken_at: takenAt,
        taken_by: userLabel(profile, authUser),
        color_code: photo.kind === 'resolution' ? '#10b981' : '#003082',
        uri: url,
        reserve_id: reserveId,
        organization_id: profile?.organization_id ?? null,
      });
    }
    if (photoRows.length) {
      const { error: photoInsertError } = await supabaseBrowser.from('photos').insert(photoRows);
      if (photoInsertError) throw photoInsertError;
      setData(prev => ({ ...prev, photos: [...photoRows, ...prev.photos] }));
    }
    const photos = [...existingPhotos, ...uploadedPhotos];
    return {
      photos: photos.length ? photos : null,
      photo_uri: photos[0]?.uri ?? null,
    };
  }

  async function submitReserve(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !canEdit(profile)) return;
    const title = reserveDraft.title.trim();
    if (!title) {
      setError('Le titre de la réserve est obligatoire.');
      return;
    }
    if (!reserveDraft.companies.length) {
      setError('Sélectionnez au moins une entreprise responsable.');
      return;
    }
    if (!reserveDraft.building.trim()) {
      setError('Le bâtiment est obligatoire.');
      return;
    }
    if (!reserveDraft.level.trim()) {
      setError('Le niveau est obligatoire.');
      return;
    }
    setSaving(true);
    setError('');
    const existing = editingReserveId ? data.reserves.find(r => r.id === editingReserveId) : null;
    const companies = reserveDraft.companies;
    const previousCompanies = existing ? reserveCompanies(existing).map(name => name.trim()).filter(Boolean).sort() : [];
    const nextCompanies = companies.map(name => name.trim()).filter(Boolean).sort();
    const companiesChanged = Boolean(existing) && previousCompanies.join('|') !== nextCompanies.join('|');
    const history = [
      ...(existing?.history ?? []),
      reserveModalMode === 'edit'
        ? makeHistory('Modifiée depuis le web', userLabel(profile, authUser))
        : makeHistory(reserveDraft.kind === 'observation' ? 'Observation créée depuis le web' : 'Réserve créée depuis le web', userLabel(profile, authUser)),
    ];
    if (companiesChanged) {
      history.push(makeHistory('Entreprise responsable modifiée — AR et signatures réinitialisés', userLabel(profile, authUser)));
    }
    const basePayload = {
      kind: reserveDraft.kind,
      title,
      description: reserveDraft.description.trim() || title,
      building: reserveDraft.building.trim(),
      building_id: reserveDraft.buildingId || null,
      zone: reserveDraft.zone.trim(),
      level: reserveDraft.level.trim(),
      level_id: reserveDraft.levelId || null,
      company: companies[0] ?? '',
      companies,
      priority: reserveDraft.priority,
      status: reserveDraft.status,
      deadline: reserveDraft.deadline || null,
      comments: existing?.comments ?? [],
      history,
      plan_id: reserveDraft.planId || null,
      plan_x: reserveDraft.planId ? normalizePlanPercent(reserveDraft.planX) : null,
      plan_y: reserveDraft.planId ? normalizePlanPercent(reserveDraft.planY) : null,
      lot_id: reserveDraft.lotId || null,
      visite_id: reserveDraft.visiteId || null,
      chantier_id: reserveDraft.chantierId || null,
      organization_id: profile.organization_id ?? null,
      closed_at: reserveDraft.status === 'closed' ? (existing?.closed_at ?? todayISO()) : null,
      closed_by: reserveDraft.status === 'closed' ? userLabel(profile, authUser) : null,
      ...(companiesChanged ? {
        enterprise_signature: null,
        enterprise_signataire: null,
        enterprise_acknowledged_at: null,
        company_signatures: null,
      } : {}),
    };

    if (reserveModalMode === 'edit' && editingReserveId) {
      let photoPatch: { photos: any[] | null; photo_uri: string | null } | null = null;
      try {
        photoPatch = await buildReservePhotoPatch(editingReserveId, reserveDraft);
      } catch (photoError: any) {
        setError(photoError?.message ?? 'Upload des photos impossible.');
      }
      const { data: updated, error: updateError } = await supabaseBrowser
        .from('reserves')
        .update({ ...basePayload, ...(photoPatch ?? {}) })
        .eq('id', editingReserveId)
        .select()
        .single();
      if (updateError) {
        setError(updateError.message);
      } else {
        setData(prev => ({
          ...prev,
          reserves: prev.reserves.map(r => r.id === editingReserveId ? (updated ?? { ...r, ...basePayload, ...(photoPatch ?? {}) }) : r),
        }));
        await syncVisitReserveLink(editingReserveId, reserveDraft.visiteId || null, existing?.visite_id ?? null);
        closeReserveModal();
      }
    } else {
      const id = generateReserveId(data.reserves, data.lots, reserveDraft.lotId);
      const insertPayload = {
        ...basePayload,
        id,
        created_at: todayISO(),
        photo_uri: null,
        photos: null,
        photo_annotations: null,
      };
      const { data: inserted, error: insertError } = await supabaseBrowser
        .from('reserves')
        .insert(insertPayload)
        .select()
        .single();
      if (insertError) {
        setError(insertError.message);
      } else {
        let finalReserve = inserted ?? insertPayload;
        try {
          const photoPatch = await buildReservePhotoPatch(id, reserveDraft);
          if (photoPatch.photos?.length || photoPatch.photo_uri) {
            const { data: updatedWithPhotos, error: photoUpdateError } = await supabaseBrowser
              .from('reserves')
              .update(photoPatch)
              .eq('id', id)
              .select()
              .single();
            if (photoUpdateError) throw photoUpdateError;
            finalReserve = updatedWithPhotos ?? { ...finalReserve, ...photoPatch };
          }
        } catch (photoError: any) {
          setError(`Reserve creee, mais upload photo impossible : ${photoError?.message ?? 'erreur inconnue'}`);
        }
        setData(prev => ({ ...prev, reserves: [finalReserve, ...prev.reserves] }));
        await syncVisitReserveLink(id, reserveDraft.visiteId || null, null);
        setSelectedReserveId(id);
        const createdWithPin = basePayload.plan_x != null && basePayload.plan_y != null;
        if (reserveDraft.planId && createdWithPin) {
          setSelectedPlanId(reserveDraft.planId);
          setActiveTab('plans');
        }
        closeReserveModal();
      }
    }
    setSaving(false);
  }

  async function submitVisit(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !canEdit(profile)) return;
    const title = visitDraft.title.trim();
    const project = data.chantiers.find(item => item.id === visitDraft.chantierId);
    const hasBuildingHierarchy = projectBuildings(project).length > 0;
    if (!title) {
      setError('Le titre de la visite est obligatoire.');
      return;
    }
    if (!visitDraft.date) {
      setError('La date de visite est obligatoire.');
      return;
    }
    if (hasBuildingHierarchy && visitDraft.visitedLocations.length === 0) {
      setError('Sélectionnez au moins un bâtiment dans le périmètre de visite.');
      return;
    }
    if (visitDraft.startTime && visitDraft.endTime && visitDraft.endTime <= visitDraft.startTime) {
      setError("L'heure de fin doit être après l'heure de début.");
      return;
    }
    setSaving(true);
    setError('');

    const recurrenceOffsets =
      visitDraft.recurrence === 'weekly' ? [0, 7, 14, 21] :
      visitDraft.recurrence === 'bimonthly' ? [0, 14, 28, 42] :
      [0];
    const singleLocation = hasBuildingHierarchy && visitDraft.visitedLocations.length === 1
      ? visitDraft.visitedLocations[0]
      : null;
    let coverPhotoUri: string | null = visitDraft.coverPhoto?.existing ? visitDraft.coverPhoto.uri : null;
    if (visitDraft.coverPhoto?.file) {
      try {
        coverPhotoUri = await uploadWebFile('photos', visitDraft.coverPhoto.file, 'visite_cover');
      } catch (coverError: any) {
        setError(coverError?.message ?? 'Upload de la photo de couverture impossible.');
        setSaving(false);
        return;
      }
    }
    const basePayload = {
      chantier_id: visitDraft.chantierId || null,
      start_time: visitDraft.startTime || null,
      end_time: visitDraft.endTime || null,
      conducteur: visitDraft.conducteur.trim() || userLabel(profile, authUser),
      status: visitDraft.status,
      visit_type: visitDraft.visitType,
      concerned_company_ids: visitDraft.companyIds.length ? visitDraft.companyIds : null,
      visited_locations: hasBuildingHierarchy && visitDraft.visitedLocations.length ? visitDraft.visitedLocations : null,
      building: hasBuildingHierarchy ? (singleLocation?.buildingName ?? null) : (visitDraft.building.trim() || null),
      level: hasBuildingHierarchy ? null : (visitDraft.level.trim() || null),
      zone: visitDraft.zone.trim() || null,
      notes: visitDraft.notes.trim() || null,
      tags: visitDraft.tags.length ? visitDraft.tags : null,
      default_plan_id: hasBuildingHierarchy ? (singleLocation?.defaultPlanId ?? null) : (visitDraft.defaultPlanId || null),
      reserve_deadline_date: visitDraft.reserveDeadlineDate || null,
      checklist_items: visitDraft.checklistItems.length
        ? visitDraft.checklistItems.map(item => ({ ...item, checked: false }))
        : null,
      reserve_ids: [],
      participants: visitDraft.participants.length ? visitDraft.participants : null,
      cover_photo_uri: coverPhotoUri,
      created_at: new Date().toISOString(),
      organization_id: profile.organization_id ?? null,
    };
    const payloads = recurrenceOffsets.map((offset, index) => ({
      ...basePayload,
      id: `VIS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      title: recurrenceOffsets.length > 1 ? `${title} — S${index + 1}` : title,
      date: addDaysISO(visitDraft.date, offset),
      status: index === 0 ? visitDraft.status : 'planned',
    }));

    const { data: inserted, error: insertError } = await supabaseBrowser
      .from('visites')
      .insert(payloads)
      .select();
    if (insertError) {
      setError(insertError.message);
    } else {
      setData(prev => ({ ...prev, visites: [...(inserted ?? payloads), ...prev.visites] }));
      setVisitModalOpen(false);
      setActiveTab('visites');
    }
    setSaving(false);
  }

  async function updateCompanyField(companyId: string, field: 'planned_workers' | 'actual_workers' | 'hours_worked', value: number) {
    if (!canEdit(profile)) return;
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    setData(prev => ({
      ...prev,
      companies: prev.companies.map(company => company.id === companyId ? { ...company, [field]: safeValue } : company),
    }));
    const { error: companyError } = await supabaseBrowser
      .from('companies')
      .update({ [field]: safeValue })
      .eq('id', companyId);
    if (companyError) setError(companyError.message);
  }

  async function updateTaskQuick(task: any, patch: Record<string, any>) {
    if (!canEdit(profile)) return;
    const payload = {
      ...patch,
      progress: patch.progress ?? task.progress ?? 0,
    };
    setData(prev => ({
      ...prev,
      tasks: prev.tasks.map(item => item.id === task.id ? { ...item, ...payload } : item),
    }));
    const { error: taskError } = await supabaseBrowser
      .from('tasks')
      .update(payload)
      .eq('id', task.id);
    if (taskError) setError(taskError.message);
  }

  async function updateProfileField(userId: string, patch: Partial<Profile>) {
    if (!isAdmin(profile)) return;
    setData(prev => ({
      ...prev,
      profiles: prev.profiles.map(user => user.id === userId ? { ...user, ...patch } : user),
    }));
    const { error: profileError } = await supabaseBrowser
      .from('profiles')
      .update(patch)
      .eq('id', userId);
    if (profileError) setError(profileError.message);
  }

  async function updateNotificationField(field: string, value: boolean | string) {
    if (!authUser || !profile) return;
    const existing = data.notificationPreferences.find(row => row.user_id === authUser.id);
    const payload = {
      ...(existing ?? {}),
      user_id: authUser.id,
      organization_id: profile.organization_id ?? null,
      [field]: value,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error: prefError } = await supabaseBrowser
      .from('notification_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();
    if (prefError) {
      setError(prefError.message);
      return;
    }
    setData(prev => ({
      ...prev,
      notificationPreferences: existing
        ? prev.notificationPreferences.map(row => row.user_id === authUser.id ? (saved ?? payload) : row)
        : [saved ?? payload, ...prev.notificationPreferences],
    }));
  }

  function projectName() {
    if (selectedProjectId === 'all') return 'Tous les chantiers';
    return data.chantiers.find(project => project.id === selectedProjectId)?.name ?? 'Chantier';
  }

  async function generateWebReport(type: 'global_reserves' | 'plans' | 'individual_reserve' | 'visit_report', options?: { visit?: any }) {
    const selectedProjectName = projectName();
    const reportKey = `${type}-${reportLanguage}`;
    setGeneratingReport(reportKey);
    setError('');
    try {
      const payload = type === 'individual_reserve'
        ? {
            type,
            chantierName: selectedProjectName,
            reserve: selectedReserve,
            language: reportLanguage,
            generatedAt: new Date().toISOString(),
          }
        : type === 'visit_report'
          ? {
              type,
              chantierName: selectedProjectName,
              visit: options?.visit,
              reserves: projectScoped.reserves.filter((reserve: any) => {
                const visitReserveIds = options?.visit?.reserve_ids ?? [];
                return reserve.visite_id === options?.visit?.id || visitReserveIds.includes(reserve.id);
              }),
              companies: data.companies,
              language: reportLanguage,
              generatedAt: new Date().toISOString(),
            }
        : {
            type,
            chantierName: selectedProjectName,
            reserves: filteredReserves,
            plans: projectScoped.plans,
            companyFilter: null,
            language: reportLanguage,
            generatedAt: new Date().toISOString(),
          };
      if (type === 'individual_reserve' && !selectedReserve) {
        setError('Sélectionnez une réserve avant de générer sa fiche.');
        return;
      }
      if (type === 'visit_report' && !options?.visit) {
        setError('Selectionnez une visite avant de generer son compte rendu.');
        return;
      }
      const response = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? 'Génération PDF impossible.');
      }
      const filePart = selectedProjectName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'BuildTrack';
      const typePart = type === 'global_reserves' ? 'reserves' : type === 'plans' ? 'plans' : type === 'visit_report' ? 'visite' : 'reserve';
      toBase64Download(result.pdfBase64, `BuildTrack_${typePart}_${filePart}_${reportLanguage}.pdf`);
    } catch (err: any) {
      setError(err?.message ?? 'Génération PDF impossible.');
    } finally {
      setGeneratingReport(null);
    }
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedChannelId || !messageDraft.trim() || !profile) return;
    setSaving(true);
    const payload = {
      id: crypto.randomUUID(),
      channel_id: selectedChannelId,
      sender: profile.name || profile.email,
      content: messageDraft.trim(),
      timestamp: new Date().toLocaleString('fr-FR'),
      type: 'message',
      read: true,
      read_by: [profile.name || profile.email],
      reactions: {},
      is_pinned: false,
      mentions: [],
      organization_id: profile.organization_id ?? null,
    };
    const { data: inserted, error: messageError } = await supabaseBrowser
      .from('messages')
      .insert(payload)
      .select()
      .single();
    if (messageError) setError(messageError.message);
    else {
      setMessageDraft('');
      setData(prev => ({ ...prev, messages: [inserted, ...prev.messages] }));
    }
    setSaving(false);
  }

  const projectScoped = useMemo(() => {
    const byProject = (item: any) => selectedProjectId === 'all' || item.chantier_id === selectedProjectId || item.chantierId === selectedProjectId;
    const reserves = data.reserves.filter(byProject);
    const reserveIds = new Set(reserves.map((reserve: any) => String(reserve.id)));
    const photos = data.photos.filter(photo => {
      const reserveId = photo.reserve_id ?? photo.reserveId;
      return byProject(photo) || (reserveId && reserveIds.has(String(reserveId)));
    });
    return {
      reserves: reserves.map((reserve: any) => {
        const reservePhotos = reservePhotoItems(reserve, photos);
        return reservePhotos.length ? { ...reserve, photos: reservePhotos, photo_uri: reserve.photo_uri ?? reservePhotos[0]?.uri ?? null } : reserve;
      }),
      plans: data.sitePlans.filter(byProject),
      visites: data.visites.filter(byProject),
      tasks: data.tasks.filter(byProject),
      incidents: data.incidents.filter(byProject),
      documents: data.documents.filter(byProject),
      photos,
      oprs: data.oprs.filter(byProject),
    };
  }, [data, selectedProjectId]);

  const reserveStructuredFilters = useMemo(() => {
    const active = projectScoped.reserves.filter(reserve => !isReserveArchived(reserve));
    const companies = Array.from(new Set(active.flatMap(reserve => reserveCompanies(reserve)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const buildings = Array.from(new Set(active.map(reserve => String(reserve.building ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    return { companies, buildings };
  }, [projectScoped.reserves]);

  const filteredReserves = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projectScoped.reserves.filter(r => {
      if (statusFilter === 'archived') {
        if (!isReserveArchived(r)) return false;
      } else {
        if (isReserveArchived(r)) return false;
        if (statusFilter === 'overdue') {
          if (!isReserveOverdue(r)) return false;
        } else if (statusFilter === 'due_soon') {
          if (!isReserveDueSoon(r)) return false;
        } else if (statusFilter === 'ack_missing') {
          if (!needsEnterpriseAck(r)) return false;
        } else if (statusFilter === 'ack_received') {
          if (!hasEnterpriseAck(r)) return false;
        } else if (statusFilter !== 'all' && r.status !== statusFilter) {
          return false;
        }
      }
      if (priorityFilter !== 'all' && r.priority !== priorityFilter) return false;
      if (companyFilter !== 'all' && !reserveCompanies(r).includes(companyFilter)) return false;
      if (buildingFilter !== 'all' && !sameName(r.building, buildingFilter)) return false;
      if (pinFilter === 'pinned' && !r.plan_id) return false;
      if (pinFilter === 'unpinned' && r.plan_id) return false;
      if (!q) return true;
      const haystack = [
        r.id,
        r.title,
        r.description,
        r.building,
        r.level,
        r.zone,
        STATUS_LABELS[r.status] ?? r.status,
        PRIORITY_LABELS[r.priority] ?? r.priority,
        ...(reserveCompanies(r)),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [projectScoped.reserves, search, statusFilter, priorityFilter, companyFilter, buildingFilter, pinFilter]);

  const selectedReserve = projectScoped.reserves.find(r => r.id === selectedReserveId) ?? filteredReserves[0] ?? null;
  const selectedFilteredReserve = filteredReserves.find(r => r.id === selectedReserveId) ?? filteredReserves[0] ?? null;
  const selectedPlan = data.sitePlans.find(p => p.id === selectedPlanId) ?? projectScoped.plans[0] ?? null;
  const selectedChannel = data.channels.find(c => c.id === selectedChannelId) ?? data.channels[0] ?? null;
  const selectedChannelMessages = selectedChannel
    ? data.messages
        .filter(m => m.channel_id === selectedChannel.id)
        .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
    : [];

  const stats = useMemo(() => {
    const reserves = projectScoped.reserves;
    const active = reserves.filter(r => !r.archived_at);
    const overdue = active.filter(r => r.deadline && new Date(r.deadline) < new Date() && !['closed', 'verification'].includes(r.status));
    const closed = active.filter(r => r.status === 'closed');
    const ackMissing = active.filter(r => reserveCompanies(r).length > 0 && !r.enterprise_acknowledged_at).length;
    return {
      total: active.length,
      closed: closed.length,
      open: active.filter(r => r.status === 'open').length,
      overdue: overdue.length,
      progress: active.length ? Math.round((closed.length / active.length) * 100) : 0,
      ackMissing,
    };
  }, [projectScoped.reserves]);

  if (!session || !authUser) {
    return (
      <main className={styles.loginPage}>
        <section className={styles.loginPanel}>
          <div className={styles.brandMark}>B</div>
          <p className={styles.eyebrow}>BuildTrack Web</p>
          <h1>Connectez-vous au cockpit chantier</h1>
          <p className={styles.muted}>Même base Supabase, mêmes rôles, mêmes réserves que l’application mobile.</p>
          <form className={styles.loginForm} onSubmit={handleLogin}>
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required />
            <label>Mot de passe</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
            {error ? <p className={styles.error}>{error}</p> : null}
            <button disabled={saving}>{saving ? 'Connexion...' : 'Se connecter'}</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className={`${styles.appShell} ${sidebarCollapsed ? styles.appShellCollapsed : ''}`}>
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
        <div className={styles.sidebarBrandRow}>
          <div className={styles.sidebarBrand}>
            <span className={styles.brandMarkSmall}>B</span>
            <div>
              <strong>BuildTrack</strong>
              <span>Web</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className={`${styles.sidebarToggle} ${sidebarCollapsed ? styles.sidebarToggleCollapsed : ''}`}
          onClick={() => setSidebarCollapsed(value => !value)}
          aria-label={sidebarCollapsed ? 'Déplier le menu principal' : 'Plier le menu principal'}
          title={sidebarCollapsed ? 'Déplier le menu' : 'Plier le menu'}
        >
          <span className={styles.sidebarToggleChevron} aria-hidden="true" />
        </button>
        <nav className={styles.navList} aria-label="Menu principal">
          {NAV_GROUPS.map(group => (
            <div key={group.label} className={styles.navSection}>
              <span className={styles.navSectionLabel}>{group.label}</span>
              <div className={styles.navSectionItems}>
                {group.items.map(tabId => {
                  const tab = TABS.find(item => item.id === tabId)!;
                  return (
                    <button
                      key={tab.id}
                      className={activeTab === tab.id ? styles.navActive : ''}
                      onClick={() => setActiveTab(tab.id)}
                      title={sidebarCollapsed ? tab.label : undefined}
                      aria-label={tab.label}
                    >
                      <span className={styles.navIcon}>{tab.icon}</span>
                      <span className={styles.navLabel}>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className={styles.userBox}>
          <strong>{profile?.name ?? authUser.email}</strong>
          <span>{profile?.role_label ?? profile?.role ?? 'Utilisateur'}</span>
          <button onClick={() => supabaseBrowser.auth.signOut()} title="Déconnexion">
            <span className={styles.logoutIcon}>⎋</span>
            <span className={styles.logoutLabel}>Déconnexion</span>
          </button>
        </div>
      </aside>

      <section className={`${styles.workspace} ${activeTab === 'plans' ? styles.workspacePlans : ''} ${activeTab === 'reserves' ? styles.workspaceReserves : ''}`}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Cockpit web</p>
            <h1>{TABS.find(t => t.id === activeTab)?.label}</h1>
          </div>
          <div className={styles.topbarActions}>
            <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}>
              <option value="all">Tous les chantiers</option>
              {data.chantiers.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            {canEdit(profile) && (
              <>
                <button type="button" onClick={() => openReserveCreate()}>Nouvelle réserve</button>
                <button type="button" onClick={openVisitCreate}>Nouvelle visite</button>
              </>
            )}
            <button onClick={() => session.user && loadEverything(session.user)} disabled={loading}>
              {loading ? 'Synchronisation...' : 'Synchroniser'}
            </button>
          </div>
        </header>

        {error ? <div className={styles.alert}>{error}</div> : null}

        {loading ? (
          <div className={styles.loadingBlock}>Chargement des données BuildTrack...</div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <Dashboard stats={stats} data={data} scoped={projectScoped} setTab={setActiveTab} />
            )}
            {activeTab === 'reserves' && (
              <ReservesView
                allReserves={projectScoped.reserves}
                reserves={filteredReserves}
                photos={projectScoped.photos}
                selectedReserve={selectedFilteredReserve}
                setSelectedReserveId={setSelectedReserveId}
                search={search}
                setSearch={setSearch}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                priorityFilter={priorityFilter}
                setPriorityFilter={setPriorityFilter}
                companyFilter={companyFilter}
                setCompanyFilter={setCompanyFilter}
                buildingFilter={buildingFilter}
                setBuildingFilter={setBuildingFilter}
                pinFilter={pinFilter}
                setPinFilter={setPinFilter}
                structuredFilters={reserveStructuredFilters}
                onStatus={updateReserveStatus}
                onArchive={toggleArchive}
                onDelete={deleteReserveWeb}
                onComment={addReserveComment}
                onCreate={() => openReserveCreate()}
                onEdit={openReserveEdit}
                onFillDescriptions={fillMissingReserveDescriptions}
                onTranslateReserves={translateReserveTexts}
                canUseAssistant={isAdmin(profile)}
                editable={canEdit(profile)}
                saving={saving}
              />
            )}
            {activeTab === 'plans' && (
              <PlansView
                plans={projectScoped.plans}
                reserves={projectScoped.reserves}
                selectedPlan={selectedPlan}
                setSelectedPlanId={setSelectedPlanId}
                setSelectedReserveId={setSelectedReserveId}
                setTab={setActiveTab}
                onCreateReserve={(plan: any) => openReserveCreate({ plan })}
                onCreateReserveAtPin={(plan: any, pin: ReservePinDraft) => openReserveCreate({ plan, pin })}
                editable={canEdit(profile)}
              />
            )}
            {activeTab === 'visites' && (
              <VisitesView
                visites={projectScoped.visites}
                reserves={projectScoped.reserves}
                companies={data.companies}
                onCreateVisit={openVisitCreate}
                onCreateReserveFromVisit={(visit: any) => openReserveCreate({ visit })}
                onOpenReserve={(reserve: any) => {
                  setSelectedReserveId(reserve.id);
                  setActiveTab('reserves');
                }}
                onUnlinkReserve={unlinkReserveFromVisitWeb}
                onArchiveReserve={toggleArchive}
                editable={canEdit(profile)}
              />
            )}
            {activeTab === 'planning' && (
              <PlanningView
                tasks={projectScoped.tasks}
                visites={projectScoped.visites}
                reserves={projectScoped.reserves}
                companies={data.companies}
                editable={canEdit(profile)}
                onUpdateTask={updateTaskQuick}
              />
            )}
            {activeTab === 'messages' && (
              <MessagesView
                channels={data.channels}
                companies={data.companies}
                selectedChannel={selectedChannel}
                setSelectedChannelId={setSelectedChannelId}
                messages={selectedChannelMessages}
                draft={messageDraft}
                setDraft={setMessageDraft}
                onSend={sendMessage}
                saving={saving}
              />
            )}
            {activeTab === 'terrain' && (
              <TerrainView scoped={projectScoped} data={data} />
            )}
            {activeTab === 'media' && (
              <MediaView photos={projectScoped.photos} documents={projectScoped.documents} />
            )}
            {activeTab === 'rapports' && (
              <RapportsView
                stats={stats}
                reserves={filteredReserves}
                plans={projectScoped.plans}
                visites={projectScoped.visites}
                incidents={projectScoped.incidents}
                tasks={projectScoped.tasks}
                selectedReserve={selectedReserve}
                language={reportLanguage}
                setLanguage={setReportLanguage}
                generatingReport={generatingReport}
                onGenerate={generateWebReport}
              />
            )}
            {activeTab === 'equipes' && (
              <EquipesView
                companies={data.companies}
                reserves={projectScoped.reserves}
                tasks={projectScoped.tasks}
                editable={canEdit(profile)}
                onUpdateCompanyField={updateCompanyField}
              />
            )}
            {activeTab === 'settings' && (
              <SettingsView
                profile={profile}
                authUser={authUser}
                preferences={data.notificationPreferences}
                onUpdateNotificationField={updateNotificationField}
              />
            )}
            {activeTab === 'admin' && (
              <AdminView data={data} profile={profile} onUpdateProfile={updateProfileField} />
            )}
          </>
        )}
      </section>
      {reserveModalMode && (
        <ReserveModal
          mode={reserveModalMode}
          draft={reserveDraft}
          setDraft={setReserveDraft}
          data={data}
          selectedProjectId={selectedProjectId}
          saving={saving}
          onClose={closeReserveModal}
          onSubmit={submitReserve}
          onToggleCompany={toggleReserveCompany}
        />
      )}
      {visitModalOpen && (
        <VisitModal
          draft={visitDraft}
          setDraft={setVisitDraft}
          data={data}
          selectedProjectId={selectedProjectId}
          saving={saving}
          currentUserId={authUser?.id}
          onClose={() => setVisitModalOpen(false)}
          onSubmit={submitVisit}
          onToggleCompany={toggleVisitCompany}
        />
      )}
    </main>
  );
}

function Dashboard({ stats, data, scoped, setTab }: any) {
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Réserves actives" value={stats.total} hint={`${stats.open} ouvertes`} />
        <Kpi title="Avancement" value={`${stats.progress}%`} hint={`${stats.closed} levées`} tone="green" />
        <Kpi title="En retard" value={stats.overdue} hint="Échéance dépassée" tone="red" />
        <Kpi title="AR manquants" value={stats.ackMissing} hint="Sous-traitants à relancer" tone="amber" />
      </div>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Vue d’ensemble</h2>
            <p>Supervision web de toutes les données déjà présentes dans l’application mobile.</p>
          </div>
        </div>
        <div className={styles.quickGrid}>
          <Quick label="Plans" value={scoped.plans.length} onClick={() => setTab('plans')} />
          <Quick label="Visites" value={scoped.visites.length} onClick={() => setTab('visites')} />
          <Quick label="Messages récents" value={data.messages.length} onClick={() => setTab('messages')} />
          <Quick label="Documents" value={scoped.documents.length} onClick={() => setTab('terrain')} />
        </div>
      </section>
    </div>
  );
}

function Kpi({ title, value, hint, tone = 'blue' }: { title: string; value: string | number; hint: string; tone?: string }) {
  return (
    <div className={`${styles.kpi} ${styles[`tone_${tone}`] ?? ''}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function Quick({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button className={styles.quick} onClick={onClick}>
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
}

function ReservesView(props: {
  allReserves: any[];
  reserves: any[];
  photos: any[];
  selectedReserve: any;
  setSelectedReserveId: (id: string) => void;
  search: string;
  setSearch: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  priorityFilter: string;
  setPriorityFilter: (value: string) => void;
  companyFilter: string;
  setCompanyFilter: (value: string) => void;
  buildingFilter: string;
  setBuildingFilter: (value: string) => void;
  pinFilter: string;
  setPinFilter: (value: string) => void;
  structuredFilters: { companies: string[]; buildings: string[] };
  onStatus: (id: string, status: string) => void;
  onArchive: (reserve: any) => void;
  onDelete: (reserve: any) => Promise<void> | void;
  onComment: (reserve: any, content: string) => Promise<void> | void;
  onCreate: () => void;
  onEdit: (reserve: any) => void;
  onFillDescriptions: (reserves: any[]) => Promise<void> | void;
  onTranslateReserves: (reserves: any[], language: TextLang) => Promise<void> | void;
  canUseAssistant: boolean;
  editable: boolean;
  saving: boolean;
}) {
  const { allReserves, reserves, selectedReserve } = props;
  const [commentText, setCommentText] = useState('');
  const [assistantLanguage, setAssistantLanguage] = useState<TextLang>('fr');
  const [assistantScope, setAssistantScope] = useState<'view' | 'project'>('view');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const activeReserves = allReserves.filter(reserve => !isReserveArchived(reserve));
  const assistantTargets = assistantScope === 'project' ? activeReserves : reserves;
  const assistantMissingDescriptionCount = assistantTargets.filter(reserve => reserve.title?.trim() && isReserveDescriptionMissing(reserve.description)).length;
  const advancedFilterActive =
    props.priorityFilter !== 'all' ||
    props.companyFilter !== 'all' ||
    props.buildingFilter !== 'all' ||
    props.pinFilter !== 'all';
  const selectedPhotos = reservePhotoItems(selectedReserve, props.photos);
  const selectedLocalOnlyPhotos = localOnlyPhotoCount(selectedReserve, props.photos);
  const filterCounts = RESERVE_FILTER_OPTIONS.reduce<Record<string, number>>((acc, option) => {
    acc[option.key] =
      option.key === 'all'
        ? activeReserves.length
        : option.key === 'archived'
          ? allReserves.filter(isReserveArchived).length
          : option.key === 'overdue'
            ? activeReserves.filter(isReserveOverdue).length
            : option.key === 'due_soon'
              ? activeReserves.filter(reserve => isReserveDueSoon(reserve)).length
              : option.key === 'ack_missing'
                ? activeReserves.filter(needsEnterpriseAck).length
                : option.key === 'ack_received'
                  ? activeReserves.filter(hasEnterpriseAck).length
                : activeReserves.filter(reserve => reserve.status === option.key).length;
    return acc;
  }, {});
  const quickStatusKeys = new Set(['all', 'open', 'in_progress', 'waiting']);
  const quickStatusOptions = RESERVE_FILTER_OPTIONS.filter(option => quickStatusKeys.has(option.key) || option.key === props.statusFilter);
  const advancedStatusOptions = RESERVE_FILTER_OPTIONS.filter(option => !quickStatusKeys.has(option.key));
  const advancedFilterCount = [
    props.priorityFilter,
    props.companyFilter,
    props.buildingFilter,
    props.pinFilter,
  ].filter(value => value !== 'all').length + (quickStatusKeys.has(props.statusFilter) ? 0 : 1);

  useEffect(() => {
    if (advancedFilterActive || !quickStatusKeys.has(props.statusFilter)) {
      setShowAdvancedFilters(true);
    }
  }, [advancedFilterActive, props.statusFilter]);

  return (
    <div className={styles.reservesLayout}>
      <section className={`${styles.panel} ${styles.reservesListPanel}`}>
        <div className={styles.reservePanelHeader}>
          <div>
            <p className={styles.eyebrow}>Suivi chantier</p>
            <h2>Réserves</h2>
          </div>
          {props.editable && <button type="button" onClick={props.onCreate}>Créer</button>}
        </div>
        <div className={styles.reserveSearchRow}>
          <span>⌕</span>
          <input placeholder="Titre, bâtiment, entreprise, lot..." value={props.search} onChange={e => props.setSearch(e.target.value)} />
          {props.search.trim() && (
            <button type="button" onClick={() => props.setSearch('')} aria-label="Effacer la recherche">×</button>
          )}
        </div>
        <div className={styles.reserveCompactToolbar}>
          <div className={styles.reserveFilterRail}>
            {quickStatusOptions.map(option => {
              const active = props.statusFilter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={active ? styles.reserveFilterChipActive : ''}
                  onClick={() => props.setStatusFilter(option.key)}
                >
                  <span>{option.label}</span>
                  <em>{filterCounts[option.key] ?? 0}</em>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className={`${styles.reserveFilterToggle} ${showAdvancedFilters ? styles.reserveFilterToggleActive : ''}`}
            onClick={() => setShowAdvancedFilters(value => !value)}
          >
            Filtres
            {advancedFilterCount > 0 && <em>{advancedFilterCount}</em>}
          </button>
        </div>
        {showAdvancedFilters && (
          <div className={styles.reserveAdvancedPanel}>
            <div className={styles.reserveAdvancedStatusGrid}>
              {advancedStatusOptions.map(option => {
                const active = props.statusFilter === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={active ? styles.reserveFilterChipActive : ''}
                    onClick={() => props.setStatusFilter(option.key)}
                  >
                    <span>{option.label}</span>
                    <em>{filterCounts[option.key] ?? 0}</em>
                  </button>
                );
              })}
            </div>
            <div className={styles.reserveAdvancedFiltersWeb}>
              <select value={props.priorityFilter} onChange={event => props.setPriorityFilter(event.target.value)} aria-label="Filtrer par priorité">
                <option value="all">Toutes priorités</option>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={props.companyFilter} onChange={event => props.setCompanyFilter(event.target.value)} aria-label="Filtrer par entreprise">
                <option value="all">Toutes entreprises</option>
                {props.structuredFilters.companies.map(company => <option key={company} value={company}>{company}</option>)}
              </select>
              <select value={props.buildingFilter} onChange={event => props.setBuildingFilter(event.target.value)} aria-label="Filtrer par bâtiment">
                <option value="all">Tous bâtiments</option>
                {props.structuredFilters.buildings.map(building => <option key={building} value={building}>{building}</option>)}
              </select>
              <select value={props.pinFilter} onChange={event => props.setPinFilter(event.target.value)} aria-label="Filtrer par épingle">
                <option value="all">Toutes localisations</option>
                <option value="pinned">Épinglées</option>
                <option value="unpinned">Non épinglées</option>
              </select>
              {(advancedFilterActive || props.statusFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    props.setStatusFilter('all');
                    props.setPriorityFilter('all');
                    props.setCompanyFilter('all');
                    props.setBuildingFilter('all');
                    props.setPinFilter('all');
                  }}
                >
                  Réinitialiser
                </button>
              )}
            </div>
          </div>
        )}
        <div className={styles.reserveListMeta}>
          <span>{reserves.length} affichée{reserves.length > 1 ? 's' : ''}</span>
          <span>{activeReserves.length} active{activeReserves.length > 1 ? 's' : ''}</span>
        </div>
        {props.canUseAssistant && (
          <div className={styles.reserveAssistantPanel}>
            <button type="button" className={styles.reserveAssistantSummary} onClick={() => setAssistantOpen(value => !value)}>
              <span>
                <strong>Assistant réserves</strong>
                <small>{assistantMissingDescriptionCount} description{assistantMissingDescriptionCount > 1 ? 's' : ''} à compléter · traduction groupée</small>
              </span>
              <em>{assistantOpen ? 'Masquer' : 'Ouvrir'}</em>
            </button>
            {assistantOpen && (
              <div className={styles.reserveAssistantControls}>
                <select
                  value={assistantScope}
                  onChange={event => setAssistantScope(event.target.value as 'view' | 'project')}
                  disabled={props.saving}
                  aria-label="Périmètre assistant"
                >
                  <option value="view">Vue actuelle</option>
                  <option value="project">Tout le chantier</option>
                </select>
                <button
                  type="button"
                  disabled={props.saving || assistantMissingDescriptionCount === 0}
                  onClick={() => props.onFillDescriptions(assistantTargets)}
                >
                  Compléter les descriptions
                </button>
                <select
                  value={assistantLanguage}
                  onChange={event => setAssistantLanguage(event.target.value as TextLang)}
                  disabled={props.saving}
                  aria-label="Langue de traduction"
                >
                  {TEXT_LANG_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <button
                  type="button"
                  disabled={props.saving || assistantTargets.length === 0}
                  onClick={() => props.onTranslateReserves(assistantTargets, assistantLanguage)}
                >
                  Traduire les textes
                </button>
              </div>
            )}
          </div>
        )}
        <div className={styles.reserveList}>
          {reserves.map(reserve => (
            <button
              key={reserve.id}
              className={`${styles.reserveRow} ${selectedReserve?.id === reserve.id ? styles.reserveRowActive : ''}`}
              onClick={() => props.setSelectedReserveId(reserve.id)}
            >
              <div>
                <span className={`${styles.dot} ${styles[`priority_${reserve.priority}`] ?? ''}`} />
                <strong>{reserve.id}</strong>
              </div>
              <div>
                <strong>{reserve.title}</strong>
                <small>{[reserve.building, reserve.level, reserve.zone].filter(Boolean).join(' · ') || 'Sans localisation'}</small>
                <span>{reserveCompanies(reserve).join(', ') || 'Sans entreprise'}</span>
              </div>
              <em className={isReserveOverdue(reserve) ? styles.reserveStatusOverdue : ''}>
                {isReserveArchived(reserve) ? 'Archivée' : isReserveOverdue(reserve) ? 'En retard' : STATUS_LABELS[reserve.status] ?? reserve.status}
              </em>
            </button>
          ))}
          {!reserves.length && <p className={styles.empty}>Aucune réserve avec ces filtres.</p>}
        </div>
      </section>

      <section className={`${styles.panel} ${styles.reservesDetailPanel}`}>
        {selectedReserve ? (
          <>
            <div className={styles.reserveDetailHeader}>
              <div>
                <p className={styles.eyebrow}>{selectedReserve.id}</p>
                <h2>{selectedReserve.title}</h2>
                <span>{[selectedReserve.building, selectedReserve.level, selectedReserve.zone].filter(Boolean).join(' · ') || 'Sans localisation'}</span>
              </div>
              <span className={styles.badge}>{PRIORITY_LABELS[selectedReserve.priority] ?? selectedReserve.priority}</span>
            </div>
            <div className={styles.reserveDetailBody}>
            <p className={styles.description}>{selectedReserve.description || 'Aucune description.'}</p>
            <dl className={styles.metaGrid}>
              <div><dt>Statut</dt><dd>{STATUS_LABELS[selectedReserve.status] ?? selectedReserve.status}</dd></div>
              <div><dt>Entreprise</dt><dd>{reserveCompanies(selectedReserve).join(', ') || '—'}</dd></div>
              <div><dt>Échéance</dt><dd>{prettyDate(selectedReserve.deadline)}</dd></div>
              <div><dt>Plan</dt><dd>{selectedReserve.plan_id ? 'Épinglée' : 'Non épinglée'}</dd></div>
              <div><dt>Accusé réception</dt><dd>{selectedReserve.enterprise_acknowledged_at ? prettyDate(selectedReserve.enterprise_acknowledged_at, true) : 'Manquant'}</dd></div>
              <div><dt>Archive</dt><dd>{selectedReserve.archived_at ? prettyDate(selectedReserve.archived_at, true) : 'Active'}</dd></div>
            </dl>
            {selectedPhotos.length ? (
              <div className={styles.reserveDetailPhotos}>
                <div>
                  <h3>Photos</h3>
                  <span>{selectedPhotos.length} média{selectedPhotos.length > 1 ? 's' : ''} associé{selectedPhotos.length > 1 ? 's' : ''}</span>
                </div>
                <div className={styles.reserveDetailPhotoGrid}>
                  {selectedPhotos.map(photo => (
                    <a key={photo.id ?? photo.uri} href={photo.uri} target="_blank" rel="noreferrer">
                      <img src={photo.uri} alt={photo.comment ?? photo.name ?? 'Photo réserve'} />
                      <span>{photo.kind === 'resolution' ? 'Levée' : 'Constat'}</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : selectedLocalOnlyPhotos ? (
              <div className={styles.reserveDetailPhotoNotice}>
                <strong>Photos en attente de synchronisation</strong>
                <span>
                  {selectedLocalOnlyPhotos} photo{selectedLocalOnlyPhotos > 1 ? 's' : ''} visible{selectedLocalOnlyPhotos > 1 ? 's' : ''} sur mobile
                  {selectedLocalOnlyPhotos > 1 ? ' ne sont' : " n'est"} pas encore disponible{selectedLocalOnlyPhotos > 1 ? 's' : ''} sur le web.
                </span>
              </div>
            ) : null}
            <form
              className={styles.commentForm}
              onSubmit={async event => {
                event.preventDefault();
                if (!commentText.trim()) return;
                await props.onComment(selectedReserve, commentText);
                setCommentText('');
              }}
            >
              <input
                value={commentText}
                onChange={event => setCommentText(event.target.value)}
                placeholder="Ajouter un commentaire de suivi..."
              />
              <button type="submit" disabled={props.saving || !commentText.trim()}>Ajouter</button>
              <div className={styles.commentAssist}>
                <TextAssistControls
                  value={commentText}
                  onChange={setCommentText}
                  context="reserve comment"
                />
              </div>
            </form>
            {props.editable && (
              <div className={styles.actionBar}>
                <button type="button" onClick={() => props.onEdit(selectedReserve)}>Modifier</button>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <button type="button" key={value} disabled={props.saving || selectedReserve.status === value} onClick={() => props.onStatus(selectedReserve.id, value)}>
                    {label}
                  </button>
                ))}
                <button type="button" onClick={() => props.onArchive(selectedReserve)}>{selectedReserve.archived_at ? 'Désarchiver' : 'Archiver'}</button>
                <button type="button" className={styles.dangerButton} onClick={() => props.onDelete(selectedReserve)}>Supprimer</button>
              </div>
            )}
            <HistoryBlock title="Commentaires" rows={selectedReserve.comments ?? []} />
            <HistoryBlock title="Historique" rows={selectedReserve.history ?? []} />
            </div>
          </>
        ) : (
          <p className={styles.empty}>Sélectionnez une réserve.</p>
        )}
      </section>
    </div>
  );
}

function HistoryBlock({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className={styles.historyBlock}>
      <h3>{title}</h3>
      {rows?.length ? rows.slice(-6).map((row, idx) => (
        <div key={row.id ?? idx} className={styles.timelineItem}>
          <strong>{row.author ?? row.action ?? 'Action'}</strong>
          <span>{row.content ?? row.newValue ?? row.createdAt ?? ''}</span>
        </div>
      )) : <small>Aucun élément.</small>}
    </div>
  );
}

function WebPdfPlan({
  uri,
  name,
  pins,
  focusedReserveId,
  canCreate,
  placementPreview,
  onCreateReserveAtPin,
  onPinClick,
  onPinDoubleClick,
}: {
  uri: string;
  name: string;
  pins: PlanPin[];
  focusedReserveId?: string | null;
  canCreate?: boolean;
  placementPreview?: PinPlacementPreview | null;
  onCreateReserveAtPin?: (x: number, y: number) => void;
  onPinClick: (reserveId: string) => void;
  onPinDoubleClick: (reserveId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const lastFocusZoomRef = useRef('');
  const [scale, setScale] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setScale(0);
    setPageSize({ width: 0, height: 0 });
    setError('');
    lastFocusZoomRef.current = '';
  }, [uri]);

  useEffect(() => {
    if (!focusedReserveId || !scale) return;
    const key = `${uri}:${focusedReserveId}`;
    if (lastFocusZoomRef.current === key) return;
    lastFocusZoomRef.current = key;
    setScale(value => {
      const current = value || scale || 1;
      return Math.min(3, Number((current * 1.8).toFixed(2)));
    });
  }, [focusedReserveId, scale, uri]);

  useEffect(() => {
    if (!focusedReserveId || !pageSize.width || !pageSize.height || !viewportRef.current) return;
    const pin = pins.find(item => item.reserve.id === focusedReserveId);
    if (!pin) return;
    const viewport = viewportRef.current;
    const left = (pin.x / 100) * pageSize.width;
    const top = (pin.y / 100) * pageSize.height;
    viewport.scrollTo({
      left: Math.max(0, left - viewport.clientWidth / 2),
      top: Math.max(0, top - viewport.clientHeight / 2),
      behavior: 'smooth',
    });
  }, [focusedReserveId, pageSize.height, pageSize.width, pins]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;

    async function renderPdfPage() {
      setLoading(true);
      setError('');
      try {
        const pdfjs: any = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc ||= `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
        loadingTask = pdfjs.getDocument({ url: uri });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        if (!scale) {
          const availableWidth = Math.max((viewportRef.current?.clientWidth ?? 900) - 32, 320);
          const fitScale = Math.min(1.2, Math.max(0.22, (availableWidth / baseViewport.width) * 1.18));
          setScale(Number(fitScale.toFixed(2)));
          return;
        }

        const viewport = page.getViewport({ scale });
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas PDF indisponible');

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setPageSize({ width: viewport.width, height: viewport.height });

        renderTaskRef.current?.cancel?.();
        const renderContext: any = {
          canvasContext: context,
          viewport,
        };
        if (outputScale !== 1) {
          renderContext.transform = [outputScale, 0, 0, outputScale, 0, 0];
        }
        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!cancelled) setLoading(false);
      } catch (pdfError: any) {
        if (cancelled || pdfError?.name === 'RenderingCancelledException') return;
        setError(pdfError?.message ?? 'Impossible de charger le PDF');
        setLoading(false);
      }
    }

    renderPdfPage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
      loadingTask?.destroy?.();
    };
  }, [uri, scale]);

  function handlePageClick(event: MouseEvent<HTMLDivElement>) {
    if (!canCreate) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
    const y = clampPercent(((event.clientY - rect.top) / rect.height) * 100);
    onCreateReserveAtPin?.(x, y);
  }

  return (
    <div className={styles.webPdfShell}>
      <div className={styles.webPdfToolbar}>
        <div className={styles.webPdfZoomControls}>
          <button type="button" onClick={() => setScale(value => Math.max(0.08, Number(((value || 1) - 0.1).toFixed(2))))}>−</button>
          <strong>{scale ? Math.round(scale * 100) : '…'}%</strong>
          <button type="button" onClick={() => setScale(value => Math.min(3, Number(((value || 1) + 0.1).toFixed(2))))}>+</button>
        </div>
        <button type="button" onClick={() => setScale(0)}>Adapter</button>
        <a href={uri} target="_blank" rel="noreferrer">Ouvrir le PDF</a>
      </div>
      <div ref={viewportRef} className={styles.webPdfViewport}>
        <div
          className={styles.webPdfPage}
          style={pageSize.width && pageSize.height ? { width: pageSize.width, height: pageSize.height } : undefined}
          onClick={handlePageClick}
          aria-label={name}
        >
          <canvas ref={canvasRef} className={styles.webPdfCanvas} />
          {loading && <div className={styles.webPdfLoading}>Chargement du plan…</div>}
          {error && (
            <div className={styles.webPdfError}>
              <strong>Plan PDF indisponible</strong>
              <span>{error}</span>
            </div>
          )}
          {placementPreview && (
            <div
              key={placementPreview.id}
              className={styles.pinPlacementPreview}
              style={{ left: `${placementPreview.x}%`, top: `${placementPreview.y}%` }}
            >
              <span>{placementPreview.label}</span>
            </div>
          )}
          {pins.map((pin) => (
            <button
              key={pin.reserve.id}
              className={`${styles.pin} ${focusedReserveId === pin.reserve.id ? styles.pinFocused : ''}`}
              style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
              title={`${pin.reserve.title} · double-clic pour ouvrir la réserve`}
              aria-label={`Mettre en avant l'épingle ${pin.number}. Double-clic pour ouvrir la réserve.`}
              onClick={event => {
                event.stopPropagation();
                onPinClick(pin.reserve.id);
              }}
              onDoubleClick={event => {
                event.stopPropagation();
                onPinDoubleClick(pin.reserve.id);
              }}
            >
              {pin.number}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlansView({
  plans,
  reserves,
  selectedPlan,
  setSelectedPlanId,
  setSelectedReserveId,
  setTab,
  onCreateReserve,
  onCreateReserveAtPin,
  editable,
}: any) {
  const [buildingQuery, setBuildingQuery] = useState('');
  const [selectedBuildingKey, setSelectedBuildingKey] = useState('all');
  const [activeFamilyKey, setActiveFamilyKey] = useState('all');
  const [selectedPlanReserveId, setSelectedPlanReserveId] = useState<string | null>(null);
  const [focusedPlanReserveId, setFocusedPlanReserveId] = useState<string | null>(null);
  const [pinPlacementPreview, setPinPlacementPreview] = useState<PinPlacementPreview | null>(null);
  const pinPlacementTimerRef = useRef<number | null>(null);
  const planReserves = selectedPlan ? reserves.filter((r: any) => r.plan_id === selectedPlan.id) : [];
  const selectedPlanReserve = planReserves.find((reserve: any) => reserve.id === selectedPlanReserveId) ?? null;
  const selectedPlanBuildingKey = selectedPlan ? getPlanBuildingKey(selectedPlan) : 'all';
  const buildingGroups = useMemo(() => {
    const map = new Map<string, {
      key: string;
      name: string;
      plans: any[];
      planIds: Set<string>;
      levels: Set<string>;
      reserveCount: number;
    }>();

    for (const plan of plans) {
      const key = getPlanBuildingKey(plan);
      const group = map.get(key) ?? {
        key,
        name: getPlanBuildingName(plan),
        plans: [],
        planIds: new Set<string>(),
        levels: new Set<string>(),
        reserveCount: 0,
      };
      group.plans.push(plan);
      group.planIds.add(plan.id);
      const level = getPlanLevelName(plan);
      if (level) group.levels.add(level);
      map.set(key, group);
    }

    const reserveIdsByBuilding = new Map<string, Set<string>>();
    for (const reserve of reserves) {
      if (reserve.archived_at || reserve.archivedAt) continue;
      const keys = new Set<string>();
      if (reserve.plan_id) {
        const planGroup = [...map.values()].find(group => group.planIds.has(reserve.plan_id));
        if (planGroup) keys.add(planGroup.key);
      }
      keys.add(getReserveBuildingKey(reserve));
      keys.forEach(key => {
        if (!map.has(key)) return;
        const ids = reserveIdsByBuilding.get(key) ?? new Set<string>();
        ids.add(reserve.id);
        reserveIdsByBuilding.set(key, ids);
      });
    }

    return [...map.values()]
      .map(group => ({
        ...group,
        reserveCount: reserveIdsByBuilding.get(group.key)?.size ?? 0,
        levels: [...group.levels].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })),
        plans: group.plans.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'fr', { numeric: true, sensitivity: 'base' })),
      }))
      .sort((a, b) => {
        if (a.key === '__none__') return 1;
        if (b.key === '__none__') return -1;
        return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
      });
  }, [plans, reserves]);
  const buildingFamilies = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; groups: typeof buildingGroups }>();
    const others: typeof buildingGroups = [];

    for (const group of buildingGroups) {
      const family = group.key === '__none__' ? null : parseBuildingFamily(group.name);
      if (!family) {
        others.push(group);
        continue;
      }
      const bucket = buckets.get(family.key) ?? { key: family.key, label: family.label, groups: [] as typeof buildingGroups };
      bucket.groups.push(group);
      buckets.set(family.key, bucket);
    }

    const realFamilies = [...buckets.values()]
      .filter(family => family.groups.length >= 2)
      .sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true, sensitivity: 'base' }));
    const groupedKeys = new Set(realFamilies.flatMap(family => family.groups.map(group => group.key)));
    const ungrouped = [
      ...others,
      ...[...buckets.values()].flatMap(family => family.groups.filter(group => !groupedKeys.has(group.key))),
    ].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
    const useGrouping = realFamilies.length >= 2 && buildingGroups.length >= 8;
    return {
      useGrouping,
      families: useGrouping
        ? [
            ...realFamilies,
            ...(ungrouped.length ? [{ key: '__others__', label: 'Autres', groups: ungrouped }] : []),
          ]
        : [],
      familyOf: new Map(realFamilies.flatMap(family => family.groups.map(group => [group.key, family.key] as const))),
    };
  }, [buildingGroups]);
  useEffect(() => {
    if (!buildingFamilies.useGrouping && activeFamilyKey !== 'all') setActiveFamilyKey('all');
    if (buildingFamilies.useGrouping && activeFamilyKey !== 'all' && !buildingFamilies.families.some(family => family.key === activeFamilyKey)) {
      setActiveFamilyKey('all');
    }
  }, [activeFamilyKey, buildingFamilies]);
  const filteredBuildingGroups = useMemo(() => {
    const query = normalizeSearchText(buildingQuery);
    const familyFiltered = !query && buildingFamilies.useGrouping && activeFamilyKey !== 'all'
      ? buildingGroups.filter(group => (buildingFamilies.familyOf.get(group.key) ?? '__others__') === activeFamilyKey)
      : buildingGroups;
    if (!query) {
      return familyFiltered.map(group => ({ ...group, displayPlans: group.plans }));
    }
    return familyFiltered
      .map(group => {
        const groupMatches = normalizeSearchText(group.name).includes(query);
        const displayPlans = groupMatches
          ? group.plans
          : group.plans.filter(plan => normalizeSearchText([
              plan.name,
              getPlanBuildingName(plan),
              getPlanLevelName(plan),
              plan.revision_code,
              plan.file_type,
            ].filter(Boolean).join(' ')).includes(query));
        return { ...group, displayPlans };
      })
      .filter(group => group.displayPlans.length > 0);
  }, [activeFamilyKey, buildingFamilies, buildingGroups, buildingQuery]);
  const totalReserveCount = buildingGroups.reduce((sum, group) => sum + group.reserveCount, 0);
  useEffect(() => {
    setSelectedPlanReserveId(null);
    setFocusedPlanReserveId(null);
    setPinPlacementPreview(null);
  }, [selectedPlan?.id]);
  useEffect(() => {
    if (!focusedPlanReserveId) return;
    const timer = window.setTimeout(() => setFocusedPlanReserveId(null), 7000);
    return () => window.clearTimeout(timer);
  }, [focusedPlanReserveId]);
  useEffect(() => {
    return () => {
      if (pinPlacementTimerRef.current) window.clearTimeout(pinPlacementTimerRef.current);
    };
  }, []);
  const handleSelectBuildingGroup = (group: { key: string; plans: any[] }) => {
    setSelectedBuildingKey(group.key);
    if (!group.plans.some(plan => plan.id === selectedPlan?.id) && group.plans[0]) {
      setSelectedPlanId(group.plans[0].id);
    }
  };
  const openReserveFromPin = (reserveId: string) => {
    setSelectedReserveId(reserveId);
    setTab('reserves');
  };
  const assignOrCreatePinAt = (x: number, y: number) => {
    if (!selectedPlan) return;
    const nextX = Math.round(clampPercent(x));
    const nextY = Math.round(clampPercent(y));
    const preview: PinPlacementPreview = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      planId: selectedPlan.id,
      x: nextX,
      y: nextY,
      label: 'Nouvelle épingle',
    };
    setPinPlacementPreview(preview);
    if (pinPlacementTimerRef.current) window.clearTimeout(pinPlacementTimerRef.current);
    if (!editable) return;
    pinPlacementTimerRef.current = window.setTimeout(() => {
      setPinPlacementPreview(null);
      onCreateReserveAtPin(selectedPlan, { planId: selectedPlan.id, x: nextX, y: nextY });
    }, 520);
  };
  const planPins = planReserves
    .map((reserve: any, idx: number) => {
      const rawX = Number(reserve.plan_x);
      const rawY = Number(reserve.plan_y);
      // Historical web pins could be saved as 0..1. Mobile pins are 0..100.
      const ratioMode = Number.isFinite(rawX) && Number.isFinite(rawY) && Math.abs(rawX) <= 1 && Math.abs(rawY) <= 1;
      return {
        reserve,
        number: idx + 1,
        x: planCoordinateToPercent(reserve.plan_x, ratioMode),
        y: planCoordinateToPercent(reserve.plan_y, ratioMode),
      };
    })
    .filter((pin: any) => pin.x != null && pin.y != null) as PlanPin[];
  const activePlacementPreview = selectedPlan && pinPlacementPreview?.planId === selectedPlan.id
    ? pinPlacementPreview
    : null;
  return (
    <div className={`${styles.twoCols} ${styles.plansLayout}`}>
      <section className={`${styles.panel} ${styles.plansListPanel}`}>
        <div className={styles.buildingRailHeaderWeb}>
          <div>
            <span>Bâtiments</span>
            <strong>{buildingGroups.length}</strong>
          </div>
          <small>Recherche, familles et plans regroupés.</small>
        </div>
        <label className={styles.buildingRailSearchWeb}>
          <span>⌕</span>
          <input
            value={buildingQuery}
            onChange={event => setBuildingQuery(event.target.value)}
            placeholder="Rechercher bâtiment, niveau, plan..."
          />
          {buildingQuery && (
            <button type="button" onClick={() => setBuildingQuery('')} aria-label="Effacer la recherche">×</button>
          )}
        </label>
        {buildingFamilies.useGrouping && !buildingQuery && (
          <div className={styles.buildingFamilyRowWeb}>
            <button
              type="button"
              className={activeFamilyKey === 'all' ? styles.buildingFamilyActiveWeb : ''}
              onClick={() => setActiveFamilyKey('all')}
            >
              Tous <em>{buildingGroups.length}</em>
            </button>
            {buildingFamilies.families.map(family => (
              <button
                key={family.key}
                type="button"
                className={activeFamilyKey === family.key ? styles.buildingFamilyActiveWeb : ''}
                onClick={() => setActiveFamilyKey(family.key)}
              >
                {family.label} <em>{family.groups.length}</em>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={`${styles.buildingAllRowWeb} ${selectedBuildingKey === 'all' ? styles.buildingGroupActiveWeb : ''}`}
          onClick={() => setSelectedBuildingKey('all')}
        >
          <span>▦</span>
          <strong>Tous les bâtiments</strong>
          <small>{plans.length} plans · {totalReserveCount} réserves</small>
        </button>
        <div className={`${styles.list} ${styles.plansList}`}>
          {filteredBuildingGroups.map((group: any) => {
            const isSelectedGroup = selectedBuildingKey === group.key || (selectedBuildingKey === 'all' && selectedPlanBuildingKey === group.key);
            const isExpanded = Boolean(buildingQuery) || isSelectedGroup;
            return (
              <article key={group.key} className={`${styles.buildingGroupWeb} ${isSelectedGroup ? styles.buildingGroupActiveWeb : ''}`}>
                <button type="button" className={styles.buildingGroupButtonWeb} onClick={() => handleSelectBuildingGroup(group)}>
                  <span className={styles.buildingGroupIconWeb}>{group.key === '__none__' ? '◇' : '▥'}</span>
                  <div>
                    <strong>{group.name}</strong>
                    <small>
                      {group.plans.length} plans
                      {group.levels.length ? ` · ${group.levels.slice(0, 3).join(', ')}${group.levels.length > 3 ? '…' : ''}` : ''}
                    </small>
                  </div>
                  <em>{group.reserveCount}</em>
                </button>
                {isExpanded && (
                  <div className={styles.buildingPlanListWeb}>
                    {group.displayPlans.map((plan: any) => {
                      const planReserveCount = reserves.filter((reserve: any) => reserve.plan_id === plan.id && !reserve.archived_at && !reserve.archivedAt).length;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={`${styles.buildingPlanRowWeb} ${selectedPlan?.id === plan.id ? styles.selectedRow : ''}`}
                          onClick={() => {
                            setSelectedBuildingKey(group.key);
                            setSelectedPlanId(plan.id);
                          }}
                        >
                          <span>▤</span>
                          <div>
                            <strong>{plan.name}</strong>
                            <small>{[getPlanLevelName(plan), plan.revision_code].filter(Boolean).join(' · ') || 'Plan'}</small>
                          </div>
                          <em>{planReserveCount}</em>
                        </button>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
          {filteredBuildingGroups.length === 0 && (
            <p className={styles.empty}>Aucun bâtiment ou plan ne correspond à cette recherche.</p>
          )}
          {!plans.length && <p className={styles.empty}>Aucun plan dans ce périmètre.</p>}
        </div>
      </section>
      <section className={`${styles.panel} ${styles.plansPreviewPanel}`}>
        {selectedPlan ? (
          <>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.eyebrow}>{selectedPlan.file_type ?? 'plan'}</p>
                <h2>{selectedPlan.name}</h2>
              </div>
              <div className={styles.inlineActions}>
                <button type="button" onClick={() => onCreateReserve(selectedPlan)}>Créer une réserve</button>
                {selectedPlan.uri ? <a className={styles.linkButton} href={selectedPlan.uri} target="_blank">Ouvrir le fichier</a> : null}
              </div>
            </div>
            {editable && (
              <div className={styles.pinToolbar}>
                <div className={styles.pinToolbarIntro}>
                  <strong>Créer une réserve épinglée</strong>
                  <span>Cliquez directement sur le PDF pour créer une nouvelle réserve à l’endroit exact.</span>
                </div>
                <div className={styles.pinToolbarAction}>
                  <span>+</span>
                  <div>
                    <strong>Création par clic</strong>
                    <small>L’épingle est mémorisée puis le formulaire de réserve s’ouvre.</small>
                  </div>
                </div>
              </div>
            )}
            <div className={styles.planWorkArea}>
              <div className={styles.planCanvas}>
                {selectedPlan.uri && selectedPlan.file_type === 'image' ? (
                  <img src={selectedPlan.uri} alt={selectedPlan.name} />
                ) : selectedPlan.uri && selectedPlan.file_type === 'pdf' ? (
                  <WebPdfPlan
                    uri={selectedPlan.uri}
                    name={selectedPlan.name}
                    pins={planPins}
                    focusedReserveId={focusedPlanReserveId}
                    canCreate={editable}
                    placementPreview={activePlacementPreview}
                    onCreateReserveAtPin={assignOrCreatePinAt}
                    onPinClick={(reserveId) => {
                      setSelectedPlanReserveId(reserveId);
                      setFocusedPlanReserveId(reserveId);
                    }}
                    onPinDoubleClick={openReserveFromPin}
                  />
                ) : (
                  <div className={styles.planPlaceholder}>Aperçu web disponible dès que le fichier est accessible.</div>
                )}
                {selectedPlan.file_type !== 'pdf' && editable && (
                  <button
                    type="button"
                    className={`${styles.pinClickLayer} ${styles.pinCreateLayer}`}
                    aria-label="Cliquer pour créer une réserve à cet endroit"
                    onClick={event => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      assignOrCreatePinAt(
                        ((event.clientX - rect.left) / rect.width) * 100,
                        ((event.clientY - rect.top) / rect.height) * 100,
                      );
                    }}
                  />
                )}
                {selectedPlan.file_type !== 'pdf' && planPins.map((pin) => (
                    <button
                      key={pin.reserve.id}
                      className={`${styles.pin} ${focusedPlanReserveId === pin.reserve.id ? styles.pinFocused : ''}`}
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                      title={`${pin.reserve.title} · double-clic pour ouvrir la réserve`}
                      aria-label={`Mettre en avant l'épingle ${pin.number}. Double-clic pour ouvrir la réserve.`}
                      onClick={event => {
                        event.stopPropagation();
                        setSelectedPlanReserveId(pin.reserve.id);
                        setFocusedPlanReserveId(pin.reserve.id);
                      }}
                      onDoubleClick={event => {
                        event.stopPropagation();
                        openReserveFromPin(pin.reserve.id);
                      }}
                    >
                      {pin.number}
                    </button>
                  ))}
                {selectedPlan.file_type !== 'pdf' && activePlacementPreview && (
                  <div
                    key={activePlacementPreview.id}
                    className={styles.pinPlacementPreview}
                    style={{ left: `${activePlacementPreview.x}%`, top: `${activePlacementPreview.y}%` }}
                  >
                    <span>{activePlacementPreview.label}</span>
                  </div>
                )}
              </div>
              <aside className={styles.planReservePanel}>
                <div className={styles.planReserveHeader}>
                  <div>
                    <h3>Réserves</h3>
                    <span>{planReserves.length} sur ce plan</span>
                  </div>
                  <strong>{planPins.length} épinglées</strong>
                </div>
                <div className={styles.planReserveList}>
                  {planReserves.map((reserve: any, idx: number) => (
                    <button
                      key={reserve.id}
                      className={`${styles.planReserveRow} ${selectedPlanReserveId === reserve.id ? styles.planReserveRowActive : ''}`}
                      onClick={() => setSelectedPlanReserveId(reserve.id)}
                    >
                      <span className={styles.planReserveNumber}>{idx + 1}</span>
                      <span>
                        <strong>{reserve.title}</strong>
                        <small>{[STATUS_LABELS[reserve.status] ?? reserve.status, reserve.company_name, reserve.zone].filter(Boolean).join(' · ')}</small>
                      </span>
                    </button>
                  ))}
                  {!planReserves.length && (
                    <div className={styles.planReserveEmpty}>
                      <strong>Aucune réserve</strong>
                      <span>Les réserves épinglées sur ce plan apparaîtront ici.</span>
                    </div>
                  )}
                </div>
                {selectedPlanReserve && (
                  <div className={styles.planReserveQuickCard}>
                    <div className={styles.planReserveQuickHeader}>
                      <span className={styles.planReserveNumber}>
                        {planReserves.findIndex((reserve: any) => reserve.id === selectedPlanReserve.id) + 1}
                      </span>
                      <div>
                        <strong>{selectedPlanReserve.title}</strong>
                        <small>{[STATUS_LABELS[selectedPlanReserve.status] ?? selectedPlanReserve.status, selectedPlanReserve.company_name, selectedPlanReserve.level].filter(Boolean).join(' · ')}</small>
                      </div>
                      <button type="button" onClick={() => setSelectedPlanReserveId(null)} aria-label="Fermer">×</button>
                    </div>
                    {selectedPlanReserve.description && (
                      <p>{selectedPlanReserve.description}</p>
                    )}
                    <div className={styles.planReserveQuickActions}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReserveId(selectedPlanReserve.id);
                          setTab('reserves');
                        }}
                      >
                        Voir la réserve
                      </button>
                      <button
                        type="button"
                        disabled={selectedPlanReserve.plan_x == null || selectedPlanReserve.plan_y == null}
                        onClick={() => setFocusedPlanReserveId(selectedPlanReserve.id)}
                      >
                        {selectedPlanReserve.plan_x == null || selectedPlanReserve.plan_y == null ? 'Pas d’épingle' : 'Voir sur le plan'}
                      </button>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </>
        ) : <p className={styles.empty}>Sélectionnez un plan.</p>}
      </section>
    </div>
  );
}

function VisitesView({
  visites,
  reserves,
  companies,
  onCreateVisit,
  onCreateReserveFromVisit,
  onOpenReserve,
  onUnlinkReserve,
  onArchiveReserve,
  editable,
}: any) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeaderCompact}>
        <div>
          <h2>Visites</h2>
          <p>Préparez les visites et rattachez des réserves après coup.</p>
        </div>
        <button type="button" onClick={onCreateVisit}>Nouvelle visite</button>
      </div>
      <div className={styles.dataTable}>
        <div className={`${styles.tableHead} ${styles.visitTableHead}`}><span>Visite</span><span>Date</span><span>Périmètre</span><span>Réserves</span><span>Entreprises</span><span>Action</span></div>
        {visites.map((visit: any) => {
          const visitReserves = reserves.filter((r: any) => r.visite_id === visit.id || (visit.reserve_ids ?? []).includes(r.id));
          const companyNames = (visit.concerned_company_ids ?? [])
            .map((id: string) => companies.find((c: any) => c.id === id)?.name)
            .filter(Boolean);
          return (
            <div key={visit.id} className={styles.visitGroup}>
              <div className={`${styles.tableRow} ${styles.visitTableRow}`}>
                <strong>{visit.title}</strong>
                <span>{prettyDate(visit.date)}</span>
                <span>{[visit.building, visit.level, visit.zone].filter(Boolean).join(' · ') || 'Multi-bâtiments'}</span>
                <span>{visitReserves.length}</span>
                <span>{companyNames.join(', ') || '—'}</span>
                <button type="button" className={styles.tableActionBtn} onClick={() => onCreateReserveFromVisit(visit)}>Ajouter réserve</button>
              </div>
              {visitReserves.length ? (
                <div className={styles.visitReserveStrip}>
                  {visitReserves.slice(0, 8).map((reserve: any) => (
                    <article key={reserve.id} className={styles.visitReserveCard}>
                      <div>
                        <strong>{reserve.id}</strong>
                        <span>{reserve.title}</span>
                        <small>{STATUS_LABELS[reserve.status] ?? reserve.status} · {reserve.archived_at ? 'Archivée' : 'Active'}</small>
                      </div>
                      <div className={styles.visitReserveActions}>
                        <button type="button" onClick={() => onOpenReserve(reserve)}>Ouvrir</button>
                        {editable && (
                          <>
                            <button type="button" onClick={() => onUnlinkReserve(visit, reserve)}>Délier</button>
                            <button type="button" onClick={() => onArchiveReserve(reserve)}>{reserve.archived_at ? 'Désarchiver' : 'Archiver'}</button>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                  {visitReserves.length > 8 ? <small className={styles.visitReserveMore}>+ {visitReserves.length - 8} autres réserves</small> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {!visites.length && <p className={styles.empty}>Aucune visite dans ce périmètre.</p>}
    </section>
  );
}

function PlanningView({ tasks, visites, reserves, companies, editable, onUpdateTask }: any) {
  const [mode, setMode] = useState<'week' | 'company' | 'late'>('week');
  const now = new Date();
  const sortedTasks = [...tasks].sort((a: any, b: any) => new Date(a.deadline ?? a.created_at ?? 0).getTime() - new Date(b.deadline ?? b.created_at ?? 0).getTime());
  const visibleTasks = sortedTasks.filter((task: any) => {
    if (mode === 'late') return task.deadline && new Date(task.deadline) < now && task.status !== 'done';
    return true;
  });
  const upcomingVisits = [...visites]
    .sort((a: any, b: any) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime())
    .slice(0, 8);
  const reserveDeadlines = [...reserves]
    .filter((reserve: any) => reserve.deadline && reserve.status !== 'closed')
    .sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
    .slice(0, 10);

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Tâches" value={tasks.length} hint="Actions planifiées" />
        <Kpi title="En retard" value={tasks.filter((task: any) => task.deadline && new Date(task.deadline) < now && task.status !== 'done').length} hint="À reprendre vite" tone="red" />
        <Kpi title="Visites à venir" value={upcomingVisits.length} hint="Planning chantier" tone="green" />
        <Kpi title="Échéances réserves" value={reserveDeadlines.length} hint="Réserves actives" tone="amber" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Planning opérationnel</h2>
            <p>Vue web des tâches, visites et échéances de réserves.</p>
          </div>
          <div className={styles.segmented}>
            <button type="button" className={mode === 'week' ? styles.segmentedActive : ''} onClick={() => setMode('week')}>Semaine</button>
            <button type="button" className={mode === 'company' ? styles.segmentedActive : ''} onClick={() => setMode('company')}>Entreprise</button>
            <button type="button" className={mode === 'late' ? styles.segmentedActive : ''} onClick={() => setMode('late')}>Retard</button>
          </div>
        </div>
        <div className={styles.timelineGrid}>
          <div>
            <h3>Tâches</h3>
            <div className={styles.timelineList}>
              {visibleTasks.slice(0, 18).map((task: any) => {
                const company = companies.find((item: any) => item.id === task.company || item.name === task.company);
                return (
                  <article key={task.id} className={styles.timelineCard}>
                    <span className={`${styles.statusDot} ${task.status === 'done' ? styles.dotDone : task.status === 'delayed' ? styles.dotLate : ''}`} />
                    <div>
                      <strong>{task.title ?? 'Tâche'}</strong>
                    <small>{company?.name ?? task.company ?? 'Sans entreprise'} · {prettyDate(task.deadline)}</small>
                    <div className={styles.progressMini}><span style={{ width: `${Math.max(0, Math.min(100, Number(task.progress ?? 0)))}%` }} /></div>
                    {editable && (
                      <div className={styles.quickTaskActions}>
                        <button type="button" disabled={task.status === 'todo'} onClick={() => onUpdateTask(task, { status: 'todo', progress: Math.min(Number(task.progress ?? 0), 10) })}>À faire</button>
                        <button type="button" disabled={task.status === 'in_progress'} onClick={() => onUpdateTask(task, { status: 'in_progress', progress: Math.max(Number(task.progress ?? 0), 25) })}>En cours</button>
                        <button type="button" disabled={task.status === 'done'} onClick={() => onUpdateTask(task, { status: 'done', progress: 100 })}>Terminée</button>
                      </div>
                    )}
                  </div>
                    <em>{task.progress ?? 0}%</em>
                  </article>
                );
              })}
              {!visibleTasks.length && <p className={styles.empty}>Aucune tâche dans cette vue.</p>}
            </div>
          </div>
          <div>
            <h3>Visites et échéances</h3>
            <div className={styles.timelineList}>
              {upcomingVisits.map((visit: any) => (
                <article key={visit.id} className={styles.timelineCard}>
                  <span className={styles.statusDot} />
                  <div>
                    <strong>{visit.title}</strong>
                    <small>{prettyDate(visit.date)} · {[visit.building, visit.level].filter(Boolean).join(' · ') || 'Périmètre chantier'}</small>
                  </div>
                  <em>{VISIT_STATUS_LABELS[visit.status as VisitDraft['status']] ?? visit.status}</em>
                </article>
              ))}
              {reserveDeadlines.map((reserve: any) => (
                <article key={reserve.id} className={styles.timelineCard}>
                  <span className={`${styles.statusDot} ${styles.dotLate}`} />
                  <div>
                    <strong>{reserve.title}</strong>
                    <small>Échéance réserve · {prettyDate(reserve.deadline)}</small>
                  </div>
                  <em>{STATUS_LABELS[reserve.status] ?? reserve.status}</em>
                </article>
              ))}
              {!upcomingVisits.length && !reserveDeadlines.length && <p className={styles.empty}>Aucune échéance proche.</p>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MediaView({ photos, documents }: { photos: any[]; documents: any[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filteredPhotos = photos.filter(photo => !q || [photo.title, photo.name, photo.comment, photo.location, photo.taken_by, photo.takenBy].join(' ').toLowerCase().includes(q));
  const filteredDocuments = documents.filter(document => !q || [document.title, document.name, document.file_name, document.category].join(' ').toLowerCase().includes(q));
  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Médias chantier</h2>
            <p>Photos, documents et pièces jointes synchronisés depuis le terrain.</p>
          </div>
          <input className={styles.compactSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher média, zone, auteur..." />
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Photos</h2>
        <div className={styles.mediaGrid}>
          {filteredPhotos.map((photo: any) => {
            const url = assetUrl(photo, 'photos');
            return (
              <a key={photo.id ?? url} className={styles.mediaCard} href={url || undefined} target={url ? '_blank' : undefined} aria-disabled={!url}>
                {url ? <img src={url} alt={photo.comment ?? photo.title ?? 'Photo chantier'} /> : <span>Photo</span>}
                <strong>{photo.comment ?? photo.title ?? photo.name ?? 'Photo chantier'}</strong>
                <small>{photo.location ?? photo.building ?? 'Sans localisation'} · {prettyDate(photo.taken_at ?? photo.takenAt ?? photo.created_at, true)}</small>
              </a>
            );
          })}
          {!filteredPhotos.length && <p className={styles.empty}>Aucune photo trouvée.</p>}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Documents</h2>
        <div className={styles.documentList}>
          {filteredDocuments.map((document: any) => {
            const url = assetUrl(document, 'documents');
            return (
              <a key={document.id ?? url} className={styles.documentRow} href={url || undefined} target={url ? '_blank' : undefined} aria-disabled={!url}>
                <span>{String(document.file_type ?? document.type ?? 'DOC').slice(0, 4).toUpperCase()}</span>
                <div>
                  <strong>{document.title ?? document.name ?? document.file_name ?? 'Document'}</strong>
                  <small>{document.category ?? 'GED'} · {prettyDate(document.uploaded_at ?? document.created_at, true)}</small>
                </div>
              </a>
            );
          })}
          {!filteredDocuments.length && <p className={styles.empty}>Aucun document trouvé.</p>}
        </div>
      </section>
    </div>
  );
}

function RapportsView({
  stats,
  reserves,
  plans,
  visites,
  incidents,
  tasks,
  selectedReserve,
  language,
  setLanguage,
  generatingReport,
  onGenerate,
}: any) {
  const disabled = Boolean(generatingReport);
  const [selectedVisitId, setSelectedVisitId] = useState('');
  const selectedVisit = visites.find((visit: any) => visit.id === selectedVisitId) ?? visites[0] ?? null;
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Réserves exportables" value={reserves.length} hint={`${stats.closed} clôturées`} />
        <Kpi title="Plans" value={plans.length} hint="Avec réserves et épingles" tone="green" />
        <Kpi title="Visites" value={visites.length} hint="Comptes rendus" tone="amber" />
        <Kpi title="Incidents" value={incidents.length} hint="Suivi sécurité" tone="red" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Exports et rapports</h2>
            <p>Générez les PDF depuis le web avec les mêmes données Supabase que l’application mobile.</p>
          </div>
          <div className={styles.segmented}>
            {(['fr', 'en', 'es'] as const).map(lang => (
              <button key={lang} type="button" className={language === lang ? styles.segmentedActive : ''} onClick={() => setLanguage(lang)}>
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.reportGrid}>
          <ReportCard
            title="Rapport réserves"
            text="Liste détaillée, synthèse par statut et par entreprise."
            meta={`${reserves.length} réserves`}
            disabled={disabled}
            loading={generatingReport === `global_reserves-${language}`}
            onClick={() => onGenerate('global_reserves')}
          />
          <ReportCard
            title="Rapport plans"
            text="Plans, épingles et réserves associées."
            meta={`${plans.length} plans`}
            disabled={disabled}
            loading={generatingReport === `plans-${language}`}
            onClick={() => onGenerate('plans')}
          />
          <ReportCard
            title="Fiche réserve"
            text="Export individuel de la réserve sélectionnée."
            meta={selectedReserve ? selectedReserve.id : 'Aucune réserve sélectionnée'}
            disabled={disabled || !selectedReserve}
            loading={generatingReport === `individual_reserve-${language}`}
            onClick={() => onGenerate('individual_reserve')}
          />
          <article className={styles.reportCard}>
            <strong>Compte rendu de visite</strong>
            <p>Export structure avec informations de visite, checklist, notes et reserves rattachees.</p>
            <select value={selectedVisit?.id ?? ''} onChange={event => setSelectedVisitId(event.target.value)}>
              {visites.map((visit: any) => (
                <option key={visit.id} value={visit.id}>{visit.title}</option>
              ))}
            </select>
            <small>{visites.length} visites · {tasks.length} taches · {incidents.length} incidents</small>
            <button
              type="button"
              disabled={disabled || !selectedVisit}
              onClick={() => onGenerate('visit_report', { visit: selectedVisit })}
            >
              {generatingReport === `visit_report-${language}` ? 'Generation...' : 'Telecharger PDF'}
            </button>
          </article>
        </div>
      </section>
    </div>
  );
}

function ReportCard({ title, text, meta, disabled, loading, onClick }: any) {
  return (
    <article className={styles.reportCard}>
      <strong>{title}</strong>
      <p>{text}</p>
      <small>{meta}</small>
      <button type="button" disabled={disabled} onClick={onClick}>{loading ? 'Génération...' : 'Télécharger PDF'}</button>
    </article>
  );
}

function MessagesView({ channels, companies, selectedChannel, setSelectedChannelId, messages, draft, setDraft, onSend, saving }: any) {
  return (
    <div className={styles.twoCols}>
      <section className={styles.panel}>
        <div className={styles.list}>
          {channels.map((channel: any) => (
            <button key={channel.id} className={`${styles.listRow} ${selectedChannel?.id === channel.id ? styles.selectedRow : ''}`} onClick={() => setSelectedChannelId(channel.id)}>
              <span>○</span>
              <div>
                <strong>{channelLabel(channel, companies)}</strong>
                <small>{channel.type ?? 'canal'}</small>
              </div>
            </button>
          ))}
          {!channels.length && <p className={styles.empty}>Aucun canal chargé.</p>}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{selectedChannel?.type ?? 'canal'}</p>
            <h2>{selectedChannel ? channelLabel(selectedChannel, companies) : 'Messages'}</h2>
          </div>
        </div>
        <div className={styles.messageList}>
          {messages.map((message: any) => (
            <div key={message.id} className={styles.messageBubble}>
              <strong>{message.sender}</strong>
              <p>{message.content}</p>
              <small>{prettyDate(message.created_at, true)}</small>
            </div>
          ))}
          {!messages.length && <p className={styles.empty}>Aucun message dans ce canal.</p>}
        </div>
        <form className={styles.messageForm} onSubmit={onSend}>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Écrire un message..." />
          <button disabled={saving || !draft.trim()}>Envoyer</button>
        </form>
      </section>
    </div>
  );
}

function TerrainView({ scoped, data }: any) {
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Incidents" value={scoped.incidents.length} hint="Sécurité / terrain" tone="red" />
        <Kpi title="Tâches" value={scoped.tasks.length} hint="Actions chantier" />
        <Kpi title="Photos" value={scoped.photos.length} hint="Médias terrain" tone="green" />
        <Kpi title="Documents" value={scoped.documents.length} hint="GED chantier" tone="amber" />
      </div>
      <section className={styles.panel}>
        <div className={styles.threeCols}>
          <SimpleColumn title="Incidents" rows={scoped.incidents} primary="title" secondary="status" />
          <SimpleColumn title="Tâches" rows={scoped.tasks} primary="title" secondary="deadline" />
          <SimpleColumn title="OPR" rows={scoped.oprs} primary="title" secondary="status" />
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Photos et documents</h2>
            <p>Accès web rapide aux médias terrain et pièces GED déjà synchronisés.</p>
          </div>
        </div>
        <div className={styles.mediaGrid}>
          {scoped.photos.slice(0, 12).map((photo: any) => {
            const url = assetUrl(photo, 'photos');
            return (
              <a
                key={photo.id ?? url}
                className={styles.mediaCard}
                href={url || undefined}
                target={url ? '_blank' : undefined}
                aria-disabled={!url}
              >
                {url ? <img src={url} alt={photo.title ?? photo.name ?? 'Photo chantier'} /> : <span>Photo</span>}
                <strong>{photo.title ?? photo.name ?? 'Photo chantier'}</strong>
                <small>{prettyDate(photo.taken_at ?? photo.created_at, true)}</small>
              </a>
            );
          })}
          {scoped.documents.slice(0, 12).map((document: any) => {
            const url = assetUrl(document, 'documents');
            return (
              <a
                key={document.id ?? url}
                className={styles.mediaCard}
                href={url || undefined}
                target={url ? '_blank' : undefined}
                aria-disabled={!url}
              >
                <span>{String(document.file_type ?? document.type ?? 'DOC').slice(0, 4).toUpperCase()}</span>
                <strong>{document.title ?? document.name ?? document.file_name ?? 'Document'}</strong>
                <small>{prettyDate(document.uploaded_at ?? document.created_at, true)}</small>
              </a>
            );
          })}
          {!scoped.photos.length && !scoped.documents.length && <p className={styles.empty}>Aucun média terrain dans ce périmètre.</p>}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Lots et entreprises</h2>
        <div className={styles.compactList}>
          {data.lots.slice(0, 40).map((lot: any) => (
            <button key={lot.id}><span>{lot.code}</span><strong>{lot.name}</strong></button>
          ))}
        </div>
      </section>
    </div>
  );
}

function EquipesView({ companies, reserves, tasks, editable, onUpdateCompanyField }: any) {
  const totalActual = companies.reduce((sum: number, company: any) => sum + Number(company.actual_workers ?? 0), 0);
  const totalPlanned = companies.reduce((sum: number, company: any) => sum + Number(company.planned_workers ?? 0), 0);
  const presence = totalPlanned ? Math.round((totalActual / totalPlanned) * 100) : 0;

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Présents" value={totalActual} hint={`${totalPlanned} planifiés`} />
        <Kpi title="Présence" value={`${presence}%`} hint="Pointage global" tone="green" />
        <Kpi title="Entreprises" value={companies.length} hint="Sous-traitants" tone="amber" />
        <Kpi title="Actions actives" value={tasks.filter((task: any) => task.status !== 'done').length} hint="Tâches non terminées" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Équipes chantier</h2>
            <p>Pointage rapide, contacts et réserves ouvertes par entreprise.</p>
          </div>
        </div>
        <div className={styles.companyGrid}>
          {companies.map((company: any) => {
            const names = [company.name, company.short_name, company.shortName].filter(Boolean);
            const openReserves = reserves.filter((reserve: any) => {
              const reserveNames = reserveCompanies(reserve);
              return reserve.status !== 'closed' && reserveNames.some(name => names.some(companyName => sameName(companyName, name)));
            }).length;
            return (
              <article className={styles.companyCard} key={company.id}>
                <div className={styles.companyTop}>
                  <span className={styles.companyColor} style={{ backgroundColor: company.color ?? '#3b82f6' }} />
                  <div>
                    <strong>{company.name}</strong>
                    <small>{company.short_name ?? company.shortName ?? company.zone ?? 'Entreprise'}</small>
                  </div>
                </div>
                <div className={styles.companyStats}>
                  <label>
                    <span>Présents</span>
                    <input
                      type="number"
                      min={0}
                      value={company.actual_workers ?? 0}
                      disabled={!editable}
                      onChange={event => onUpdateCompanyField(company.id, 'actual_workers', Number(event.target.value))}
                    />
                  </label>
                  <label>
                    <span>Planifiés</span>
                    <input
                      type="number"
                      min={0}
                      value={company.planned_workers ?? 0}
                      disabled={!editable}
                      onChange={event => onUpdateCompanyField(company.id, 'planned_workers', Number(event.target.value))}
                    />
                  </label>
                </div>
                <div className={styles.companyFooter}>
                  <span>{openReserves} réserves ouvertes</span>
                  {company.email ? <a href={`mailto:${company.email}`}>Email</a> : null}
                  {company.contact ? <a href={`tel:${company.contact}`}>Appeler</a> : null}
                </div>
              </article>
            );
          })}
        </div>
        {!companies.length && <p className={styles.empty}>Aucune entreprise chargée.</p>}
      </section>
    </div>
  );
}

function prefValue(preferences: any[], authUser: SupabaseUser | null, field: string, fallback = true) {
  const row = preferences.find(item => item.user_id === authUser?.id);
  return row?.[field] ?? fallback;
}

function SettingsView({ profile, authUser, preferences, onUpdateNotificationField }: {
  profile: Profile | null;
  authUser: SupabaseUser | null;
  preferences: any[];
  onUpdateNotificationField: (field: string, value: boolean | string) => void;
}) {
  return (
    <div className={styles.twoCols}>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Compte</p>
            <h2>{profile?.name ?? authUser?.email}</h2>
            <p>{profile?.role_label ?? profile?.role} · {profile?.email ?? authUser?.email}</p>
          </div>
        </div>
        <dl className={styles.metaGrid}>
          <div><dt>ID utilisateur</dt><dd>{profile?.id ?? authUser?.id}</dd></div>
          <div><dt>Organisation</dt><dd>{profile?.organization_id ?? '—'}</dd></div>
          <div><dt>Entreprise</dt><dd>{profile?.company_id ?? '—'}</dd></div>
          <div><dt>Langue</dt><dd>{profile?.preferred_language?.toUpperCase() ?? 'Auto'}</dd></div>
        </dl>
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Notifications</p>
            <h2>Préférences personnelles</h2>
            <p>Ces réglages sont stockés dans Supabase et restent cohérents avec l’application mobile.</p>
          </div>
        </div>
        <div className={styles.toggleList}>
          <ToggleRow label="Notifications app" hint="Alertes visibles dans BuildTrack." checked={!!prefValue(preferences, authUser, 'in_app_enabled')} onChange={value => onUpdateNotificationField('in_app_enabled', value)} />
          <ToggleRow label="Notifications push" hint="Alertes natives tablette ou téléphone." checked={!!prefValue(preferences, authUser, 'push_enabled')} onChange={value => onUpdateNotificationField('push_enabled', value)} />
          <ToggleRow label="Notifications email" hint="Emails automatiques réserves et rappels." checked={!!prefValue(preferences, authUser, 'email_enabled')} onChange={value => onUpdateNotificationField('email_enabled', value)} />
          <ToggleRow label="Messages par email" hint="Recevoir les messages importants par mail." checked={!!prefValue(preferences, authUser, 'messages_email', false)} onChange={value => onUpdateNotificationField('messages_email', value)} />
          <ToggleRow label="Heures calmes" hint="Suspend les push non critiques." checked={!!prefValue(preferences, authUser, 'quiet_hours_enabled', false)} onChange={value => onUpdateNotificationField('quiet_hours_enabled', value)} />
        </div>
      </section>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={styles.toggleRow}>
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    </label>
  );
}

function TextAssistControls({
  value,
  onChange,
  context,
}: {
  value: string;
  onChange: (value: string) => void;
  context: string;
}) {
  const [dictationOpen, setDictationOpen] = useState(false);
  const [lang, setLang] = useState<TextLang>(() => defaultTextLang());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  function setPreferredLang(next: TextLang) {
    setLang(next);
    if (typeof window !== 'undefined') window.localStorage.setItem('buildtrack-web-dictation-lang', next);
  }

  function startDictation(nextLang: TextLang) {
    setPreferredLang(nextLang);
    setMessage('');
    if (typeof window === 'undefined') return;
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setMessage('Dictee vocale non disponible dans ce navigateur.');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = TEXT_LANG_OPTIONS.find(item => item.value === nextLang)?.speech ?? 'fr-FR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setBusy('dictation');
    recognition.onresult = (event: any) => {
      const text = event?.results?.[0]?.[0]?.transcript;
      if (text) onChange([value.trim(), text.trim()].filter(Boolean).join(value.trim() ? ' ' : ''));
    };
    recognition.onerror = () => setMessage('Dictee interrompue. Verifiez le micro ou les permissions.');
    recognition.onend = () => setBusy(null);
    recognition.start();
  }

  async function translate(target: TextLang) {
    if (!value.trim()) return;
    setMessage('');
    setBusy(`translate-${target}`);
    try {
      const translated = await requestWebTranslation({ text: value, source: lang, target, context });
      onChange(translated);
      setPreferredLang(target);
    } catch (err: any) {
      setMessage(err?.message ?? 'Traduction Azure indisponible.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.textAssist}>
      <div className={styles.textAssistBar}>
        <button type="button" onClick={() => setDictationOpen(open => !open)} className={dictationOpen ? styles.textAssistActive : ''}>
          Micro
        </button>
        <span>Traduire</span>
        {TEXT_LANG_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => translate(option.value)}
            disabled={!value.trim() || busy === `translate-${option.value}`}
          >
            {busy === `translate-${option.value}` ? '...' : option.label}
          </button>
        ))}
      </div>
      {dictationOpen ? (
        <div className={styles.dictationPicker}>
          <span>Langue parlee</span>
          {TEXT_LANG_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className={lang === option.value ? styles.dictationLangActive : styles.dictationLang}
              onClick={() => startDictation(option.value)}
              disabled={busy === 'dictation'}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {message ? <small className={styles.textAssistMessage}>{message}</small> : null}
    </div>
  );
}

function ReserveModal({ mode, draft, setDraft, data, selectedProjectId, saving, onClose, onSubmit, onToggleCompany }: {
  mode: 'create' | 'edit';
  draft: ReserveDraft;
  setDraft: React.Dispatch<React.SetStateAction<ReserveDraft>>;
  data: WebState;
  selectedProjectId: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onToggleCompany: (companyName: string) => void;
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  const projectId = draft.chantierId || (selectedProjectId !== 'all' ? selectedProjectId : data.chantiers[0]?.id ?? '');
  const project = data.chantiers.find(item => item.id === projectId) ?? null;
  const plans = data.sitePlans.filter(plan => getChantierId(plan) === projectId);
  const visits = data.visites.filter(visit => getChantierId(visit) === projectId);
  const lots = data.lots.filter(lot => {
    const lotProjectId = getChantierId(lot);
    return !lotProjectId || lotProjectId === projectId;
  });
  const selectedVisit = visits.find(visit => visit.id === draft.visiteId) ?? null;
  const visitLocations = getVisitLocations(selectedVisit);
  const visitScopedBuildingIds = new Set(visitLocations.map(location => location.buildingId ?? location.building_id).filter(Boolean));
  const visitScopedBuildingNames = new Set(visitLocations.map(location => location.buildingName ?? location.building_name).filter(Boolean));
  const buildings = projectBuildings(project);
  const buildingOptions = visitLocations.length
    ? buildings.filter(building => visitScopedBuildingIds.has(building.id) || visitScopedBuildingNames.has(building.name))
    : buildings;
  const selectedBuilding = buildingOptions.find(building =>
    (draft.buildingId && building.id === draft.buildingId) || sameName(building.name, draft.building)
  ) ?? null;
  const visitLocationForBuilding = visitLocations.find(location =>
    (selectedBuilding?.id && (location.buildingId === selectedBuilding.id || location.building_id === selectedBuilding.id)) ||
    sameName(location.buildingName ?? location.building_name, selectedBuilding?.name ?? draft.building)
  );
  const allowedLevelIds = new Set((visitLocationForBuilding?.levelIds ?? visitLocationForBuilding?.level_ids ?? []).filter(Boolean));
  const levelOptions = selectedBuilding?.levels
    ? selectedBuilding.levels.filter((level: any) => allowedLevelIds.size === 0 || allowedLevelIds.has(level.id))
    : [];
  const selectedLot = lots.find(lot => lot.id === draft.lotId) ?? null;
  const selectedPlan = plans.find(plan => plan.id === draft.planId) ?? null;
  const filteredPlans = plans.filter(plan => {
    const location = getPlanDisplayLocation(plan, project);
    if (visitLocations.length > 0 && location.building) {
      const inScope = (location.buildingId && visitScopedBuildingIds.has(location.buildingId)) || visitScopedBuildingNames.has(location.building);
      if (!inScope) return false;
    }
    if (!draft.building && !draft.level) return true;
    const matchesBuilding = !location.building || !draft.building
      ? true
      : location.buildingId && draft.buildingId
        ? location.buildingId === draft.buildingId
        : sameName(location.building, draft.building);
    const matchesLevel = !location.level || !draft.level
      ? true
      : location.levelId && draft.levelId
        ? location.levelId === draft.levelId
        : sameName(location.level, draft.level);
    return matchesBuilding && matchesLevel;
  });
  const previewId = mode === 'edit'
    ? draft.title ? 'Réserve existante' : 'Modification'
    : generateReserveId(data.reserves, data.lots, draft.lotId);
  const selectedCompanyCount = draft.companies.length;
  const hasCapturedPin = Boolean(draft.planId && draft.planX != null && draft.planY != null);

  function updateTitle(value: string) {
    setDraft(prev => {
      const shouldMirrorDescription = !prev.description.trim() || prev.description === prev.title;
      return { ...prev, title: value, description: shouldMirrorDescription ? value : prev.description };
    });
  }

  function reuseTitleAsDescription() {
    setDraft(prev => ({ ...prev, description: prev.title.trim() }));
  }

  function applyTemplate(item: { title: string; description: string }) {
    setDraft(prev => ({ ...prev, title: item.title, description: item.description }));
    setShowTemplates(false);
  }

  function addPhotoFiles(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []).filter(file => file.type.startsWith('image/')).slice(0, Math.max(0, 6 - draft.photos.length));
    if (!selectedFiles.length) return;
    setDraft(prev => ({
      ...prev,
      photos: [
        ...prev.photos,
        ...selectedFiles.map(file => ({
          id: crypto.randomUUID(),
          uri: URL.createObjectURL(file),
          name: file.name,
          kind: 'defect' as const,
          file,
        })),
      ],
    }));
  }

  function removePhoto(photoId: string) {
    setDraft(prev => ({ ...prev, photos: prev.photos.filter(photo => photo.id !== photoId) }));
  }

  function togglePhotoKind(photoId: string) {
    setDraft(prev => ({
      ...prev,
      photos: prev.photos.map(photo =>
        photo.id === photoId
          ? { ...photo, kind: photo.kind === 'resolution' ? 'defect' : 'resolution' }
          : photo
      ),
    }));
  }

  function applyBuilding(buildingId: string) {
    const building = buildingOptions.find(item => item.id === buildingId);
    setDraft(prev => ({
      ...prev,
      buildingId,
      building: building?.name ?? '',
      level: '',
      levelId: '',
      planId: '',
      planX: null,
      planY: null,
    }));
  }

  function applyLevel(levelId: string) {
    const level = levelOptions.find((item: any) => item.id === levelId);
    setDraft(prev => ({
      ...prev,
      levelId,
      level: level?.name ?? '',
      planId: '',
      planX: null,
      planY: null,
    }));
  }

  function applyPlan(planId: string) {
    const plan = plans.find(item => item.id === planId);
    const location = plan ? getPlanDisplayLocation(plan, project) : null;
    setDraft(prev => ({
      ...prev,
      planId,
      building: location?.building || prev.building,
      buildingId: location?.buildingId || prev.buildingId,
      level: location?.level || prev.level,
      levelId: location?.levelId || prev.levelId,
      planX: prev.planId === planId ? prev.planX : null,
      planY: prev.planId === planId ? prev.planY : null,
    }));
  }

  function applyVisit(visitId: string) {
    const visit = visits.find(item => item.id === visitId);
    if (!visit) {
      setDraft(prev => ({ ...prev, visiteId: '', deadline: '', planId: '', planX: null, planY: null }));
      return;
    }
    const visitCompanyNames = getVisitCompanyIds(visit)
      .map(companyId => data.companies.find(company => company.id === companyId)?.name)
      .filter((name): name is string => !!name);
    const locations = getVisitLocations(visit);
    const singleLocation = locations.length === 1 ? locations[0] : null;
    const buildingId = singleLocation?.buildingId ?? singleLocation?.building_id ?? '';
    const buildingName = singleLocation?.buildingName ?? singleLocation?.building_name ?? visit.building ?? '';
    const defaultPlanId = singleLocation?.defaultPlanId ?? singleLocation?.default_plan_id ?? getVisitDefaultPlanId(visit);
    const defaultPlan = plans.find(plan => plan.id === defaultPlanId);
    const defaultLocation = defaultPlan ? getPlanDisplayLocation(defaultPlan, project) : null;
    setDraft(prev => ({
      ...prev,
      visiteId: visit.id,
      deadline: getVisitReserveDeadline(visit) || prev.deadline,
      companies: visitCompanyNames.length ? visitCompanyNames : prev.companies,
      building: defaultLocation?.building || buildingName || (locations.length > 1 ? '' : visit.building || prev.building),
      buildingId: defaultLocation?.buildingId || buildingId || (locations.length > 1 ? '' : prev.buildingId),
      level: defaultLocation?.level || (locations.length > 1 ? '' : visit.level || prev.level),
      levelId: defaultLocation?.levelId || (locations.length > 1 ? '' : prev.levelId),
      zone: visit.zone ?? prev.zone,
      planId: defaultPlanId || prev.planId,
      planX: null,
      planY: null,
    }));
  }

  function applyLot(lotId: string) {
    const lot = lots.find(item => item.id === lotId);
    const companyId = lot?.company_id ?? lot?.companyId;
    const companyName = companyId ? data.companies.find(company => company.id === companyId)?.name : '';
    setDraft(prev => ({
      ...prev,
      lotId,
      companies: companyName ? [companyName] : prev.companies,
    }));
  }

  function applyDeadlinePreset(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    setDraft(prev => ({ ...prev, deadline: date.toISOString().slice(0, 10) }));
  }

  function applyPriority(value: string) {
    setDraft(prev => ({
      ...prev,
      priority: value,
      deadline: prev.deadline || suggestedDeadlineForPriority(value),
    }));
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <form className={`${styles.modalPanel} ${styles.reserveModalPanel}`} onSubmit={onSubmit}>
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>{mode === 'edit' ? 'Modification' : 'Création'}</p>
            <h2>{mode === 'edit' ? 'Modifier la réserve' : 'Nouvelle réserve'}</h2>
            <span>{project?.name ?? 'Chantier'} · {previewId}</span>
          </div>
          <button type="button" onClick={onClose}>Fermer</button>
        </div>
        <div className={styles.reserveModalBody}>
          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Constat</strong>
                <span>Titre, description et type de saisie.</span>
              </div>
              <div className={styles.segmented}>
                {[
                  ['reserve', 'Réserve'],
                  ['observation', 'Observation'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={draft.kind === value ? styles.segmentedActive : ''}
                    onClick={() => setDraft(prev => ({ ...prev, kind: value as ReserveDraft['kind'] }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.reserveModalGrid}>
              <label className={styles.formWide}>
                Titre *
                <input value={draft.title} onChange={event => updateTitle(event.target.value)} placeholder="Ex: Finition mur à reprendre" required />
                <TextAssistControls
                  value={draft.title}
                  onChange={value => updateTitle(value)}
                  context="reserve title"
                />
              </label>
              <label className={styles.formWide}>
                <span className={styles.reserveLabelRow}>
                  Description
                  {draft.title.trim() && draft.description.trim() !== draft.title.trim() ? (
                    <button type="button" onClick={reuseTitleAsDescription}>Copier le titre</button>
                  ) : null}
                </span>
                <textarea value={draft.description} onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))} rows={4} />
                <TextAssistControls
                  value={draft.description}
                  onChange={value => setDraft(prev => ({ ...prev, description: value }))}
                  context="reserve description"
                />
              </label>
            </div>
            <div className={styles.reserveTemplateBox}>
              <button type="button" className={styles.reserveTemplateHeader} onClick={() => setShowTemplates(open => !open)}>
                <span>Templates rapides</span>
                <strong>{RESERVE_TEMPLATE_GROUPS.reduce((sum, group) => sum + group.items.length, 0)}</strong>
              </button>
              {showTemplates ? (
                <div className={styles.reserveTemplateGrid}>
                  {RESERVE_TEMPLATE_GROUPS.map(group => (
                    <div key={group.category} className={styles.reserveTemplateGroup}>
                      <strong>{group.category}</strong>
                      {group.items.map(item => (
                        <button key={`${group.category}-${item.title}`} type="button" onClick={() => applyTemplate(item)}>
                          <span>{item.title}</span>
                          <small>{item.description}</small>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <small>Choisissez un modele pour pre-remplir titre et description.</small>
              )}
            </div>
            <div className={styles.reservePhotoBox}>
              <div className={styles.reservePhotoHeader}>
                <div>
                  <strong>Photos ({draft.photos.length}/6)</strong>
                  <span>Ajoutez des photos de constat ou de levee.</span>
                </div>
                <label>
                  Ajouter
                  <input type="file" accept="image/*" capture="environment" multiple onChange={event => addPhotoFiles(event.target.files)} />
                </label>
              </div>
              {draft.photos.length ? (
                <div className={styles.reservePhotoGrid}>
                  {draft.photos.map(photo => (
                    <div key={photo.id} className={styles.reservePhotoItem}>
                      <img src={photo.uri} alt={photo.name ?? 'Photo reserve'} />
                      <div>
                        <button type="button" onClick={() => togglePhotoKind(photo.id)}>
                          {photo.kind === 'resolution' ? 'Levee' : 'Constat'}
                        </button>
                        <button type="button" onClick={() => removePhoto(photo.id)}>Retirer</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Contexte chantier</strong>
                <span>La visite peut limiter les bâtiments et reprendre l’échéance.</span>
              </div>
            </div>
            <div className={styles.reserveModalGrid}>
              <label>
                Chantier
                <select value={projectId} onChange={event => setDraft(prev => ({ ...prev, chantierId: event.target.value, building: '', buildingId: '', level: '', levelId: '', planId: '', planX: null, planY: null, visiteId: '' }))}>
                  {data.chantiers.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label>
                Visite associée
                <select value={draft.visiteId} onChange={event => applyVisit(event.target.value)}>
                  <option value="">Aucune visite</option>
                  {visits.map(visit => <option key={visit.id} value={visit.id}>{visit.title}</option>)}
                </select>
              </label>
              {visitLocations.length > 0 ? (
                <div className={styles.formWide}>
                  <div className={styles.reserveNotice}>
                    <strong>Périmètre de visite</strong>
                    <span>{visitLocations.length} bâtiment{visitLocations.length > 1 ? 's' : ''} autorisé{visitLocations.length > 1 ? 's' : ''}. Les autres bâtiments sont masqués, comme sur mobile.</span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Localisation et plan</strong>
                <span>Le plan est filtré selon le bâtiment et le niveau sélectionnés.</span>
              </div>
            </div>
            <div className={styles.reserveModalGrid}>
              {buildingOptions.length ? (
                <label>
                  Bâtiment *
                  <select value={draft.buildingId || selectedBuilding?.id || ''} onChange={event => applyBuilding(event.target.value)}>
                    <option value="">Sélectionner...</option>
                    {buildingOptions.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
                  </select>
                </label>
              ) : (
                <label>
                  Bâtiment *
                  <input value={draft.building} onChange={event => setDraft(prev => ({ ...prev, building: event.target.value, buildingId: '' }))} />
                </label>
              )}
              {levelOptions.length ? (
                <label>
                  Niveau *
                  <select value={draft.levelId || ''} onChange={event => applyLevel(event.target.value)}>
                    <option value="">Sélectionner...</option>
                    {levelOptions.map((level: any) => <option key={level.id} value={level.id}>{level.name}</option>)}
                  </select>
                </label>
              ) : (
                <label>
                  Niveau *
                  <input value={draft.level} onChange={event => setDraft(prev => ({ ...prev, level: event.target.value, levelId: '' }))} />
                </label>
              )}
              <label>
                Zone
                <input value={draft.zone} onChange={event => setDraft(prev => ({ ...prev, zone: event.target.value }))} placeholder="Ex: couloir, local, façade..." />
              </label>
              <label>
                Plan associé
                <select value={draft.planId} onChange={event => applyPlan(event.target.value)}>
                  <option value="">Aucun plan</option>
                  {filteredPlans.map(plan => {
                    const location = getPlanDisplayLocation(plan, project);
                    return (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}{location.building ? ` · ${location.building}${location.level ? ` / ${location.level}` : ''}` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              {draft.planId && hasCapturedPin ? (
                <div className={`${styles.formWide} ${styles.reservePinCaptured}`}>
                  <div>
                    <strong>Épingle capturée sur le plan</strong>
                    <small>
                      La réserve sera créée directement à cette position
                      {draft.planX != null && draft.planY != null ? ` (${Math.round(draft.planX)} %, ${Math.round(draft.planY)} %).` : '.'}
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft(prev => ({
                      ...prev,
                      planX: null,
                      planY: null,
                    }))}
                  >
                    Retirer
                  </button>
                </div>
              ) : draft.planId ? (
                <div className={`${styles.formWide} ${styles.reservePinFollowUp}`}>
                  <span>
                    <strong>Plan associé sans épingle</strong>
                    <small>Pour créer une réserve déjà localisée, utilisez la page Plans et cliquez directement sur le PDF.</small>
                  </span>
                </div>
              ) : (
                <div className={styles.formWide}>
                  <div className={styles.reserveNoticeWarning}>
                    Sans plan associé, la réserve sera créée hors plan.
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Responsables et suivi</strong>
                <span>Entreprise, lot, priorité et délai cible.</span>
              </div>
              <span className={styles.reserveCountPill}>{selectedCompanyCount} sélectionnée{selectedCompanyCount > 1 ? 's' : ''}</span>
            </div>
            <div className={styles.reserveModalGrid}>
              <label>
                Lot
                <select value={draft.lotId} onChange={event => applyLot(event.target.value)}>
                  <option value="">Aucun lot</option>
                  {lots.map(lot => <option key={lot.id} value={lot.id}>{lot.code ? `${lot.code} · ${lot.name}` : lot.name}</option>)}
                </select>
              </label>
              <label>
                Échéance
                <input type="date" value={draft.deadline} onChange={event => setDraft(prev => ({ ...prev, deadline: event.target.value }))} />
              </label>
              <div className={styles.formWide}>
                <span className={styles.fieldLabel}>Priorité</span>
                <div className={styles.chipGrid}>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={draft.priority === value ? styles.chipActive : styles.chip}
                      onClick={() => applyPriority(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.formWide}>
                <span className={styles.fieldLabel}>Délai rapide</span>
                <div className={styles.chipGrid}>
                  {[7, 15, 30, 60].map(days => (
                    <button key={days} type="button" className={styles.chip} onClick={() => applyDeadlinePreset(days)}>
                      {days} j
                    </button>
                  ))}
                </div>
              </div>
              {mode === 'edit' ? (
                <label>
                  Statut
                  <select value={draft.status} onChange={event => setDraft(prev => ({ ...prev, status: event.target.value }))}>
                    {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              ) : null}
              <div className={styles.formWide}>
                <span className={styles.fieldLabel}>Entreprises responsables *</span>
                <div className={styles.reserveCompanyGrid}>
                  {data.companies.map(company => (
                    <button
                      key={company.id}
                      type="button"
                      className={draft.companies.includes(company.name) ? styles.reserveCompanyChipActive : styles.reserveCompanyChip}
                      onClick={() => onToggleCompany(company.name)}
                    >
                      <span style={{ background: company.color ?? '#94a3b8' }} />
                      <strong>{company.short_name ?? company.shortName ?? company.name}</strong>
                      <small>{company.name}</small>
                    </button>
                  ))}
                </div>
                {!data.companies.length ? <p className={styles.empty}>Aucune entreprise configurée.</p> : null}
              </div>
            </div>
          </section>
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={saving}>{saving ? 'Enregistrement...' : mode === 'edit' ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </div>
  );
}

function VisitModal({ draft, setDraft, data, selectedProjectId, saving, currentUserId, onClose, onSubmit, onToggleCompany }: {
  draft: VisitDraft;
  setDraft: React.Dispatch<React.SetStateAction<VisitDraft>>;
  data: WebState;
  selectedProjectId: string;
  saving: boolean;
  currentUserId?: string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onToggleCompany: (companyId: string) => void;
}) {
  const [buildingQuery, setBuildingQuery] = useState('');
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participantRole, setParticipantRole] = useState('');
  const [participantCompanyId, setParticipantCompanyId] = useState('');
  const [participantCompanyFree, setParticipantCompanyFree] = useState('');
  const [newTag, setNewTag] = useState('');
  const projectId = draft.chantierId || (selectedProjectId !== 'all' ? selectedProjectId : data.chantiers[0]?.id ?? '');
  const project = data.chantiers.find(item => item.id === projectId);
  const buildings = projectBuildings(project);
  const plans = data.sitePlans.filter(plan => getChantierId(plan) === projectId);
  const hasBuildingHierarchy = buildings.length > 0;
  const selectedBuildingIds = new Set(draft.visitedLocations.map(location => location.buildingId).filter(Boolean));
  const filteredBuildings = buildings.filter((building: any) => {
    const q = normalizeSearchText(buildingQuery);
    if (!q) return true;
    return normalizeSearchText(building.name).includes(q) ||
      (building.levels ?? []).some((level: any) => normalizeSearchText(level.name).includes(q));
  });
  const selectedLocations = draft.visitedLocations.slice(0, 8);
  const hiddenSelectedCount = Math.max(0, draft.visitedLocations.length - selectedLocations.length);
  const companyById = new Map(data.companies.map(company => [company.id, company]));
  const selectedCompanyCount = draft.companyIds.length;
  const checklistDone = draft.checklistItems.filter(item => item.checked).length;
  const suggestedTitle = autoVisitTitle(draft.visitType, draft.date || todayISO());
  const canUseSuggestedTitle = draft.title.trim() !== suggestedTitle;
  const existingUserParticipants = useMemo(() => {
    const query = normalizeSearchText(participantSearch);
    return data.profiles
      .filter(profile => profile.id !== currentUserId)
      .filter(profile => {
        if (project?.organization_id && profile.organization_id && profile.organization_id !== project.organization_id) return false;
        const label = profile.name || profile.email || 'Utilisateur';
        const exists = draft.participants.some(participant => {
          if (participant.profileId && participant.profileId === profile.id) return true;
          if (participant.email && profile.email && participant.email.toLowerCase() === profile.email.toLowerCase()) return true;
          return normalizeSearchText(participant.name) === normalizeSearchText(label);
        });
        if (exists) return false;
        if (!query) return true;
        const companyName = profile.company_id ? companyById.get(profile.company_id)?.name : '';
        return normalizeSearchText([label, profile.email, ROLE_LABELS[String(profile.role)] ?? profile.role_label ?? profile.role, companyName].join(' ')).includes(query);
      })
      .sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'fr'));
  }, [companyById, currentUserId, data.profiles, draft.participants, participantSearch, project?.organization_id]);
  const visibleUserParticipants = existingUserParticipants.slice(0, 12);

  function updateProject(nextProjectId: string) {
    setDraft(prev => ({
      ...prev,
      chantierId: nextProjectId,
      building: '',
      level: '',
      zone: '',
      defaultPlanId: '',
      visitedLocations: [],
    }));
  }

  function updateVisitType(type: VisitDraft['visitType']) {
    setDraft(prev => {
      const previousAutoTitle = autoVisitTitle(prev.visitType, prev.date || todayISO());
      const shouldRefreshTitle = !prev.title.trim() || prev.title.trim() === previousAutoTitle;
      return {
        ...prev,
        visitType: type,
        title: shouldRefreshTitle ? autoVisitTitle(type, prev.date || todayISO()) : prev.title,
        checklistItems: makeVisitChecklist(type),
      };
    });
  }

  function updateVisitDate(date: string) {
    setDraft(prev => {
      const previousAutoTitle = autoVisitTitle(prev.visitType, prev.date || todayISO());
      const shouldRefreshTitle = !prev.title.trim() || prev.title.trim() === previousAutoTitle;
      return {
        ...prev,
        date,
        title: shouldRefreshTitle ? autoVisitTitle(prev.visitType, date || todayISO()) : prev.title,
      };
    });
  }

  function plansForBuilding(building: any) {
    return plans.filter(plan =>
      getPlanBuildingId(plan) === building.id ||
      (!getPlanBuildingId(plan) && getPlanBuildingName(plan) === building.name)
    );
  }

  function toggleVisitedBuilding(building: any) {
    setDraft(prev => {
      const exists = prev.visitedLocations.some(location => location.buildingId === building.id);
      return {
        ...prev,
        visitedLocations: exists
          ? prev.visitedLocations.filter(location => location.buildingId !== building.id)
          : [...prev.visitedLocations, { buildingId: building.id, buildingName: building.name }],
      };
    });
  }

  function selectVisibleBuildings() {
    const source = buildingQuery.trim() ? filteredBuildings : buildings;
    setDraft(prev => {
      const existing = new Set(prev.visitedLocations.map(location => location.buildingId).filter(Boolean));
      const additions = source
        .filter((building: any) => !existing.has(building.id))
        .map((building: any) => ({ buildingId: building.id, buildingName: building.name }));
      return { ...prev, visitedLocations: [...prev.visitedLocations, ...additions] };
    });
  }

  function removeVisitedBuilding(buildingId?: string, buildingName?: string) {
    setDraft(prev => ({
      ...prev,
      visitedLocations: prev.visitedLocations.filter(location =>
        buildingId ? location.buildingId !== buildingId : location.buildingName !== buildingName
      ),
    }));
  }

  function updateLocationPlan(buildingId: string, planId: string) {
    setDraft(prev => ({
      ...prev,
      visitedLocations: prev.visitedLocations.map(location =>
        location.buildingId === buildingId
          ? { ...location, defaultPlanId: planId || undefined }
          : location
      ),
    }));
  }

  function addChecklistItem() {
    const label = newChecklistLabel.trim();
    if (!label) return;
    setDraft(prev => ({
      ...prev,
      checklistItems: [...prev.checklistItems, { id: crypto.randomUUID(), label, checked: false }],
    }));
    setNewChecklistLabel('');
  }

  function addParticipant() {
    const name = participantName.trim();
    if (!name) return;
    const company = participantCompanyId ? companyById.get(participantCompanyId) : null;
    const freeCompany = participantCompanyFree.trim();
    setDraft(prev => {
      if (prev.participants.some(participant => normalizeSearchText(participant.name) === normalizeSearchText(name))) return prev;
      return {
        ...prev,
        participants: [
          ...prev.participants,
          {
            id: crypto.randomUUID(),
            name,
            role: participantRole.trim() || undefined,
            companyId: participantCompanyId || undefined,
            company: company?.name ?? (freeCompany || undefined),
          },
        ],
      };
    });
    setParticipantName('');
    setParticipantRole('');
    setParticipantCompanyId('');
    setParticipantCompanyFree('');
  }

  function setCoverPhoto(file: File | null) {
    if (!file || !file.type.startsWith('image/')) return;
    setDraft(prev => ({
      ...prev,
      coverPhoto: {
        id: crypto.randomUUID(),
        uri: URL.createObjectURL(file),
        name: file.name,
        kind: 'defect',
        file,
      },
    }));
  }

  function addUserParticipant(profile: Profile) {
    const label = profile.name || profile.email || 'Utilisateur';
    const role = ROLE_LABELS[String(profile.role)] ?? profile.role_label ?? profile.role;
    const company = profile.company_id ? companyById.get(profile.company_id) : null;
    setDraft(prev => {
      const exists = prev.participants.some(participant => {
        if (participant.profileId && participant.profileId === profile.id) return true;
        if (participant.email && profile.email && participant.email.toLowerCase() === profile.email.toLowerCase()) return true;
        return normalizeSearchText(participant.name) === normalizeSearchText(label);
      });
      if (exists) return prev;
      return {
        ...prev,
        participants: [
          ...prev.participants,
          {
            id: `profile-${profile.id}`,
            profileId: profile.id,
            name: label,
            email: profile.email || undefined,
            role: role || undefined,
            companyId: profile.company_id || undefined,
            company: company?.name,
          },
        ],
      };
    });
    setParticipantSearch('');
  }

  function addTag() {
    const tag = newTag.trim();
    if (!tag || draft.tags.includes(tag)) return;
    setDraft(prev => ({ ...prev, tags: [...prev.tags, tag] }));
    setNewTag('');
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <form className={`${styles.modalPanel} ${styles.reserveModalPanel}`} onSubmit={onSubmit}>
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>Visite chantier</p>
            <h2>Nouvelle visite</h2>
            <span>Préparez le périmètre, les entreprises et le modèle de contrôle comme sur mobile.</span>
          </div>
          <button type="button" onClick={onClose}>Fermer</button>
        </div>
        <div className={styles.reserveModalBody}>
          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Type de visite</strong>
                <span>Le type charge automatiquement un modèle de checklist adapté.</span>
              </div>
            </div>
            <div className={styles.visitTypeGrid}>
              {VISIT_TYPE_OPTIONS.map(option => {
                const active = draft.visitType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={active ? styles.visitTypeCardActive : styles.visitTypeCard}
                    style={active ? { borderColor: option.color, background: `${option.color}15`, color: option.color } : undefined}
                    onClick={() => updateVisitType(option.value)}
                  >
                    <span>{option.icon}</span>
                    <strong>{option.label}</strong>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Informations générales</strong>
                <span>Titre, conducteur, date et statut initial de la visite.</span>
              </div>
            </div>
            <div className={styles.reserveModalGrid}>
              <label>
                Chantier
                <select value={projectId} onChange={event => updateProject(event.target.value)}>
                  {data.chantiers.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label>
                Conducteur
                <input value={draft.conducteur} onChange={event => setDraft(prev => ({ ...prev, conducteur: event.target.value }))} />
              </label>
              <label className={styles.formWide}>
                <span className={styles.reserveLabelRow}>
                  Titre de la visite *
                  {canUseSuggestedTitle ? (
                    <button type="button" onClick={() => setDraft(prev => ({ ...prev, title: suggestedTitle }))}>Utiliser la suggestion</button>
                  ) : null}
                </span>
                <input value={draft.title} onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))} placeholder={suggestedTitle} required />
              </label>
              <label>
                Date
                <input type="date" value={draft.date} onChange={event => updateVisitDate(event.target.value)} />
              </label>
              <label>
                Statut initial
                <select value={draft.status} onChange={event => setDraft(prev => ({ ...prev, status: event.target.value as VisitDraft['status'] }))}>
                  {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                Début
                <input type="time" value={draft.startTime} onChange={event => setDraft(prev => ({ ...prev, startTime: event.target.value }))} />
              </label>
              <label>
                Fin
                <input type="time" value={draft.endTime} onChange={event => setDraft(prev => ({ ...prev, endTime: event.target.value }))} />
              </label>
              <div className={styles.formWide}>
                <div className={styles.visitCoverBox}>
                  <div>
                    <strong>Photo de couverture</strong>
                    <span>Optionnelle, visible dans le compte rendu de visite.</span>
                  </div>
                  {draft.coverPhoto ? (
                    <div className={styles.visitCoverPreview}>
                      <img src={draft.coverPhoto.uri} alt="Photo de couverture" />
                      <button type="button" onClick={() => setDraft(prev => ({ ...prev, coverPhoto: null }))}>Retirer</button>
                    </div>
                  ) : null}
                  <label>
                    Ajouter une photo
                    <input type="file" accept="image/*" capture="environment" onChange={event => setCoverPhoto(event.target.files?.[0] ?? null)} />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Périmètre de visite</strong>
                <span>Les réserves créées depuis cette visite seront limitées aux bâtiments sélectionnés.</span>
              </div>
              {hasBuildingHierarchy ? <span className={styles.reserveCountPill}>{draft.visitedLocations.length} / {buildings.length}</span> : null}
            </div>
            {hasBuildingHierarchy ? (
              <>
                <div className={styles.visitBuildingToolbar}>
                  <div className={styles.visitSearch}>
                    <span>⌕</span>
                    <input value={buildingQuery} onChange={event => setBuildingQuery(event.target.value)} placeholder="Rechercher bâtiment ou niveau..." />
                  </div>
                  <button type="button" onClick={selectVisibleBuildings}>
                    {buildingQuery.trim() ? 'Sélectionner les résultats' : 'Tout sélectionner'}
                  </button>
                  <button type="button" onClick={() => setDraft(prev => ({ ...prev, visitedLocations: [] }))} disabled={!draft.visitedLocations.length}>
                    Effacer
                  </button>
                </div>
                {draft.visitedLocations.length ? (
                  <div className={styles.visitSelectedLocations}>
                    {selectedLocations.map(location => (
                      <button
                        key={location.buildingId ?? location.buildingName}
                        type="button"
                        onClick={() => removeVisitedBuilding(location.buildingId, location.buildingName)}
                      >
                        {location.buildingName} ×
                      </button>
                    ))}
                    {hiddenSelectedCount ? <span>+{hiddenSelectedCount}</span> : null}
                  </div>
                ) : null}
                <div className={styles.visitBuildingGrid}>
                  {filteredBuildings.map((building: any) => {
                    const active = selectedBuildingIds.has(building.id);
                    return (
                      <button
                        key={building.id}
                        type="button"
                        className={active ? styles.visitBuildingCardActive : styles.visitBuildingCard}
                        onClick={() => toggleVisitedBuilding(building)}
                      >
                        <span className={styles.visitBuildingIcon}>{active ? '✓' : '▦'}</span>
                        <strong>{building.name}</strong>
                        <small>{(building.levels ?? []).length} niveaux</small>
                      </button>
                    );
                  })}
                  {!filteredBuildings.length ? <p className={styles.empty}>Aucun bâtiment trouvé.</p> : null}
                </div>
                {draft.visitedLocations.length ? (
                  <div className={styles.visitLocationPreview}>
                    {draft.visitedLocations.map(location => {
                      const building = buildings.find((item: any) => item.id === location.buildingId || item.name === location.buildingName);
                      const buildingPlans = building ? plansForBuilding(building) : [];
                      return (
                        <div key={location.buildingId ?? location.buildingName} className={styles.visitSelectedLocationCard}>
                          <div>
                            <strong>{location.buildingName}</strong>
                            <small>{buildingPlans.length} plan{buildingPlans.length > 1 ? 's' : ''} disponible{buildingPlans.length > 1 ? 's' : ''}</small>
                          </div>
                          <select
                            value={location.defaultPlanId ?? ''}
                            onChange={event => location.buildingId && updateLocationPlan(location.buildingId, event.target.value)}
                            className={styles.visitPlanSelect}
                          >
                            <option value="">Aucun plan par défaut</option>
                            {buildingPlans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.reserveModalGrid}>
                <label>
                  Bâtiment
                  <input value={draft.building} onChange={event => setDraft(prev => ({ ...prev, building: event.target.value }))} />
                </label>
                <label>
                  Niveau
                  <input value={draft.level} onChange={event => setDraft(prev => ({ ...prev, level: event.target.value }))} />
                </label>
                <label>
                  Zone
                  <input value={draft.zone} onChange={event => setDraft(prev => ({ ...prev, zone: event.target.value }))} />
                </label>
                <label>
                  Plan de référence
                  <select value={draft.defaultPlanId} onChange={event => setDraft(prev => ({ ...prev, defaultPlanId: event.target.value }))}>
                    <option value="">Aucun plan</option>
                    {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                  </select>
                </label>
              </div>
            )}
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Entreprises concernées</strong>
                <span>Entreprises inspectées pendant cette visite.</span>
              </div>
              <span className={styles.reserveCountPill}>{selectedCompanyCount} sélectionnée{selectedCompanyCount > 1 ? 's' : ''}</span>
            </div>
            <div className={styles.reserveCompanyGrid}>
              {data.companies.map(company => (
                <button
                  key={company.id}
                  type="button"
                  className={draft.companyIds.includes(company.id) ? styles.reserveCompanyChipActive : styles.reserveCompanyChip}
                  onClick={() => onToggleCompany(company.id)}
                >
                  <span style={{ background: company.color ?? '#94a3b8' }} />
                  <strong>{company.short_name ?? company.shortName ?? company.name}</strong>
                  <small>{company.name}</small>
                </button>
              ))}
            </div>
            {!data.companies.length ? <p className={styles.empty}>Aucune entreprise configurée.</p> : null}
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Checklist de contrôle</strong>
                <span>{draft.checklistItems.length ? `${checklistDone}/${draft.checklistItems.length} points validés.` : 'Choisissez un type ou ajoutez vos propres points.'}</span>
              </div>
              <button type="button" className={styles.secondaryBtn} onClick={() => setDraft(prev => ({ ...prev, checklistItems: makeVisitChecklist(prev.visitType) }))}>
                Recharger le modèle
              </button>
            </div>
            <div className={styles.visitChecklistList}>
              {draft.checklistItems.map(item => (
                <div key={item.id} className={styles.visitChecklistRow}>
                  <button
                    type="button"
                    className={item.checked ? styles.visitCheckboxChecked : styles.visitCheckbox}
                    onClick={() => setDraft(prev => ({ ...prev, checklistItems: prev.checklistItems.map(row => row.id === item.id ? { ...row, checked: !row.checked } : row) }))}
                  >
                    {item.checked ? '✓' : ''}
                  </button>
                  <input
                    value={item.label}
                    onChange={event => setDraft(prev => ({ ...prev, checklistItems: prev.checklistItems.map(row => row.id === item.id ? { ...row, label: event.target.value } : row) }))}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft(prev => ({ ...prev, checklistItems: prev.checklistItems.filter(row => row.id !== item.id) }))}
                    aria-label="Retirer ce point"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.visitInlineAdd}>
              <input
                value={newChecklistLabel}
                onChange={event => setNewChecklistLabel(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addChecklistItem();
                  }
                }}
                placeholder="Ajouter un point de contrôle..."
              />
              <button type="button" onClick={addChecklistItem} disabled={!newChecklistLabel.trim()}>Ajouter</button>
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Délai de levée des réserves</strong>
                <span>Date limite appliquée par défaut aux réserves créées depuis cette visite.</span>
              </div>
            </div>
            <div className={styles.visitDeadlineRow}>
              {VISIT_DEADLINE_SUGGESTIONS.map(suggestion => {
                const value = addDaysISO(todayISO(), suggestion.days);
                return (
                  <button
                    key={suggestion.days}
                    type="button"
                    className={draft.reserveDeadlineDate === value ? styles.chipActive : styles.chip}
                    onClick={() => setDraft(prev => ({ ...prev, reserveDeadlineDate: value }))}
                  >
                    {suggestion.label}
                  </button>
                );
              })}
              <input type="date" value={draft.reserveDeadlineDate} onChange={event => setDraft(prev => ({ ...prev, reserveDeadlineDate: event.target.value }))} />
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Participants, notes et diffusion</strong>
                <span>Sélectionnez les utilisateurs BuildTrack présents, puis ajoutez des invités externes si besoin.</span>
              </div>
            </div>
            {draft.participants.length ? (
              <div className={styles.visitParticipantList}>
                {draft.participants.map(participant => (
                  <div key={participant.id} className={styles.visitParticipantRow}>
                    <span className={styles.visitParticipantAvatar}>{initials(participant.name)}</span>
                    <div>
                      <strong>{participant.name}</strong>
                      <span>{[participant.role, participant.company].filter(Boolean).join(' · ') || 'Participant'}</span>
                    </div>
                    <button type="button" onClick={() => setDraft(prev => ({ ...prev, participants: prev.participants.filter(item => item.id !== participant.id) }))}>×</button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={styles.visitTeamPicker}>
              <div className={styles.visitTeamPickerHeader}>
                <div>
                  <strong>Utilisateurs de l’équipe</strong>
                  <span>Ajout rapide depuis les comptes existants du chantier.</span>
                </div>
                <span>{existingUserParticipants.length} disponible{existingUserParticipants.length > 1 ? 's' : ''}</span>
              </div>
              <input
                className={styles.visitTeamSearch}
                value={participantSearch}
                onChange={event => setParticipantSearch(event.target.value)}
                placeholder="Rechercher un utilisateur, rôle ou entreprise..."
              />
              <div className={styles.visitTeamList}>
                {visibleUserParticipants.map(profile => {
                  const label = profile.name || profile.email || 'Utilisateur';
                  const role = ROLE_LABELS[String(profile.role)] ?? profile.role_label ?? profile.role;
                  const company = profile.company_id ? companyById.get(profile.company_id) : null;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className={styles.visitTeamOption}
                      onClick={() => addUserParticipant(profile)}
                    >
                      <span className={styles.visitTeamAvatar}>{initials(label)}</span>
                      <span>
                        <strong>{label}</strong>
                        <small>{[role, company?.name, profile.email].filter(Boolean).join(' · ')}</small>
                      </span>
                      <em>Ajouter</em>
                    </button>
                  );
                })}
                {!visibleUserParticipants.length ? (
                  <p className={styles.visitTeamEmpty}>
                    {participantSearch ? 'Aucun utilisateur ne correspond à cette recherche.' : data.profiles.length ? 'Tous les utilisateurs disponibles sont déjà ajoutés.' : 'Aucun utilisateur BuildTrack disponible pour ce chantier.'}
                  </p>
                ) : null}
              </div>
            </div>
            <div className={styles.visitManualParticipant}>
              <div className={styles.visitManualParticipantHeader}>
                <strong>Ajouter un participant externe</strong>
                <span>Pour un intervenant non inscrit dans BuildTrack.</span>
              </div>
              <div className={styles.reserveModalGrid}>
                <label>
                  Nom participant
                  <input value={participantName} onChange={event => setParticipantName(event.target.value)} placeholder="Nom" />
                </label>
                <label>
                  Rôle
                  <input value={participantRole} onChange={event => setParticipantRole(event.target.value)} placeholder="Conducteur, chef d'équipe..." />
                </label>
                <label>
                  Entreprise
                  <select value={participantCompanyId} onChange={event => setParticipantCompanyId(event.target.value)}>
                    <option value="">Aucune / interne</option>
                    {data.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
                  </select>
                </label>
                <label>
                  Entreprise libre
                  <input value={participantCompanyFree} onChange={event => setParticipantCompanyFree(event.target.value)} placeholder="Nom entreprise externe" />
                </label>
                <div className={styles.visitInlineAdd}>
                  <button type="button" onClick={addParticipant} disabled={!participantName.trim()}>Ajouter le participant</button>
                </div>
              </div>
            </div>
            <div className={styles.reserveModalGrid}>
              <label className={styles.formWide}>
                Notes et objectifs
                <textarea value={draft.notes} onChange={event => setDraft(prev => ({ ...prev, notes: event.target.value }))} rows={4} placeholder="Objectif de la visite, points à contrôler, consignes..." />
              </label>
            </div>
            <div className={styles.visitTagRow}>
              {draft.tags.map(tag => (
                <button key={tag} type="button" onClick={() => setDraft(prev => ({ ...prev, tags: prev.tags.filter(item => item !== tag) }))}>
                  {tag} ×
                </button>
              ))}
              <input
                value={newTag}
                onChange={event => setNewTag(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Ajouter un tag..."
              />
              <button type="button" onClick={addTag} disabled={!newTag.trim()}>Ajouter</button>
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Récurrence</strong>
                <span>Créez une visite unique ou une petite série planifiée.</span>
              </div>
            </div>
            <div className={styles.visitTypeGrid}>
              {VISIT_RECURRENCE_OPTIONS.map(option => {
                const active = draft.recurrence === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={active ? styles.visitTypeCardActive : styles.visitTypeCard}
                    onClick={() => setDraft(prev => ({ ...prev, recurrence: option.value }))}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.desc}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.visitSummary}>
            <strong>Résumé</strong>
            <span>{draft.title || suggestedTitle}</span>
            <small>
              {VISIT_TYPE_LABELS[draft.visitType]} · {prettyDate(draft.date)} · {draft.visitedLocations.length || (draft.building ? 1 : 0)} bâtiment(s) · {selectedCompanyCount} entreprise(s)
            </small>
          </section>
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={saving}>{saving ? 'Création...' : draft.recurrence === 'none' ? 'Créer la visite' : 'Créer la série'}</button>
        </div>
      </form>
    </div>
  );
}

function AdminView({ data, profile, onUpdateProfile }: { data: WebState; profile: Profile | null; onUpdateProfile: (userId: string, patch: Partial<Profile>) => void }) {
  const [query, setQuery] = useState('');
  if (!isAdmin(profile)) {
    return <section className={styles.panel}><p className={styles.empty}>Accès réservé aux admins et super admins.</p></section>;
  }
  const q = query.trim().toLowerCase();
  const users = data.profiles.filter(user => !q || [user.name, user.email, user.role, user.role_label].join(' ').toLowerCase().includes(q));
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Utilisateurs" value={data.profiles.length} hint="Profils Supabase" />
        <Kpi title="Entreprises" value={data.companies.length} hint="Sous-traitants" tone="green" />
        <Kpi title="Préférences notif." value={data.notificationPreferences.length} hint="App / push / email" tone="amber" />
        <Kpi title="Chantiers" value={data.chantiers.length} hint="Périmètre org." />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Utilisateurs</h2>
            <p>Gestion web des rôles et entreprises rattachées.</p>
          </div>
          <input className={styles.compactSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher utilisateur..." />
        </div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.adminTableHead}`}><span>Utilisateur</span><span>Rôle</span><span>Entreprise</span><span>Email</span></div>
          {users.map(user => {
            return (
              <div key={user.id} className={`${styles.tableRow} ${styles.adminTableRow}`}>
                <strong>{user.name}</strong>
                <select value={user.role ?? ''} onChange={event => onUpdateProfile(user.id, { role: event.target.value })}>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={user.company_id ?? ''} onChange={event => onUpdateProfile(user.id, { company_id: event.target.value || null })}>
                  <option value="">Aucune</option>
                  {data.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <span>{user.email}</span>
              </div>
            );
          })}
          {!users.length && <p className={styles.empty}>Aucun utilisateur trouvé.</p>}
        </div>
      </section>
    </div>
  );
}

function SimpleColumn({ title, rows, primary, secondary }: { title: string; rows: any[]; primary: string; secondary: string }) {
  return (
    <div>
      <h3>{title}</h3>
      <div className={styles.compactList}>
        {rows.slice(0, 8).map(row => (
          <button key={row.id}>
            <span>{row[secondary] ? prettyDate(row[secondary]) : '—'}</span>
            <strong>{row[primary] ?? row.name ?? row.id}</strong>
          </button>
        ))}
        {!rows.length && <small>Aucun élément.</small>}
      </div>
    </div>
  );
}

