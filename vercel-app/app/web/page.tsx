'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

type WebPhotoAnnotationPoint = {
  x: number;
  y: number;
};

type WebPhotoAnnotationTool = 'dot' | 'arrow' | 'rect' | 'text' | 'measure' | 'pen';

type WebPhotoAnnotation = {
  id: string;
  x: number;
  y: number;
  color: string;
  label: string;
  tool?: WebPhotoAnnotationTool;
  x2?: number;
  y2?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  points?: WebPhotoAnnotationPoint[];
  strokeWidth?: number;
};

type WebPhotoDraft = {
  id: string;
  uri: string;
  name?: string;
  kind?: 'defect' | 'resolution';
  file?: File;
  existing?: boolean;
  annotations?: WebPhotoAnnotation[];
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
  color: string;
};

type PinPlacementPreview = {
  id: string;
  planId: string;
  x: number;
  y: number;
  label: string;
};

type PinMoveResult = Promise<boolean | void> | boolean | void;

type WebPlanDrawingTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'cloud' | 'highlight';

type WebPlanDrawing = {
  id: string;
  tool: WebPlanDrawingTool;
  points: Array<{ x: number; y: number }>;
  color: string;
  strokeWidth: number;
  text?: string;
  fontSize?: number;
  opacity?: number;
  page?: number;
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
const WEB_RECENT_BUILDINGS_KEY = 'buildtrack-web-recent-buildings-v1';
const PHOTO_ANNOTATION_COLORS = ['#EF4444', '#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#FFFFFF', '#111827'];
const PHOTO_ANNOTATION_STROKES = [2, 8, 18];

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'plans', label: 'Plans', icon: 'map' },
  { id: 'reserves', label: 'Réserves', icon: 'warning' },
  { id: 'messages', label: 'Messages', icon: 'chatbubbles' },
  { id: 'terrain', label: 'Terrain', icon: 'hammer' },
  { id: 'incidents', label: 'Incidents', icon: 'alert-circle' },
  { id: 'opr', label: 'OPR', icon: 'checkbox' },
  { id: 'visites', label: 'Visites', icon: 'checkbox' },
  { id: 'planning', label: 'Planning', icon: 'time' },
  { id: 'media', label: 'Médias', icon: 'images' },
  { id: 'rapports', label: 'Rapports', icon: 'document-text' },
  { id: 'equipes', label: 'Équipes', icon: 'people-circle' },
  { id: 'settings', label: 'Réglages', icon: 'options' },
  { id: 'admin', label: 'Admin', icon: 'settings' },
] as const;

type TabId = typeof TABS[number]['id'];
type NavIconName = typeof TABS[number]['icon'];

const NAV_GROUPS: { label: string; items: TabId[] }[] = [
  { label: 'Navigation', items: ['dashboard', 'plans', 'reserves', 'messages', 'terrain'] },
];

const TERRAIN_CHILD_TABS = new Set<TabId>([
  'visites',
  'planning',
  'incidents',
  'opr',
  'media',
  'rapports',
  'equipes',
  'settings',
  'admin',
]);

function SidebarNavIcon({ name, active = false }: { name: NavIconName; active?: boolean }) {
  const strokeProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const outlineRect = (x: number, y: number) => <rect x={x} y={y} width="6.2" height="6.2" rx="1.35" {...strokeProps} />;
  const filledRect = (x: number, y: number) => <rect x={x} y={y} width="6.5" height="6.5" rx="1.45" fill="currentColor" />;

  const paths: Record<NavIconName, ReactNode> = {
    grid: active ? (
      <>
        {filledRect(3.2, 3.2)}
        {filledRect(14.3, 3.2)}
        {filledRect(3.2, 14.3)}
        {filledRect(14.3, 14.3)}
      </>
    ) : (
      <>
        {outlineRect(3.2, 3.2)}
        {outlineRect(14.6, 3.2)}
        {outlineRect(3.2, 14.6)}
        {outlineRect(14.6, 14.6)}
      </>
    ),
    map: active ? (
      <>
        <path d="M8.8 18.9 4.2 21A1.45 1.45 0 0 1 2.2 19.7V6.2c0-.56.32-1.08.82-1.32L8.8 2.2v16.7Z" fill="currentColor" opacity="0.9" />
        <path d="m8.8 2.2 6.4 3v16.6l-6.4-2.9V2.2Z" fill="currentColor" opacity="0.72" />
        <path d="m15.2 5.2 4.6-2.1a1.45 1.45 0 0 1 2 1.32v13.38c0 .57-.33 1.09-.84 1.33l-5.76 2.67V5.2Z" fill="currentColor" />
      </>
    ) : (
      <>
        <path d="M3 6.5 9 4l6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5V6.5Z" {...strokeProps} />
        <path d="M9 4v13.5" {...strokeProps} />
        <path d="M15 6.5V20" {...strokeProps} />
      </>
    ),
    warning: active ? (
      <>
        <path d="M10.25 4.35a2 2 0 0 1 3.5 0l8.15 14.2A2 2 0 0 1 20.15 21H3.85a2 2 0 0 1-1.75-2.45l8.15-14.2Z" fill="currentColor" />
        <path d="M12 8.2v5.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.05" fill="#fff" />
      </>
    ) : (
      <>
        <path d="M10.25 4.35a2 2 0 0 1 3.5 0l8.15 14.2A2 2 0 0 1 20.15 21H3.85a2 2 0 0 1-1.75-2.45l8.15-14.2Z" {...strokeProps} />
        <path d="M12 8.2v5.4" {...strokeProps} />
        <circle cx="12" cy="17" r="0.85" fill="currentColor" />
      </>
    ),
    chatbubbles: active ? (
      <>
        <path d="M8.2 4.1h6.4a5.9 5.9 0 0 1 5.9 5.9 5.78 5.78 0 0 1-1.72 4.14l.67 3.06a.75.75 0 0 1-1.05.83l-3.22-1.48H8.2A5.9 5.9 0 1 1 8.2 4.1Z" fill="currentColor" />
        <path d="M5.7 10.1a7.5 7.5 0 0 0 7.5 7.5h1.7a5.05 5.05 0 0 1-4.85 3.55H6.5l-2.48 1.16a.68.68 0 0 1-.96-.75l.52-2.44A5.05 5.05 0 0 1 5.7 10.1Z" fill="currentColor" opacity="0.58" />
      </>
    ) : (
      <>
        <path d="M8 4h6.5a6 6 0 0 1 6 6 5.9 5.9 0 0 1-1.72 4.16l.65 3.02-3.2-1.46H8a6 6 0 1 1 0-11.72Z" {...strokeProps} />
        <path d="M5.6 10.4A5.1 5.1 0 0 0 6.45 19h3.65l2.58 1.2-.4-1.86" {...strokeProps} />
      </>
    ),
    hammer: active ? (
      <>
        <path
          d="M13.15 3.5a1.35 1.35 0 0 1 1.9 0l5.45 5.45a1.35 1.35 0 0 1 0 1.9l-1.05 1.05a1.35 1.35 0 0 1-1.9 0L12.1 6.45a1.35 1.35 0 0 1 0-1.9l1.05-1.05Z"
          fill="currentColor"
        />
        <path
          d="M12.8 8.6 4.35 17.05a2.05 2.05 0 0 0 2.9 2.9l8.45-8.45"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="m11.55 7.35 5.1 5.1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity="0.85" />
      </>
    ) : (
      <>
        <path
          d="M13.15 3.5a1.35 1.35 0 0 1 1.9 0l5.45 5.45a1.35 1.35 0 0 1 0 1.9l-1.05 1.05a1.35 1.35 0 0 1-1.9 0L12.1 6.45a1.35 1.35 0 0 1 0-1.9l1.05-1.05Z"
          {...strokeProps}
        />
        <path d="M12.8 8.6 4.35 17.05a2.05 2.05 0 0 0 2.9 2.9l8.45-8.45" {...strokeProps} />
        <path d="m11.55 7.35 5.1 5.1" {...strokeProps} />
      </>
    ),
    'alert-circle': (
      <>
        <circle cx="12" cy="12" r="9" {...strokeProps} />
        <path d="M12 7.5v5" {...strokeProps} />
        <circle cx="12" cy="16.5" r="0.8" fill="currentColor" />
      </>
    ),
    checkbox: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2.4" {...strokeProps} />
        <path d="m8 12 2.6 2.6L16 9.2" {...strokeProps} />
      </>
    ),
    time: (
      <>
        <circle cx="12" cy="12" r="8.8" {...strokeProps} />
        <path d="M12 7v5l3.1 1.8" {...strokeProps} />
      </>
    ),
    images: (
      <>
        <rect x="5" y="5" width="14" height="14" rx="2.2" {...strokeProps} />
        <path d="m8 15 2.2-2.3a1.2 1.2 0 0 1 1.74.02L15.5 17" {...strokeProps} />
        <circle cx="14.6" cy="9.2" r="1" fill="currentColor" />
        <path d="M3 17V4a1 1 0 0 1 1-1h13" {...strokeProps} />
      </>
    ),
    'document-text': (
      <>
        <path d="M6 3.8h7.2L18 8.6v11.6H6V3.8Z" {...strokeProps} />
        <path d="M13 4v5h5" {...strokeProps} />
        <path d="M9 12h6" {...strokeProps} />
        <path d="M9 15.5h5" {...strokeProps} />
      </>
    ),
    'people-circle': (
      <>
        <circle cx="12" cy="12" r="9" {...strokeProps} />
        <circle cx="9.2" cy="10" r="2.1" {...strokeProps} />
        <circle cx="15.1" cy="10.4" r="1.65" {...strokeProps} />
        <path d="M5.7 16.7c.72-2.1 2.15-3.15 4.3-3.15s3.6 1.05 4.3 3.15" {...strokeProps} />
        <path d="M13.6 14.4c1.55.1 2.7.85 3.42 2.22" {...strokeProps} />
      </>
    ),
    options: (
      <>
        <path d="M5 7h14" {...strokeProps} />
        <path d="M5 12h14" {...strokeProps} />
        <path d="M5 17h14" {...strokeProps} />
        <circle cx="9" cy="7" r="1.7" fill="currentColor" />
        <circle cx="15" cy="12" r="1.7" fill="currentColor" />
        <circle cx="10.8" cy="17" r="1.7" fill="currentColor" />
      </>
    ),
    settings: (
      <>
        <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" {...strokeProps} />
        <path d="M20.3 13.6v-3.2l-2.3-.45a6.7 6.7 0 0 0-.78-1.88l1.3-1.96-2.25-2.25-1.96 1.3a6.7 6.7 0 0 0-1.88-.78L12 2.1H8.8l-.45 2.3a6.7 6.7 0 0 0-1.88.78l-1.96-1.3L2.26 6.13l1.3 1.96a6.7 6.7 0 0 0-.78 1.88l-2.3.45v3.2l2.3.45c.18.66.44 1.29.78 1.88l-1.3 1.96 2.25 2.25 1.96-1.3c.59.34 1.22.6 1.88.78l.45 2.3H12l.45-2.3c.66-.18 1.29-.44 1.88-.78l1.96 1.3 2.25-2.25-1.3-1.96c.34-.59.6-1.22.78-1.88l2.28-.47Z" {...strokeProps} />
      </>
    ),
  };

  return (
    <svg className={styles.navIconSvg} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}

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

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, [query]);

  return matches;
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

function isReserveClosed(reserve: any) {
  return String(reserve?.status ?? '').toLowerCase() === 'closed';
}

function getReserveCreatedSortKey(reserve: any) {
  return String(reserve?.createdAt ?? reserve?.created_at ?? reserve?.created ?? reserve?.date ?? '');
}

function comparePlanPinReserveOrder(a: any, b: any) {
  const byCreated = getReserveCreatedSortKey(a).localeCompare(getReserveCreatedSortKey(b));
  if (byCreated !== 0) return byCreated;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

function shouldNumberReserveOnPlan(reserve: any, focusedReserveId?: string | null) {
  const reserveId = String(reserve?.id ?? '');
  const focusedId = focusedReserveId ? String(focusedReserveId) : '';
  return !isReserveArchived(reserve) && (!isReserveClosed(reserve) || Boolean(focusedId && reserveId === focusedId));
}

function createPlanPinNumberMap(reserves: any[]) {
  const map = new Map<string, number>();
  [...reserves].sort(comparePlanPinReserveOrder).forEach((reserve, index) => {
    const id = String(reserve?.id ?? '');
    if (id) map.set(id, index + 1);
  });
  return map;
}

function getPlanPinNumber(numberMap: Map<string, number>, reserve: any) {
  return numberMap.get(String(reserve?.id ?? ''));
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

function parseDateSafe(value?: string | null) {
  if (!value) return null;
  const frenchMatch = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (frenchMatch) {
    const parsed = new Date(Number(frenchMatch[3]), Number(frenchMatch[2]) - 1, Number(frenchMatch[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getWeekStart(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return copy;
}

function getWeekKey(date: Date) {
  return getWeekStart(date).toISOString().slice(0, 10);
}

function getWeekLabel(date: Date) {
  const start = getWeekStart(date);
  return `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`;
}

function getReserveCreatedDate(reserve: any) {
  return parseDateSafe(reserve?.created_at ?? reserve?.createdAt ?? reserve?.created);
}

function getReserveClosedDate(reserve: any) {
  return parseDateSafe(reserve?.closed_at ?? reserve?.closedAt);
}

function isTaskLateWeb(task: any) {
  if (['done', 'completed', 'closed'].includes(String(task?.status ?? ''))) return false;
  if (String(task?.status ?? '') === 'delayed') return true;
  const deadline = parseDateSafe(task?.deadline);
  if (!deadline) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return deadline < today;
}

function isIncidentOpenWeb(incident: any) {
  return !['resolved', 'closed', 'done'].includes(String(incident?.status ?? '').toLowerCase());
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

function getReserveBuildingInfo(reserve: any, plansById?: Map<string, any>, project?: any | null) {
  const directId = String(reserve?.building_id ?? reserve?.buildingId ?? '').trim();
  const directName = String(reserve?.building_name ?? reserve?.building ?? reserve?.batiment ?? '').trim();
  if (directId || directName) {
    const name = directName || getBuildingNameById(project, directId) || 'Sans bâtiment';
    return {
      key: directId ? `id:${directId}` : name === 'Sans bâtiment' ? '__none__' : `name:${normalizeSearchText(name)}`,
      name,
      selectable: name !== 'Sans bâtiment',
    };
  }

  const planId = getReservePlanId(reserve);
  const plan = planId && plansById ? plansById.get(planId) : null;
  if (plan) {
    const location = getPlanDisplayLocation(plan, project);
    const buildingId = location.buildingId || getPlanBuildingId(plan);
    const name = location.building || getPlanBuildingName(plan);
    return {
      key: buildingId ? `id:${buildingId}` : name === 'Sans bâtiment' ? '__none__' : `name:${normalizeSearchText(name)}`,
      name,
      selectable: name !== 'Sans bâtiment',
    };
  }

  return { key: '__none__', name: 'Sans bâtiment', selectable: false };
}

function buildReserveBuildingBreakdown(reserves: any[], plansById: Map<string, any>, project?: any | null) {
  const groups = new Map<string, {
    key: string;
    name: string;
    selectable: boolean;
    total: number;
    pinned: number;
    overdue: number;
    open: number;
    closed: number;
  }>();

  for (const reserve of reserves) {
    const info = getReserveBuildingInfo(reserve, plansById, project);
    const current = groups.get(info.key) ?? {
      key: info.key,
      name: info.name,
      selectable: info.selectable,
      total: 0,
      pinned: 0,
      overdue: 0,
      open: 0,
      closed: 0,
    };
    current.total += 1;
    current.pinned += hasReservePlanPin(reserve) ? 1 : 0;
    current.overdue += isReserveOverdue(reserve) ? 1 : 0;
    current.open += reserve.status === 'closed' ? 0 : 1;
    current.closed += reserve.status === 'closed' ? 1 : 0;
    groups.set(info.key, current);
  }

  return Array.from(groups.values()).sort((a, b) =>
    b.total - a.total ||
    b.pinned - a.pinned ||
    a.name.localeCompare(b.name)
  );
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

function assetDedupeKey(url: string) {
  const value = String(url ?? '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return value.replace(/[?#].*$/, '').toLowerCase();
  }
}

function createPhotoAnnotationId() {
  const webCrypto = globalThis.crypto;
  return webCrypto && 'randomUUID' in webCrypto
    ? webCrypto.randomUUID()
    : `photo-annotation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizePhotoAnnotations(value: any): WebPhotoAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const rawPoints = Array.isArray(item?.points) ? item.points : [];
    const points = rawPoints
      .map((point: any) => ({ x: Number(point?.x), y: Number(point?.y) }))
      .filter((point: WebPhotoAnnotationPoint) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point: WebPhotoAnnotationPoint) => ({
        x: Number(clampPercent(point.x).toFixed(2)),
        y: Number(clampPercent(point.y).toFixed(2)),
      }));
    const x = Number(item?.x);
    const y = Number(item?.y);
    const toolValue = String(item?.tool ?? 'dot');
    const tool = ['dot', 'arrow', 'rect', 'text', 'measure', 'pen'].includes(toolValue)
      ? toolValue as WebPhotoAnnotationTool
      : 'dot';

    return {
      id: String(item?.id ?? createPhotoAnnotationId()),
      x: Number.isFinite(x) ? Number(clampPercent(x).toFixed(2)) : points[0]?.x ?? 50,
      y: Number.isFinite(y) ? Number(clampPercent(y).toFixed(2)) : points[0]?.y ?? 50,
      color: String(item?.color ?? PHOTO_ANNOTATION_COLORS[index % PHOTO_ANNOTATION_COLORS.length]),
      label: String(item?.label ?? item?.text ?? (index + 1)),
      tool,
      points,
      strokeWidth: Number.isFinite(Number(item?.strokeWidth)) ? Number(item.strokeWidth) : undefined,
      text: item?.text ? String(item.text) : undefined,
      fontSize: Number.isFinite(Number(item?.fontSize)) ? Number(item.fontSize) : undefined,
      x2: Number.isFinite(Number(item?.x2)) ? Number(clampPercent(Number(item.x2)).toFixed(2)) : undefined,
      y2: Number.isFinite(Number(item?.y2)) ? Number(clampPercent(Number(item.y2)).toFixed(2)) : undefined,
      width: Number.isFinite(Number(item?.width)) ? Number(item.width) : undefined,
      height: Number.isFinite(Number(item?.height)) ? Number(item.height) : undefined,
    };
  });
}

function photoAnnotationsFrom(photo: any) {
  return normalizePhotoAnnotations(photo?.annotations ?? photo?.photo_annotations ?? photo?.photoAnnotations);
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
    const key = assetDedupeKey(uri) || String(photo.id ?? uri);
    const normalizedPhoto = { ...photo, uri, annotations: photoAnnotationsFrom(photo) };
    const existingPhoto = byKey.get(key);
    if (!existingPhoto) {
      byKey.set(key, normalizedPhoto);
    } else if (!photoAnnotationsFrom(existingPhoto).length && normalizedPhoto.annotations.length) {
      byKey.set(key, { ...existingPhoto, annotations: normalizedPhoto.annotations });
    }
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
  const localKeys = [...fromReserve, ...legacyReservePhotos, ...fromTable]
    .filter(photo => /^file:\/\//i.test(rawPhotoUrl(photo)))
    .map(photo => rawPhotoUrl(photo).replace(/[?#].*$/, '').toLowerCase());
  return new Set(localKeys).size;
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizePlanPercent(value?: any) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(clampPercent(num).toFixed(2));
}

function planCoordinateToPercent(value: any, ratioMode = false) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return clampPercent(ratioMode ? num * 100 : num);
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

function printHtmlReport(html: string, filename: string) {
  if (typeof window === 'undefined') return;

  const frame = document.createElement('iframe');
  let didPrint = false;
  frame.title = filename;
  frame.style.position = 'fixed';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.border = '0';

  const cleanup = () => {
    window.setTimeout(() => frame.remove(), 1500);
  };

  const downloadHtmlFallback = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.replace(/\.pdf$/i, '.html');
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  frame.onload = () => {
    if (didPrint) return;
    didPrint = true;

    window.setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        downloadHtmlFallback();
      } finally {
        cleanup();
      }
    }, 250);
  };

  frame.srcdoc = html;
  document.body.appendChild(frame);
}

function reserveCompanies(reserve: any): string[] {
  const names = [
    ...(Array.isArray(reserve?.companies) ? reserve.companies : []),
    reserve?.company,
    reserve?.company_name,
    reserve?.companyName,
  ]
    .map(name => String(name ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(names));
}

function getCompanyColor(companyName: string, companies: any[]): string {
  if (!companyName || companyName === '__mixed__') return '#6B7280';
  const match = companies.find(c => sameName(c?.name, companyName));
  return match?.color ?? '#003082';
}

function getReservePinColor(reserve: any, companies: any[]): string {
  const names = reserveCompanies(reserve);
  if (names.length > 1) return '#6B7280';
  return getCompanyColor(names[0] ?? '', companies);
}

function getReservePlanId(reserve: any) {
  return String(reserve?.plan_id ?? reserve?.planId ?? '').trim();
}

function hasReservePlanPin(reserve: any) {
  return Boolean(getReservePlanId(reserve)) &&
    normalizePlanPercent(reserve?.plan_x ?? reserve?.planX) != null &&
    normalizePlanPercent(reserve?.plan_y ?? reserve?.planY) != null;
}

function reserveMatchesCompanyName(reserve: any, companyName?: string | null) {
  const target = String(companyName ?? '').trim();
  if (!target) return false;
  return reserveCompanies(reserve).some(name => sameName(name, target));
}

function reserveMatchesCompanyIdOrName(reserve: any, company?: any | null) {
  if (!company) return false;
  const companyId = String(company.id ?? '').trim();
  const companyName = String(company.name ?? '').trim();
  return reserveCompanies(reserve).some(token => (
    (companyId && String(token).trim() === companyId) ||
    (companyName && sameName(token, companyName))
  ));
}

function visibleReservesForProfile(reserves: any[], profile: Profile | null, companies: any[]) {
  if (profile?.role !== 'sous_traitant') return reserves;
  const company = companies.find(company => String(company.id) === String(profile.company_id ?? ''));
  if (!company) return [];
  return reserves.filter(reserve => reserveMatchesCompanyIdOrName(reserve, company));
}

function toPdfReserveItem(reserve: any, index = 0) {
  return {
    id: String(reserve?.id ?? `reserve-${index + 1}`),
    num: index + 1,
    title: String(reserve?.title ?? reserve?.description ?? 'Reserve'),
    company: reserveCompanies(reserve).join(', '),
    building: String(reserve?.building_name ?? reserve?.building ?? reserve?.batiment ?? '').trim(),
    level: String(reserve?.level_name ?? reserve?.level ?? reserve?.niveau ?? '').trim(),
    status: String(reserve?.status ?? 'open'),
    priority: String(reserve?.priority ?? 'medium'),
    deadline: String(reserve?.deadline ?? reserve?.due_date ?? reserve?.dueDate ?? '').trim(),
    description: String(reserve?.description ?? '').trim(),
    planId: getReservePlanId(reserve),
    planX: normalizePlanPercent(reserve?.plan_x ?? reserve?.planX),
    planY: normalizePlanPercent(reserve?.plan_y ?? reserve?.planY),
    photos: getPdfReservePhotoItems(reserve).map((photo: any) => ({
      ...photo,
      uri: photo.uri,
    })),
  };
}

function getPdfReservePhotoItems(reserve: any) {
  const source = Array.isArray(reserve?.photos) && reserve.photos.length > 0
    ? reserve.photos
    : (reserve?.photo_uri ?? reserve?.photoUri)
      ? [{ uri: reserve.photo_uri ?? reserve.photoUri, kind: 'defect', comment: 'Photo' }]
      : [];

  return source
    .map((photo: any) => {
      const uri = assetUrl(photo, 'photos') || String(photo?.uri ?? '').trim();
      return uri ? { ...photo, uri } : null;
    })
    .filter(Boolean);
}

function getPdfReservePhotoUrls(reserve: any) {
  return getPdfReservePhotoItems(reserve).map((photo: any) => photo.uri);
}

const REPORT_MAX_TOTAL_REMOTE_PHOTOS = 150;
const REPORT_MAX_PHOTOS_PER_RESERVE = 2;
const INDIVIDUAL_RESERVE_MAX_PHOTOS = 3;
const PLAN_REPORT_PHOTO_RENDER_WIDTH = 800;
const PLAN_REPORT_PHOTO_QUALITY = 0.55;
const pdfPhotoDataUrlCache = new Map<string, Promise<string | null>>();

function isPdfReportRemoteAsset(uri: string) {
  return /^https?:\/\//i.test(String(uri ?? '').trim());
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture image impossible.'));
    reader.readAsDataURL(blob);
  });
}

function loadBlobImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image illisible.'));
    };
    image.src = objectUrl;
  });
}

async function imageUrlToPdfDataUrl(uri: string) {
  const value = String(uri ?? '').trim();
  if (!value) return null;
  if (value.startsWith('data:')) return value;
  if (typeof document === 'undefined' || typeof window === 'undefined') return value;

  if (!pdfPhotoDataUrlCache.has(value)) {
    pdfPhotoDataUrlCache.set(value, (async () => {
      try {
        const response = await fetch(value, { credentials: 'omit', mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        try {
          const image = await loadBlobImage(blob);
          const ratio = image.width > 0
            ? Math.min(1, PLAN_REPORT_PHOTO_RENDER_WIDTH / image.width)
            : 1;
          const width = Math.max(1, Math.round(image.width * ratio));
          const height = Math.max(1, Math.round(image.height * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) return await blobToDataUrl(blob);
          context.drawImage(image, 0, 0, width, height);
          return canvas.toDataURL('image/jpeg', PLAN_REPORT_PHOTO_QUALITY);
        } catch {
          return await blobToDataUrl(blob);
        }
      } catch {
        return value;
      }
    })());
  }

  return await pdfPhotoDataUrlCache.get(value)!;
}

function getPdfRemoteReservePhotoItems(reserve: any, maxPhotosPerReserve: number) {
  if (maxPhotosPerReserve <= 0) return [];
  return getPdfReservePhotoItems(reserve)
    .filter((photo: any) => isPdfReportRemoteAsset(photo.uri))
    .slice(0, maxPhotosPerReserve)
    .map((photo: any) => ({
      ...photo,
      uri: photo.uri,
    }));
}

function withPdfRemoteReservePhotos(reserve: any, maxPhotosPerReserve: number) {
  if (!reserve) return reserve;
  const photos = getPdfRemoteReservePhotoItems(reserve, maxPhotosPerReserve);

  return {
    ...reserve,
    photos,
    photoUri: photos[0]?.uri ?? reserve.photoUri ?? reserve.photo_uri ?? null,
    photo_uri: photos[0]?.uri ?? reserve.photo_uri ?? reserve.photoUri ?? null,
  };
}

function withPdfRemoteReservePhotoList(reserves: any[], maxPhotosPerReserve: number, maxTotalPhotos = REPORT_MAX_TOTAL_REMOTE_PHOTOS) {
  const result: any[] = [];
  let remaining = maxTotalPhotos;

  for (const reserve of reserves) {
    const allowed = Math.max(0, Math.min(maxPhotosPerReserve, remaining));
    const prepared = withPdfRemoteReservePhotos(reserve, allowed);
    remaining -= Array.isArray(prepared?.photos) ? prepared.photos.length : 0;
    result.push(prepared);
  }

  return result;
}

async function withPdfEmbeddedVisitMedia(visit: any) {
  if (!visit) return visit;
  const coverRaw = visit.cover_photo_uri ?? visit.coverPhotoUri;
  if (!coverRaw) return visit;
  const coverUri = assetUrl({ uri: coverRaw }, 'photos') || String(coverRaw).trim();
  const embeddedCoverUri = coverUri ? await imageUrlToPdfDataUrl(coverUri) : null;

  return {
    ...visit,
    cover_photo_uri: embeddedCoverUri ?? coverRaw,
    coverPhotoUri: embeddedCoverUri ?? coverRaw,
  };
}

async function toPdfReserveItemsForPlanReport(reserves: any[]) {
  const maxPhotosPerReserve = reserves.length === 0
    ? 0
    : Math.min(
        REPORT_MAX_PHOTOS_PER_RESERVE,
        Math.floor(REPORT_MAX_TOTAL_REMOTE_PHOTOS / reserves.length),
      );
  const planReserveBuckets = new Map<string, any[]>();
  for (const reserve of reserves) {
    const planId = getReservePlanId(reserve);
    if (!planId) continue;
    const bucket = planReserveBuckets.get(planId) ?? [];
    bucket.push(reserve);
    planReserveBuckets.set(planId, bucket);
  }
  const pinNumberMapsByPlan = new Map<string, Map<string, number>>();
  for (const [planId, planReserves] of planReserveBuckets) {
    pinNumberMapsByPlan.set(planId, createPlanPinNumberMap(planReserves));
  }

  return reserves.map((reserve, index) => {
    const planPinNumber = pinNumberMapsByPlan.get(getReservePlanId(reserve))?.get(String(reserve?.id ?? ''));
    const item = {
      ...toPdfReserveItem(reserve, index),
      ...(planPinNumber ? { num: planPinNumber } : {}),
    };
    if (maxPhotosPerReserve <= 0 || item.photos.length === 0) {
      return { ...item, photos: [] };
    }

    return {
      ...item,
      photos: getPdfRemoteReservePhotoItems(reserve, maxPhotosPerReserve),
    };
  });
}

function toPdfPlanItem(plan: any) {
  return {
    id: String(plan?.id ?? ''),
    name: String(plan?.name ?? 'Plan'),
    building: getPlanBuildingName(plan),
    level: getPlanLevelName(plan),
    uri: assetUrl(plan, 'documents') || String(plan?.uri ?? plan?.url ?? '').trim(),
    fileType: String(plan?.file_type ?? plan?.fileType ?? '').trim(),
  };
}

async function toPdfPlanItemsForReport(plans: any[], reserves: any[]) {
  const activePlanIds = new Set(
    reserves
      .map(reserve => getReservePlanId(reserve))
      .filter(Boolean),
  );

  const items: any[] = [];
  for (const plan of plans) {
    const item = toPdfPlanItem(plan);
    if (!activePlanIds.has(item.id) || !item.uri || !isPdfPlan(plan, item.uri)) {
      items.push(item);
      continue;
    }

    const renderedUri = isPdfPlan(plan, item.uri)
      ? await preRenderPdfPageToDataUrl(item.uri, 720)
      : await imageUrlToPdfDataUrl(item.uri);
    items.push(renderedUri
      ? { ...item, uri: renderedUri, fileType: 'image' }
      : item);
  }
  return items;
}

function getPlanReportUri(plan: any) {
  return assetUrl(plan, 'documents') || String(plan?.uri ?? plan?.url ?? '').trim();
}

function isPdfPlan(plan: any, uri?: string | null) {
  const fileType = String(plan?.file_type ?? plan?.fileType ?? '').toLowerCase();
  const value = String(uri ?? plan?.uri ?? plan?.url ?? '').toLowerCase();
  return fileType === 'pdf' || fileType.includes('pdf') || value.includes('.pdf') || value.includes('application/pdf');
}

function dataUrlToPdfBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function preRenderPdfPageToDataUrl(pdfUri: string, renderWidth: number) {
  if (typeof document === 'undefined' || !pdfUri) return null;
  try {
    const pdfjs: any = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc ||= `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
    const source = pdfUri.startsWith('data:')
      ? { data: dataUrlToPdfBytes(pdfUri) }
      : { url: pdfUri, withCredentials: false };
    const loadingTask = pdfjs.getDocument(source);
    const pdf = await loadingTask.promise;
    try {
      const page = await pdf.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = renderWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return null;
      await page.render({ canvasContext: context, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.88);
    } finally {
      pdf.destroy?.();
    }
  } catch {
    return null;
  }
}

async function getPlanImageForReserveReport(plan: any) {
  const uri = getPlanReportUri(plan);
  if (!uri) return null;
  if (!isPdfPlan(plan, uri)) return await imageUrlToPdfDataUrl(uri);
  return await preRenderPdfPageToDataUrl(uri, 720);
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

async function requestWebTranslation(params: { text: string; source?: TextLang | 'auto'; target: TextLang; context: string }) {
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

function readStoredStringList(key: string) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function appendDictationText(current: string, transcript: string) {
  const text = transcript.trim();
  if (!text) return current;
  const base = current.trimEnd();
  return base ? `${base} ${text}` : text;
}

function speechRecognitionErrorMessage(error?: string) {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return "Le micro ou la reconnaissance vocale est refusé pour ce site. Vérifiez l'autorisation micro dans le navigateur.";
    case 'audio-capture':
      return "Aucun micro utilisable n'a été détecté. Vérifiez le périphérique d'entrée audio.";
    case 'network':
      return "La reconnaissance vocale du navigateur est indisponible pour le moment. Elle nécessite une connexion stable et le service vocal de Chrome/Edge.";
    case 'no-speech':
    case 'speech-timeout':
      return "Aucune parole détectée. Relancez la dictée et parlez après l'activation du micro.";
    case 'language-not-supported':
      return "Cette langue de dictée n'est pas disponible dans ce navigateur.";
    case 'aborted':
      return 'Dictée arrêtée. Vous pouvez relancer le micro.';
    default:
      return 'Dictée interrompue. Relancez le micro ou vérifiez le périphérique audio.';
  }
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  );
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
          annotations: photoAnnotationsFrom(photo),
        })).filter((photo: WebPhotoDraft) => !!photo.uri)
      : (reserve.photo_uri ?? reserve.photoUri)
        ? [{
            id: 'legacy',
            uri: assetUrl({ uri: reserve.photo_uri ?? reserve.photoUri }, 'photos'),
            name: 'Photo',
            kind: 'defect' as const,
            existing: true,
            annotations: photoAnnotationsFrom(reserve),
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

      const scopedReserves = visibleReservesForProfile(reserves, loadedProfile, companies);
      const scopedReserveIds = new Set(scopedReserves.map((reserve: any) => String(reserve.id)));
      const scopedPhotos = loadedProfile.role === 'sous_traitant'
        ? photos.filter((photo: any) => {
            const reserveId = photo.reserve_id ?? photo.reserveId;
            return reserveId && scopedReserveIds.has(String(reserveId));
          })
        : photos;
      const scopedDocuments = loadedProfile.role === 'sous_traitant' ? [] : documents;

      const nextData = {
        chantiers,
        reserves: scopedReserves,
        sitePlans,
        companies,
        visites,
        messages,
        channels,
        profiles,
        lots,
        tasks,
        incidents,
        documents: scopedDocuments,
        photos: scopedPhotos,
        oprs,
        notificationPreferences,
      };
      setData(nextData);
      setSelectedProjectId(prev => prev !== 'all' && chantiers.some((c: any) => c.id === prev) ? prev : chantiers[0]?.id ?? 'all');
      setSelectedReserveId(prev => prev && scopedReserves.some((r: any) => r.id === prev) ? prev : scopedReserves[0]?.id ?? null);
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

  async function moveReservePinWeb(reserve: any, plan: any, x: number, y: number) {
    if (!canEdit(profile) || !reserve?.id || !plan?.id) return false;
    const nextX = normalizePlanPercent(x);
    const nextY = normalizePlanPercent(y);
    if (nextX == null || nextY == null) return false;

    const history = [
      ...(Array.isArray(reserve.history) ? reserve.history : []),
      makeHistory('Épingle déplacée depuis le web', userLabel(profile, authUser)),
    ];
    const patch = {
      plan_id: plan.id,
      plan_x: nextX,
      plan_y: nextY,
      building: getPlanBuildingName(plan) || reserve.building || '',
      building_id: plan.building_id ?? plan.buildingId ?? reserve.building_id ?? reserve.buildingId ?? null,
      level: getPlanLevelName(plan) || reserve.level || '',
      level_id: plan.level_id ?? plan.levelId ?? reserve.level_id ?? reserve.levelId ?? null,
      history,
    };
    const previousReserve = data.reserves.find(item => item.id === reserve.id) ?? reserve;
    setError('');

    setData(prev => ({
      ...prev,
      reserves: prev.reserves.map(item => item.id === reserve.id ? { ...item, ...patch } : item),
    }));

    const { data: savedReserve, error: pinError } = await supabaseBrowser
      .from('reserves')
      .update(patch)
      .eq('id', reserve.id)
      .select('id, plan_id, plan_x, plan_y, building, building_id, level, level_id, history')
      .maybeSingle();
    if (pinError || !savedReserve) {
      setData(prev => ({
        ...prev,
        reserves: prev.reserves.map(item => item.id === reserve.id ? previousReserve : item),
      }));
      setError(pinError?.message ?? "Déplacement refusé : la réserve n'a pas été mise à jour côté serveur.");
      return false;
    }
    setData(prev => ({
      ...prev,
      reserves: prev.reserves.map(item => item.id === reserve.id ? { ...item, ...savedReserve } : item),
    }));
    return true;
  }

  async function updatePlanAnnotationsWeb(plan: any, annotations: WebPlanDrawing[]) {
    if (!canEdit(profile) || !plan?.id) return;
    setData(prev => ({
      ...prev,
      sitePlans: prev.sitePlans.map(item => item.id === plan.id ? { ...item, annotations } : item),
    }));
    const { error: annotationError } = await supabaseBrowser
      .from('site_plans')
      .update({ annotations })
      .eq('id', plan.id);
    if (annotationError) {
      setError(annotationError.message);
      if (authUser) await loadEverything(authUser);
    }
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
        annotations: normalizePhotoAnnotations(photo.annotations),
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
        annotations: normalizePhotoAnnotations(photo.annotations),
      });
      photoRows.push({
        id: photoId,
        comment: photo.kind === 'resolution' ? 'Photo de levée' : 'Photo de réserve',
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
          setError(`Réserve créée, mais upload photo impossible : ${photoError?.message ?? 'erreur inconnue'}`);
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

  async function updateVisitWeb(visit: any, patch: Record<string, any>) {
    if (!profile || !canEdit(profile) || !visit?.id) return;
    setSaving(true);
    setError('');
    const { data: updated, error: updateError } = await supabaseBrowser
      .from('visites')
      .update(patch)
      .eq('id', visit.id)
      .select()
      .single();
    if (updateError) {
      setError(updateError.message);
    } else {
      setData(prev => ({
        ...prev,
        visites: prev.visites.map(item => item.id === visit.id ? (updated ?? { ...item, ...patch }) : item),
      }));
    }
    setSaving(false);
  }

  async function attachReservesToVisitWeb(visit: any, reserveIds: string[]) {
    if (!profile || !canEdit(profile) || !visit?.id || reserveIds.length === 0) return;
    setSaving(true);
    setError('');
    let attachError: any = null;
    const rpcResult = await (supabaseBrowser as any).rpc('attach_reserves_to_visite', {
      p_visite_id: visit.id,
      p_reserve_ids: reserveIds,
    });
    attachError = rpcResult?.error ?? null;

    if (attachError) {
      const nextReserveIds = Array.from(new Set([...(visit.reserve_ids ?? []), ...reserveIds]));
      const [visitResult, reserveResult] = await Promise.all([
        supabaseBrowser.from('visites').update({ reserve_ids: nextReserveIds }).eq('id', visit.id),
        supabaseBrowser.from('reserves').update({ visite_id: visit.id }).in('id', reserveIds),
      ]);
      attachError = visitResult.error ?? reserveResult.error ?? null;
    }

    if (attachError) {
      setError(attachError.message ?? 'Impossible de rattacher ces réserves à la visite.');
    } else {
      setData(prev => ({
        ...prev,
        visites: prev.visites.map(item => item.id === visit.id
          ? { ...item, reserve_ids: Array.from(new Set([...(item.reserve_ids ?? []), ...reserveIds])) }
          : item),
        reserves: prev.reserves.map(item => reserveIds.includes(item.id) ? { ...item, visite_id: visit.id } : item),
      }));
    }
    setSaving(false);
  }

  async function deleteVisitWeb(visit: any) {
    if (!profile || !canEdit(profile) || !visit?.id) return;
    const confirmed = window.confirm(`Supprimer la visite "${visit.title}" ? Les réserves rattachées resteront disponibles dans l'onglet Réserves.`);
    if (!confirmed) return;
    setSaving(true);
    setError('');
    const linkedReserveIds = new Set([...(visit.reserve_ids ?? []), ...data.reserves.filter(reserve => reserve.visite_id === visit.id).map(reserve => reserve.id)]);
    const [reserveResult, deleteResult] = await Promise.all([
      linkedReserveIds.size
        ? supabaseBrowser.from('reserves').update({ visite_id: null }).in('id', Array.from(linkedReserveIds))
        : Promise.resolve({ error: null }),
      supabaseBrowser.from('visites').delete().eq('id', visit.id),
    ]);
    const deleteError = reserveResult.error ?? deleteResult.error;
    if (deleteError) {
      setError(deleteError.message ?? 'Suppression de la visite impossible.');
    } else {
      setData(prev => ({
        ...prev,
        visites: prev.visites.filter(item => item.id !== visit.id),
        reserves: prev.reserves.map(item => linkedReserveIds.has(item.id) ? { ...item, visite_id: null } : item),
      }));
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

  async function generateWebReport(type: 'global_reserves' | 'plans' | 'individual_reserve' | 'visit_report', options?: {
    visit?: any;
    reserve?: any;
    reserves?: any[];
    plans?: any[];
    companyFilter?: string | null;
    statusFilter?: string | null;
    language?: 'fr' | 'en' | 'es';
  }) {
    const selectedProjectName = projectName();
    const language = options?.language ?? reportLanguage;
    const reportKey = `${type}-${language}`;
    setGeneratingReport(reportKey);
    setError('');
    try {
      const targetReserve = options?.reserve ?? selectedReserve;
      const targetReserves = options?.reserves ?? filteredReserves;
      const targetPlans = options?.plans ?? projectScoped.plans;
      const reservePlanId = targetReserve?.plan_id ?? targetReserve?.planId;
      const reservePlan = reservePlanId ? projectScoped.plans.find((plan: any) => String(plan.id) === String(reservePlanId)) : null;
      const reserveCompanyName = targetReserve ? reserveCompanies(targetReserve)[0] : null;
      const reserveCompany = reserveCompanyName
        ? data.companies.find((company: any) => company.name === reserveCompanyName || company.id === targetReserve?.company_id || company.id === targetReserve?.companyId)
        : null;
      const planPins = reservePlanId
        ? projectScoped.reserves.filter((reserve: any) =>
            String(reserve.plan_id ?? reserve.planId ?? '') === String(reservePlanId) &&
            shouldNumberReserveOnPlan(reserve, targetReserve?.id) &&
            normalizePlanPercent(reserve.plan_x ?? reserve.planX) != null &&
            normalizePlanPercent(reserve.plan_y ?? reserve.planY) != null
          )
        : [];
      const planPinNumberMap = createPlanPinNumberMap(planPins);
      const pinNum = targetReserve ? planPinNumberMap.get(String(targetReserve.id)) : undefined;
      const reservePlanImageUri = type === 'individual_reserve' && reservePlan
        ? await getPlanImageForReserveReport(reservePlan)
        : null;
      const reportPlans = type === 'plans'
        ? await toPdfPlanItemsForReport(targetPlans, targetReserves)
        : targetPlans.map(toPdfPlanItem);
      const reportReserves = type === 'plans'
        ? await toPdfReserveItemsForPlanReport(targetReserves)
        : type === 'global_reserves'
          ? withPdfRemoteReservePhotoList(targetReserves, REPORT_MAX_PHOTOS_PER_RESERVE)
          : targetReserves;
      const reportReserve = type === 'individual_reserve' && targetReserve
        ? withPdfRemoteReservePhotos(targetReserve, INDIVIDUAL_RESERVE_MAX_PHOTOS)
        : targetReserve;
      const reportVisit = type === 'visit_report'
        ? await withPdfEmbeddedVisitMedia(options?.visit)
        : options?.visit;
      const payload = type === 'individual_reserve'
        ? {
            type,
            chantierName: selectedProjectName,
            reserve: reportReserve,
            companyColor: reserveCompany?.color ?? null,
            planUri: reservePlanImageUri,
            planName: reservePlan?.name ?? null,
            planX: normalizePlanPercent(reportReserve?.plan_x ?? reportReserve?.planX),
            planY: normalizePlanPercent(reportReserve?.plan_y ?? reportReserve?.planY),
            pinNum,
            language,
            generatedAt: new Date().toISOString(),
          }
        : type === 'visit_report'
          ? {
              type,
              chantierName: selectedProjectName,
              visit: reportVisit,
              reserves: projectScoped.reserves.filter((reserve: any) => {
                const visitReserveIds = reportVisit?.reserve_ids ?? [];
                return reserve.visite_id === reportVisit?.id || visitReserveIds.includes(reserve.id);
              }),
              companies: data.companies,
              language,
              generatedAt: new Date().toISOString(),
            }
        : {
            type,
            chantierName: selectedProjectName,
            reserves: reportReserves,
            plans: reportPlans,
            companyFilter: [options?.companyFilter, options?.statusFilter].filter(Boolean).join(' · ') || null,
            statusFilter: options?.statusFilter ?? null,
            language,
            generatedAt: new Date().toISOString(),
          };
      if (type === 'individual_reserve' && !targetReserve) {
        setError('Sélectionnez une réserve avant de générer sa fiche.');
        return;
      }
      if (type === 'global_reserves' && targetReserves.length === 0) {
        setError('Aucune réserve à exporter avec cette sélection.');
        return;
      }
      if (type === 'plans' && targetReserves.length === 0) {
        setError('Aucune réserve à exporter avec cette sélection.');
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
      const rawResult = await response.text();
      let result: any = {};
      try {
        result = rawResult ? JSON.parse(rawResult) : {};
      } catch {
        const rawPreview = rawResult.slice(0, 240);
        const isTooLarge = response.status === 413 || /request entity too large|payload too large/i.test(rawResult);
        throw new Error(isTooLarge
          ? 'Export PDF trop volumineux. Réduisez le périmètre ou filtrez par entreprise, puis réessayez.'
          : rawPreview || 'Réponse PDF invalide.');
      }
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? 'Génération PDF impossible.');
      }
      const filePart = selectedProjectName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'BuildTrack';
      const typePart = type === 'global_reserves' ? 'reserves' : type === 'plans' ? 'plans' : type === 'visit_report' ? 'visite' : 'reserve';
      const filename = `BuildTrack_${typePart}_${filePart}_${language}.pdf`;
      if (result.pdfBase64) {
        toBase64Download(result.pdfBase64, filename);
      } else if (result.printHtml) {
        printHtmlReport(result.printHtml, filename);
      } else {
        throw new Error('Génération PDF impossible.');
      }
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
    const visibleReserves = visibleReservesForProfile(data.reserves, profile, data.companies);
    const visibleReserveIds = new Set(visibleReserves.map((reserve: any) => String(reserve.id)));
    const reserves = visibleReserves.filter(byProject);
    const reserveIds = new Set(reserves.map((reserve: any) => String(reserve.id)));
    const photos = data.photos.filter(photo => {
      const reserveId = photo.reserve_id ?? photo.reserveId;
      if (profile?.role === 'sous_traitant') return reserveId && visibleReserveIds.has(String(reserveId));
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
      documents: profile?.role === 'sous_traitant' ? [] : data.documents.filter(byProject),
      photos,
      oprs: data.oprs.filter(byProject),
    };
  }, [data, selectedProjectId, profile]);

  const activeProjectForReserveFilters = data.chantiers.find((item: any) => item.id === selectedProjectId) ?? null;
  const reserveFilterPlansById = useMemo(
    () => new Map<string, any>(projectScoped.plans.map((plan: any) => [String(plan.id), plan] as [string, any])),
    [projectScoped.plans]
  );

  const reserveStructuredFilters = useMemo(() => {
    const active = projectScoped.reserves.filter(reserve => !isReserveArchived(reserve));
    const companies = Array.from(new Set(active.flatMap(reserve => reserveCompanies(reserve)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const buildings = Array.from(new Set(active
      .map(reserve => getReserveBuildingInfo(reserve, reserveFilterPlansById, activeProjectForReserveFilters))
      .filter(info => info.selectable)
      .map(info => info.name)
    )).sort((a, b) => a.localeCompare(b));
    return { companies, buildings };
  }, [projectScoped.reserves, reserveFilterPlansById, activeProjectForReserveFilters]);

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
      if (buildingFilter !== 'all') {
        const buildingInfo = getReserveBuildingInfo(r, reserveFilterPlansById, activeProjectForReserveFilters);
        if (!sameName(buildingInfo.name, buildingFilter)) return false;
      }
      if (pinFilter === 'pinned' && !r.plan_id) return false;
      if (pinFilter === 'unpinned' && r.plan_id) return false;
      if (!q) return true;
      const haystack = [
        r.id,
        r.title,
        r.description,
        getReserveBuildingInfo(r, reserveFilterPlansById, activeProjectForReserveFilters).name,
        r.level,
        r.zone,
        STATUS_LABELS[r.status] ?? r.status,
        PRIORITY_LABELS[r.priority] ?? r.priority,
        ...(reserveCompanies(r)),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [projectScoped.reserves, search, statusFilter, priorityFilter, companyFilter, buildingFilter, pinFilter, reserveFilterPlansById, activeProjectForReserveFilters]);

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
    <main className={`${styles.appShell} ${sidebarCollapsed ? styles.appShellCollapsed : ''} ${mobileNavOpen ? styles.appShellMobileNavOpen : ''}`}>
      {mobileNavOpen && (
        <button
          type="button"
          className={styles.mobileNavScrim}
          aria-label="Fermer le menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''} ${mobileNavOpen ? styles.sidebarMobileOpen : ''}`}>
        <div className={styles.sidebarBrandRow}>
          <div className={styles.sidebarBrand}>
            <span className={styles.brandMarkSmall}>B</span>
            <div>
              <strong>BuildTrack</strong>
              <span>Web</span>
            </div>
          </div>
          <button
            type="button"
            className={styles.mobileNavClose}
            aria-label="Fermer le menu"
            onClick={() => setMobileNavOpen(false)}
          >
            ×
          </button>
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
                  const navIsActive = activeTab === tab.id || (tab.id === 'terrain' && TERRAIN_CHILD_TABS.has(activeTab));
                  return (
                    <button
                      key={tab.id}
                      className={navIsActive ? styles.navActive : ''}
                      onClick={() => { setActiveTab(tab.id); setMobileNavOpen(false); }}
                      title={sidebarCollapsed ? tab.label : undefined}
                      aria-label={tab.label}
                    >
                      <span className={styles.navIcon}>
                        <SidebarNavIcon name={tab.icon} active={navIsActive} />
                      </span>
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

      <section className={`${styles.workspace} ${activeTab === 'plans' ? styles.workspacePlans : ''} ${activeTab === 'reserves' ? styles.workspaceReserves : ''} ${activeTab === 'visites' ? styles.workspaceVisites : ''}`}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.mobileNavBtn}
            aria-label="Ouvrir le menu"
            onClick={() => setMobileNavOpen(true)}
          >
            <span className={styles.mobileNavBtnIcon} aria-hidden="true" />
          </button>
          <div className={styles.topbarTitle}>
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
              <Dashboard
                stats={stats}
                data={data}
                scoped={projectScoped}
                profile={profile}
                authUser={authUser}
                selectedProjectId={selectedProjectId}
                canCreate={canEdit(profile)}
                setTab={setActiveTab}
                setSelectedProjectId={setSelectedProjectId}
                setBuildingFilter={setBuildingFilter}
                onCreateReserve={() => openReserveCreate()}
                onCreateVisit={openVisitCreate}
              />
            )}
            {activeTab === 'reserves' && (
              <ReservesView
                allReserves={projectScoped.reserves}
                reserves={filteredReserves}
                photos={projectScoped.photos}
                selectedReserveId={selectedReserveId}
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
                onGenerateReservesPdf={(reserves: any[], language: TextLang, companyFilter?: string | null) => generateWebReport('global_reserves', { reserves, language, companyFilter })}
                onGenerateReservePdf={(reserve: any, language: TextLang) => generateWebReport('individual_reserve', { reserve, language })}
                generatingReport={generatingReport}
                defaultReportLanguage={reportLanguage}
                canUseAssistant={isAdmin(profile)}
                editable={canEdit(profile)}
                saving={saving}
              />
            )}
            {activeTab === 'plans' && (
              <PlansView
                plans={projectScoped.plans}
                reserves={projectScoped.reserves}
                companies={data.companies}
                selectedPlan={selectedPlan}
                setSelectedPlanId={setSelectedPlanId}
                setSelectedReserveId={setSelectedReserveId}
                setTab={setActiveTab}
                onCreateReserve={(plan: any) => openReserveCreate({ plan })}
                onCreateReserveAtPin={(plan: any, pin: ReservePinDraft) => openReserveCreate({ plan, pin })}
                onMoveReservePin={moveReservePinWeb}
                onUpdatePlanAnnotations={updatePlanAnnotationsWeb}
                onGeneratePlansPdf={(plans: any[], reserves: any[], language: TextLang, companyFilter?: string | null, statusFilter?: string | null) =>
                  generateWebReport('plans', { plans, reserves, language, companyFilter, statusFilter })
                }
                generatingReport={generatingReport}
                defaultReportLanguage={reportLanguage}
                editable={canEdit(profile)}
              />
            )}
            {activeTab === 'visites' && (
              <VisitesView
                data={data}
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
                onAttachReserves={attachReservesToVisitWeb}
                onArchiveReserve={toggleArchive}
                onDeleteReserve={deleteReserveWeb}
                onUpdateVisit={updateVisitWeb}
                onDeleteVisit={deleteVisitWeb}
                onGenerateVisitReport={(visit: any, language: 'fr' | 'en' | 'es') => generateWebReport('visit_report', { visit, language })}
                generatingReport={generatingReport}
                restricted={profile?.role === 'sous_traitant'}
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
              <TerrainView
                scoped={projectScoped}
                data={data}
                profile={profile}
                setTab={setActiveTab}
              />
            )}
            {activeTab === 'incidents' && (
              <IncidentsView incidents={projectScoped.incidents} />
            )}
            {activeTab === 'opr' && (
              <OprView oprs={projectScoped.oprs} reserves={projectScoped.reserves} setTab={setActiveTab} setSelectedReserveId={setSelectedReserveId} />
            )}
            {activeTab === 'media' && (
              <MediaView photos={projectScoped.photos} documents={projectScoped.documents} isSubcontractor={profile?.role === 'sous_traitant'} />
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

function Dashboard({
  stats,
  data,
  scoped,
  profile,
  authUser,
  selectedProjectId,
  canCreate,
  setTab,
  setSelectedProjectId,
  setBuildingFilter,
  onCreateReserve,
  onCreateVisit,
}: any) {
  const activeReserves = scoped.reserves.filter((reserve: any) => !isReserveArchived(reserve));
  const openCount = activeReserves.filter((reserve: any) => reserve.status === 'open').length;
  const inProgressCount = activeReserves.filter((reserve: any) => reserve.status === 'in_progress').length;
  const waitingCount = activeReserves.filter((reserve: any) => reserve.status === 'waiting').length;
  const verificationCount = activeReserves.filter((reserve: any) => reserve.status === 'verification').length;
  const closedCount = activeReserves.filter((reserve: any) => reserve.status === 'closed').length;
  const totalCount = activeReserves.length;
  const progress = totalCount ? Math.round((closedCount / totalCount) * 100) : 0;
  const criticalReserves = activeReserves.filter((reserve: any) => reserve.priority === 'critical' && reserve.status !== 'closed');
  const overdueReserves = activeReserves.filter((reserve: any) => reserve.priority !== 'critical' && isReserveOverdue(reserve));
  const lateTasks = scoped.tasks.filter(isTaskLateWeb);
  const openIncidents = scoped.incidents.filter(isIncidentOpenWeb);
  const project = data.chantiers.find((item: any) => item.id === selectedProjectId) ?? null;
  const firstName = String(profile?.name ?? authUser?.email ?? 'BuildTrack').split(' ')[0];
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const plansById = new Map<string, any>(data.sitePlans.map((plan: any) => [String(plan.id), plan] as [string, any]));
  const openBuildingInReserves = (building: any, chantierId?: string) => {
    if (!building?.selectable) return;
    if (chantierId) setSelectedProjectId(chantierId);
    setBuildingFilter(building.name);
    setTab('reserves');
  };

  const weekStats = (() => {
    const now = new Date();
    const weeks = new Map<string, { label: string; created: number; closed: number }>();
    for (let i = 7; i >= 0; i -= 1) {
      const date = new Date(now);
      date.setDate(date.getDate() - (i * 7));
      weeks.set(getWeekKey(date), { label: getWeekLabel(date), created: 0, closed: 0 });
    }
    for (const reserve of activeReserves) {
      const created = getReserveCreatedDate(reserve);
      const closed = getReserveClosedDate(reserve);
      if (created) {
        const bucket = weeks.get(getWeekKey(created));
        if (bucket) bucket.created += 1;
      }
      if (closed) {
        const bucket = weeks.get(getWeekKey(closed));
        if (bucket) bucket.closed += 1;
      }
    }
    return Array.from(weeks.values());
  })();

  const companyStats = data.companies
    .map((company: any) => {
      const companyReserves = activeReserves.filter((reserve: any) => reserveCompanies(reserve).some(name => sameName(name, company.name)));
      const total = companyReserves.length;
      const closed = companyReserves.filter((reserve: any) => reserve.status === 'closed').length;
      const overdue = companyReserves.filter(isReserveOverdue).length;
      return {
        id: company.id,
        name: company.name,
        shortName: company.short_name ?? company.shortName ?? company.name,
        color: company.color ?? '#003082',
        total,
        closed,
        overdue,
        rate: total ? Math.round((closed / total) * 100) : 0,
        actualWorkers: Number(company.actual_workers ?? company.actualWorkers ?? 0),
        plannedWorkers: Number(company.planned_workers ?? company.plannedWorkers ?? 0),
      };
    })
    .filter((company: any) => company.total > 0 || company.actualWorkers > 0 || company.plannedWorkers > 0)
    .sort((a: any, b: any) => b.rate - a.rate);

  const pinnedReserves = activeReserves.filter(hasReservePlanPin);
  const companyPinPodium = data.companies
    .map((company: any) => {
      const companyReserves = activeReserves.filter((reserve: any) =>
        reserveCompanies(reserve).some(name => sameName(name, company.name))
      );
      const pinned = companyReserves.filter(hasReservePlanPin).length;
      return {
        id: company.id,
        name: company.name,
        shortName: company.short_name ?? company.shortName ?? company.name,
        color: company.color ?? '#003082',
        total: companyReserves.length,
        pinned,
      };
    })
    .filter((company: any) => company.pinned > 0)
    .sort((a: any, b: any) => b.pinned - a.pinned || String(a.name).localeCompare(String(b.name)))
    .slice(0, 5);

  const totalActualWorkers = companyStats.reduce((sum: number, company: any) => sum + company.actualWorkers, 0);
  const totalPlannedWorkers = companyStats.reduce((sum: number, company: any) => sum + company.plannedWorkers, 0);
  const projectCards = selectedProjectId === 'all'
    ? data.chantiers.map((chantier: any) => {
      const reserves = data.reserves.filter((reserve: any) => getChantierId(reserve) === chantier.id && !isReserveArchived(reserve));
      const closed = reserves.filter((reserve: any) => reserve.status === 'closed').length;
      const buildings = buildReserveBuildingBreakdown(reserves, plansById, chantier);
      return {
        id: chantier.id,
        name: chantier.name,
        total: reserves.length,
        progress: reserves.length ? Math.round((closed / reserves.length) * 100) : 0,
        overdue: reserves.filter(isReserveOverdue).length,
        buildings,
      };
    })
    : [];
  const buildingBreakdown = buildReserveBuildingBreakdown(activeReserves, plansById, project);

  return (
    <div className={styles.dashboardStack}>
      <section className={styles.dashboardHero}>
        <div className={styles.dashboardGreeting}>
          <div className={styles.dashboardLogo}>B</div>
          <div>
            <p className={styles.eyebrow}>Dashboard</p>
            <h2>Bonjour, {firstName}</h2>
            <span>{today}</span>
          </div>
        </div>
        <div className={styles.dashboardHeroActions}>
          <div className={styles.dashboardProjectPill}>
            <span />
            {project?.name ?? (selectedProjectId === 'all' ? 'Tous les chantiers' : 'Chantier')}
          </div>
          {canCreate && (
            <div className={styles.dashboardQuickActions}>
              <button type="button" onClick={onCreateReserve}>Nouvelle réserve</button>
              <button type="button" onClick={onCreateVisit}>Nouvelle visite</button>
            </div>
          )}
        </div>
      </section>

      {projectCards.length > 1 && (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Vue portefeuille</h2>
              <p>Synthèse multi-chantiers comme le mode portefeuille mobile.</p>
            </div>
          </div>
          <div className={styles.dashboardProjectGrid}>
            {projectCards.map((chantier: any) => (
              <article key={chantier.id} className={styles.dashboardProjectCard}>
                <strong>{chantier.name}</strong>
                <span>{chantier.total} réserves · {chantier.overdue} en retard</span>
                <div className={styles.dashboardProgressTrack}>
                  <i style={{ width: `${chantier.progress}%` }} />
                </div>
                <em>{chantier.progress}%</em>
                {chantier.buildings.length ? (
                  <div className={styles.dashboardProjectBuildings}>
                    {chantier.buildings.slice(0, 4).map((building: any) => (
                      <button
                        key={building.key}
                        type="button"
                        disabled={!building.selectable}
                        onClick={() => openBuildingInReserves(building, chantier.id)}
                      >
                        <span>{building.name}</span>
                        <strong>{building.total}</strong>
                      </button>
                    ))}
                    {chantier.buildings.length > 4 && (
                      <small>+{chantier.buildings.length - 4} bâtiment{chantier.buildings.length - 4 > 1 ? 's' : ''}</small>
                    )}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      )}

      <div className={styles.dashboardKpiGrid}>
        <DashboardKpi title="Total réserves" value={totalCount} hint="Toutes les réserves actives" tone="blue" icon="☷" onClick={() => setTab('reserves')} />
        <DashboardKpi title="Actives" value={openCount + inProgressCount} hint={`${openCount} ouvertes · ${inProgressCount} en cours`} tone="amber" icon="!" onClick={() => setTab('reserves')} />
        <DashboardKpi title="Critiques" value={criticalReserves.length} hint="Priorité critique non clôturée" tone="red" icon="△" onClick={() => setTab('reserves')} />
        <DashboardKpi title="Clôturées" value={closedCount} hint={`${progress}% d’avancement`} tone="green" icon="✓" onClick={() => setTab('reserves')} />
      </div>

      <div className={styles.dashboardWideGrid}>
        <button type="button" className={`${styles.dashboardWideMetric} ${lateTasks.length ? styles.dashboardWideAmber : styles.dashboardWideGreen}`} onClick={() => setTab('planning')}>
          <span>◷</span>
          <strong>{lateTasks.length}</strong>
          <small>{lateTasks.length ? `${lateTasks.length} tâche${lateTasks.length > 1 ? 's' : ''} en retard` : 'Aucune tâche en retard'}</small>
          <em>Planning</em>
        </button>
        <button type="button" className={`${styles.dashboardWideMetric} ${openIncidents.length ? styles.dashboardWideRed : styles.dashboardWideGreen}`} onClick={() => setTab('terrain')}>
          <span>◇</span>
          <strong>{openIncidents.length}</strong>
          <small>{openIncidents.length ? `${openIncidents.length} incident${openIncidents.length > 1 ? 's' : ''} ouvert${openIncidents.length > 1 ? 's' : ''}` : 'Aucun incident ouvert'}</small>
          <em>Terrain</em>
        </button>
      </div>

      {totalCount > 0 && (
        <section className={styles.panel}>
          <div className={styles.dashboardProgressHeader}>
            <div>
              <h2>Avancement global</h2>
              <p>{closedCount} levée{closedCount > 1 ? 's' : ''} sur {totalCount} réserve{totalCount > 1 ? 's' : ''}.</p>
            </div>
            <strong>{progress}%</strong>
          </div>
          <div className={styles.dashboardProgressTrack}>
            <i style={{ width: `${progress}%` }} />
          </div>
        </section>
      )}

      {(criticalReserves.length > 0 || overdueReserves.length > 0 || lateTasks.length > 0) && (
        <section className={styles.dashboardSectionBlock}>
          <div className={styles.dashboardSectionHeader}>
            <div>
              <p className={styles.eyebrow}>Priorités d’action</p>
              <h2>À traiter maintenant</h2>
            </div>
            <span>{criticalReserves.length + overdueReserves.length + lateTasks.length} alerte{criticalReserves.length + overdueReserves.length + lateTasks.length > 1 ? 's' : ''}</span>
          </div>
          <div className={styles.dashboardAlertGrid}>
            {criticalReserves.length > 0 && (
              <DashboardAlertList
                title="Alertes critiques"
                tone="red"
                items={criticalReserves}
                empty="Aucune réserve critique."
                getTitle={(item: any) => item.title}
                getMeta={(item: any) => [item.building, item.deadline ? `Échéance ${prettyDate(item.deadline)}` : null].filter(Boolean).join(' · ')}
                onOpen={() => setTab('reserves')}
              />
            )}
            {overdueReserves.length > 0 && (
              <DashboardAlertList
                title="Réserves en retard"
                tone="amber"
                items={overdueReserves}
                empty="Aucune réserve non critique en retard."
                getTitle={(item: any) => item.title}
                getMeta={(item: any) => [item.building, PRIORITY_LABELS[item.priority] ?? item.priority, item.deadline ? `Échéance ${prettyDate(item.deadline)}` : null].filter(Boolean).join(' · ')}
                onOpen={() => setTab('reserves')}
              />
            )}
            {lateTasks.length > 0 && (
              <DashboardAlertList
                title="Tâches en retard"
                tone="amber"
                items={lateTasks}
                empty="Aucune tâche en retard."
                getTitle={(item: any) => item.title}
                getMeta={(item: any) => [item.company, item.deadline ? `Échéance ${prettyDate(item.deadline)}` : null].filter(Boolean).join(' · ')}
                onOpen={() => setTab('planning')}
              />
            )}
          </div>
        </section>
      )}

      {totalCount > 0 && (
        <section className={styles.dashboardSectionBlock}>
          <div className={styles.dashboardSectionHeader}>
            <div>
              <p className={styles.eyebrow}>Suivi chantier</p>
              <h2>Réserves et localisation</h2>
            </div>
            <span>{pinnedReserves.length} réserve{pinnedReserves.length > 1 ? 's' : ''} épinglée{pinnedReserves.length > 1 ? 's' : ''}</span>
          </div>
          <div className={styles.dashboardReserveColumns}>
            <div className={styles.dashboardReserveSummaryStack}>
              <section className={styles.panel}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Répartition des réserves</h2>
                    <p>Lecture par statut avant d’aller dans le détail.</p>
                  </div>
                </div>
                <div className={styles.dashboardStatusList}>
                  <DashboardStatusBar label="Ouvert" count={openCount} total={totalCount} tone="amber" />
                  <DashboardStatusBar label="En cours" count={inProgressCount} total={totalCount} tone="blue" />
                  <DashboardStatusBar label="En attente" count={waitingCount} total={totalCount} tone="amber" />
                  <DashboardStatusBar label="Vérification" count={verificationCount} total={totalCount} tone="purple" />
                  <DashboardStatusBar label="Clôturé" count={closedCount} total={totalCount} tone="green" />
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Podium des épingles</h2>
                    <p>Entreprises avec le plus de réserves localisées sur plan.</p>
                  </div>
                  <span className={styles.dashboardPinTotal}>{pinnedReserves.length} épinglées</span>
                </div>
                {companyPinPodium.length ? (
                  <div className={styles.dashboardPinPodiumList}>
                    {companyPinPodium.map((company: any, index: number) => (
                      <div key={company.id ?? company.name} className={styles.dashboardPinPodiumRow}>
                        <span className={styles.dashboardPinPodiumRank}>{index + 1}</span>
                        <i className={styles.dashboardPinPodiumDot} style={{ background: company.color }} />
                        <div>
                          <strong>{company.shortName}</strong>
                          <small>{company.pinned} / {company.total} réserves épinglées</small>
                        </div>
                        <em>{company.pinned}</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>Aucune réserve épinglée par entreprise.</p>
                )}
              </section>
            </div>

            <section className={`${styles.panel} ${styles.dashboardBuildingBreakdownPanel}`}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2>Répartition par bâtiment</h2>
                  <p>Où se concentrent les réserves et les épingles du chantier.</p>
                </div>
                <span className={styles.dashboardPinTotal}>{buildingBreakdown.length} bâtiment{buildingBreakdown.length > 1 ? 's' : ''}</span>
              </div>
              {buildingBreakdown.length ? (
                <div className={styles.dashboardBuildingBreakdownList}>
                  {buildingBreakdown.slice(0, 10).map((building: any) => {
                    const width = totalCount ? Math.max(5, Math.round((building.total / totalCount) * 100)) : 0;
                    return (
                      <button
                        key={building.key}
                        type="button"
                        disabled={!building.selectable}
                        className={styles.dashboardBuildingBreakdownRow}
                        onClick={() => openBuildingInReserves(building)}
                      >
                        <span className={styles.dashboardBuildingBreakdownMain}>
                          <strong>{building.name}</strong>
                          <small>{building.pinned} épinglée{building.pinned > 1 ? 's' : ''} · {building.overdue} retard</small>
                        </span>
                        <span className={styles.dashboardBuildingBreakdownMeta}>
                          <b>{building.total}</b>
                          <i><em style={{ width: `${width}%` }} /></i>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.empty}>Aucun bâtiment à afficher.</p>
              )}
            </section>
          </div>
        </section>
      )}

      {totalCount > 0 && (
        <section className={styles.dashboardSectionBlock}>
          <div className={styles.dashboardSectionHeader}>
            <div>
              <p className={styles.eyebrow}>Pilotage entreprises</p>
              <h2>Présence et performance</h2>
            </div>
          </div>
          <div className={styles.dashboardTwoColumns}>
            <section className={styles.panel}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2>Personnel aujourd’hui</h2>
                  <p>{totalActualWorkers} présent{totalActualWorkers > 1 ? 's' : ''} / {totalPlannedWorkers} planifié{totalPlannedWorkers > 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className={styles.dashboardCompanyList}>
                {companyStats.slice(0, 8).map((company: any) => {
                  const percent = company.plannedWorkers ? Math.min(100, Math.round((company.actualWorkers / company.plannedWorkers) * 100)) : 0;
                  return (
                    <div key={company.id} className={styles.dashboardCompanyRow}>
                      <span style={{ background: company.color }} />
                      <strong>{company.shortName}</strong>
                      <div><i style={{ width: `${percent}%`, background: company.color }} /></div>
                      <em>{company.actualWorkers}/{company.plannedWorkers}</em>
                    </div>
                  );
                })}
                {!companyStats.length && <p className={styles.empty}>Aucune entreprise active aujourd’hui.</p>}
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2>Entreprises</h2>
                  <p>Taux de clôture et retards par entreprise.</p>
                </div>
              </div>
              <div className={styles.dashboardCompanyClosureList}>
                {companyStats.filter((company: any) => company.total > 0).slice(0, 8).map((company: any) => (
                  <div key={company.id} className={styles.dashboardCompanyClosureRow}>
                    <span style={{ background: company.color }} />
                    <strong>{company.name}</strong>
                    <div><i style={{ width: `${company.rate}%`, background: company.rate >= 70 ? '#16a34a' : company.rate >= 40 ? '#003082' : '#f59e0b' }} /></div>
                    <em>{company.rate}%</em>
                    {company.overdue > 0 ? <small>{company.overdue} retard</small> : null}
                  </div>
                ))}
                {!companyStats.some((company: any) => company.total > 0) && <p className={styles.empty}>Aucune donnée entreprise.</p>}
              </div>
            </section>
          </div>
        </section>
      )}

      {totalCount > 0 && (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Tendance chantier</h2>
              <p>Réserves créées et clôturées sur les 8 dernières semaines.</p>
            </div>
          </div>
          <DashboardWeekTrend weeks={weekStats} />
        </section>
      )}

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Accès rapide</h2>
            <p>Les mêmes entrées de pilotage que sur mobile, adaptées au cockpit web.</p>
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

function DashboardKpi({ title, value, hint, tone, icon, onClick }: { title: string; value: number | string; hint: string; tone: string; icon: string; onClick: () => void }) {
  return (
    <button type="button" className={`${styles.dashboardKpi} ${styles[`dashboardTone_${tone}`] ?? ''}`} onClick={onClick}>
      <span>{icon}</span>
      <strong>{value}</strong>
      <em>{title}</em>
      <small>{hint}</small>
    </button>
  );
}

function DashboardStatusBar({ label, count, total, tone }: { label: string; count: number; total: number; tone: string }) {
  const width = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`${styles.dashboardStatusRow} ${styles[`dashboardTone_${tone}`] ?? ''}`}>
      <span />
      <strong>{label}</strong>
      <div><i style={{ width: `${width}%` }} /></div>
      <em>{count}</em>
    </div>
  );
}

function DashboardWeekTrend({ weeks }: { weeks: Array<{ label: string; created: number; closed: number }> }) {
  const max = Math.max(...weeks.map(week => Math.max(week.created, week.closed)), 1);
  return (
    <div className={styles.dashboardChart}>
      <div className={styles.dashboardChartLegend}>
        <span><i /> Créées</span>
        <span><i /> Clôturées</span>
      </div>
      <div className={styles.dashboardBars}>
        {weeks.map((week) => (
          <div key={week.label} className={styles.dashboardBarGroup}>
            <div>
              <i style={{ height: `${Math.max(4, (week.created / max) * 100)}%` }} />
              <b style={{ height: `${Math.max(4, (week.closed / max) * 100)}%` }} />
            </div>
            <span>{week.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardAlertList({ title, tone, items, empty, getTitle, getMeta, onOpen }: any) {
  return (
    <section className={`${styles.dashboardAlertCard} ${styles[`dashboardAlert_${tone}`] ?? ''}`}>
      <div className={styles.dashboardAlertHeader}>
        <strong>{title}</strong>
        <span>{items.length}</span>
      </div>
      {items.length ? items.slice(0, 5).map((item: any) => (
        <button key={item.id} type="button" onClick={onOpen}>
          <i />
          <span>
            <strong>{getTitle(item)}</strong>
            <small>{getMeta(item)}</small>
          </span>
          <em>›</em>
        </button>
      )) : <p>{empty}</p>}
    </section>
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
  selectedReserveId: string | null;
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
  onGenerateReservesPdf: (reserves: any[], language: TextLang, companyFilter?: string | null) => Promise<void> | void;
  onGenerateReservePdf: (reserve: any, language: TextLang) => Promise<void> | void;
  generatingReport: string | null;
  defaultReportLanguage: TextLang;
  canUseAssistant: boolean;
  editable: boolean;
  saving: boolean;
}) {
  const { allReserves, reserves, selectedReserve } = props;
  const isCompactReserveView = useMediaQuery('(max-width: 1180px)');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [assistantLanguage, setAssistantLanguage] = useState<TextLang>('fr');
  const [pdfLanguage, setPdfLanguage] = useState<TextLang>(props.defaultReportLanguage);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfMode, setPdfMode] = useState<'view' | 'selected' | 'company' | 'company_multi' | 'no_company'>('view');
  const [pdfCompany, setPdfCompany] = useState('');
  const [pdfCompaniesMulti, setPdfCompaniesMulti] = useState<Set<string>>(new Set());
  const [assistantScope, setAssistantScope] = useState<'view' | 'project' | 'selected'>('view');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [assistantVisible, setAssistantVisible] = useState(false);
  const activeReserves = allReserves.filter(reserve => !isReserveArchived(reserve));
  const explicitlySelectedReserve = props.selectedReserveId
    ? allReserves.find(reserve => reserve.id === props.selectedReserveId) ?? null
    : null;
  const mobileDetailReserve = mobileDetailOpen ? explicitlySelectedReserve : null;
  const showMobileReserveDetail = isCompactReserveView && !!mobileDetailReserve;
  const detailReserve = showMobileReserveDetail ? mobileDetailReserve : selectedReserve;
  const selectedAssistantReserves = selectedReserve ? [selectedReserve] : [];
  const assistantTargets =
    assistantScope === 'project'
      ? activeReserves
      : assistantScope === 'selected'
        ? selectedAssistantReserves
        : reserves;
  const assistantMissingDescriptionReserves = assistantTargets.filter(reserve => reserve.title?.trim() && isReserveDescriptionMissing(reserve.description));
  const assistantMissingDescriptionCount = assistantMissingDescriptionReserves.length;
  const assistantTranslationCandidates = assistantTargets.filter(reserve => (
    reserve.title?.trim() ||
    (!isReserveDescriptionMissing(reserve.description) && `${reserve.description ?? ''}`.trim()) ||
    (reserve.comments ?? []).some((comment: any) => comment?.content?.trim())
  ));
  const selectedAssistantLanguage = TEXT_LANG_OPTIONS.find(option => option.value === assistantLanguage) ?? TEXT_LANG_OPTIONS[0];
  const assistantScopeOptions = [
    { key: 'view', label: 'Vue actuelle', hint: 'Filtres visibles', count: reserves.length },
    { key: 'project', label: 'Tout le chantier', hint: 'Réserves actives', count: activeReserves.length },
    { key: 'selected', label: 'Réserve ouverte', hint: selectedReserve?.id ?? 'Aucune réserve', count: selectedReserve ? 1 : 0 },
  ] as const;
  const advancedFilterActive =
    props.priorityFilter !== 'all' ||
    props.companyFilter !== 'all' ||
    props.buildingFilter !== 'all' ||
    props.pinFilter !== 'all';
  const selectedPhotos = reservePhotoItems(detailReserve, props.photos);
  const selectedLocalOnlyPhotos = localOnlyPhotoCount(detailReserve, props.photos);
  const pdfCompanies = props.structuredFilters.companies;
  const pdfTargetReserves = useMemo(() => {
    if (pdfMode === 'selected') return selectedReserve ? [selectedReserve] : [];
    if (pdfMode === 'company') {
      if (!pdfCompany) return [];
      return reserves.filter(reserve => reserveCompanies(reserve).includes(pdfCompany));
    }
    if (pdfMode === 'company_multi') {
      if (pdfCompaniesMulti.size === 0) return [];
      return reserves.filter(reserve => reserveCompanies(reserve).some(company => pdfCompaniesMulti.has(company)));
    }
    if (pdfMode === 'no_company') {
      return reserves.filter(reserve => reserveCompanies(reserve).length === 0);
    }
    return reserves;
  }, [pdfCompaniesMulti, pdfCompany, pdfMode, reserves, selectedReserve]);
  const pdfCompanyPreviewCount = pdfCompany ? reserves.filter(reserve => reserveCompanies(reserve).includes(pdfCompany)).length : 0;
  const pdfCompaniesMultiPreviewCount = pdfCompaniesMulti.size
    ? reserves.filter(reserve => reserveCompanies(reserve).some(company => pdfCompaniesMulti.has(company))).length
    : 0;
  const pdfScopeLabel =
    pdfMode === 'selected'
      ? selectedReserve?.id ?? 'Aucune réserve'
      : pdfMode === 'company'
        ? pdfCompany || 'Entreprise à choisir'
        : pdfMode === 'company_multi'
          ? `${pdfCompaniesMulti.size} entreprises`
        : pdfMode === 'no_company'
          ? 'Sans entreprise'
          : 'Vue actuelle';
  const pdfBusy =
    props.generatingReport === `global_reserves-${pdfLanguage}` ||
    props.generatingReport === `individual_reserve-${pdfLanguage}`;
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

  useEffect(() => {
    setPdfLanguage(props.defaultReportLanguage);
  }, [props.defaultReportLanguage]);

  useEffect(() => {
    if (!isCompactReserveView) setMobileDetailOpen(false);
  }, [isCompactReserveView]);

  useEffect(() => {
    if (mobileDetailOpen && (!explicitlySelectedReserve || !reserves.some(reserve => reserve.id === explicitlySelectedReserve.id))) {
      setMobileDetailOpen(false);
    }
  }, [explicitlySelectedReserve, mobileDetailOpen, reserves]);

  function openReserveFromList(reserve: any) {
    props.setSelectedReserveId(reserve.id);
    if (isCompactReserveView) {
      setMobileDetailOpen(true);
      setCommentText('');
    }
  }

  async function handleReservePdfExport() {
    if (pdfBusy || pdfTargetReserves.length === 0) return;
    if (pdfMode === 'selected' && selectedReserve) {
      await props.onGenerateReservePdf(selectedReserve, pdfLanguage);
      return;
    }
    await props.onGenerateReservesPdf(
      pdfTargetReserves,
      pdfLanguage,
      pdfMode === 'company'
        ? pdfCompany
        : pdfMode === 'company_multi'
          ? `${pdfCompaniesMulti.size} entreprises`
          : pdfMode === 'no_company'
            ? 'Sans entreprise'
            : null,
    );
  }

  return (
    <div className={`${styles.reservesLayout} ${showMobileReserveDetail ? styles.reservesLayoutMobileDetail : ''}`}>
      {!showMobileReserveDetail && (
      <section className={`${styles.panel} ${styles.reservesListPanel}`}>
        <div className={styles.reservePanelHeader}>
          <div>
            <p className={styles.eyebrow}>Suivi chantier</p>
            <h2>Réserves</h2>
          </div>
          <div className={styles.reservePanelActions}>
            <button
              type="button"
              className={styles.reservePdfOpenButton}
              onClick={() => setPdfModalOpen(true)}
              disabled={reserves.length === 0 && !selectedReserve}
            >
              PDF
            </button>
            {props.canUseAssistant && activeReserves.length > 0 && (
              <button type="button" className={styles.reserveAssistantOpenButton} onClick={() => setAssistantVisible(true)}>
                <span>Assistant</span>
                {assistantMissingDescriptionCount > 0 && <em>{assistantMissingDescriptionCount > 9 ? '9+' : assistantMissingDescriptionCount}</em>}
              </button>
            )}
            {props.editable && <button type="button" className={styles.reserveCreateButton} onClick={props.onCreate}>Créer</button>}
          </div>
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
        <div className={styles.reserveList}>
          {reserves.map(reserve => (
            <button
              key={reserve.id}
              className={`${styles.reserveRow} ${selectedReserve?.id === reserve.id ? styles.reserveRowActive : ''}`}
              onClick={() => openReserveFromList(reserve)}
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
      )}

      {props.canUseAssistant && assistantVisible && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          onMouseDown={() => {
            if (!props.saving) setAssistantVisible(false);
          }}
        >
          <section className={`${styles.modalPanel} ${styles.reserveAssistantModalWeb}`} onMouseDown={event => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.reserveAssistantHeaderWeb}>
                <div className={styles.reserveAssistantHeaderIconWeb}>✦</div>
                <div>
                  <p className={styles.eyebrow}>Assistant réserves</p>
                  <h2>Assistant réserves</h2>
                  <span>Complétez les descriptions et traduisez les textes comme sur mobile.</span>
                </div>
              </div>
              <button type="button" onClick={() => setAssistantVisible(false)} disabled={props.saving}>Fermer</button>
            </div>
            <div className={styles.reserveAssistantModalBodyWeb}>
              <section className={styles.reserveAssistantSectionWeb}>
                <strong>Périmètre</strong>
                <div className={styles.reserveAssistantScopeGridWeb}>
                  {assistantScopeOptions.map(option => {
                    const active = assistantScope === option.key;
                    const disabled = option.key === 'selected' && !selectedReserve;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={active ? styles.reserveAssistantScopeActiveWeb : ''}
                        disabled={props.saving || disabled}
                        onClick={() => setAssistantScope(option.key)}
                      >
                        <span>{option.label}</span>
                        <small>{option.hint}</small>
                        <em>{option.count}</em>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className={styles.reserveAssistantActionCardWeb}>
                <div className={styles.reserveAssistantActionHeaderWeb}>
                  <span>□</span>
                  <div>
                    <strong>Compléter les descriptions</strong>
                    <small>Copie le titre dans les réserves sans description.</small>
                  </div>
                </div>
                {assistantMissingDescriptionReserves.length > 0 ? (
                  <div className={styles.reserveAssistantPreviewWeb}>
                    {assistantMissingDescriptionReserves.slice(0, 3).map(reserve => (
                      <div key={reserve.id}>
                        <strong>{reserve.id}</strong>
                        <span>{reserve.title}</span>
                      </div>
                    ))}
                    {assistantMissingDescriptionReserves.length > 3 && (
                      <small>+ {assistantMissingDescriptionReserves.length - 3} autres réserves</small>
                    )}
                  </div>
                ) : (
                  <p className={styles.reserveAssistantEmptyWeb}>Aucune description à compléter dans ce périmètre.</p>
                )}
                <button
                  type="button"
                  className={styles.reserveAssistantPrimaryWeb}
                  disabled={props.saving || assistantMissingDescriptionCount === 0}
                  onClick={() => props.onFillDescriptions(assistantTargets)}
                >
                  Copier les titres
                </button>
              </section>

              <section className={styles.reserveAssistantActionCardWeb}>
                <div className={styles.reserveAssistantActionHeaderWeb}>
                  <span>文</span>
                  <div>
                    <strong>Traduire champs de texte</strong>
                    <small>Titres, descriptions et commentaires seront remplacés par la traduction Azure.</small>
                  </div>
                </div>
                <div className={styles.reserveAssistantLangRowWeb}>
                  {TEXT_LANG_OPTIONS.map(option => {
                    const active = assistantLanguage === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={active ? styles.reserveAssistantLangActiveWeb : ''}
                        disabled={props.saving}
                        onClick={() => setAssistantLanguage(option.value)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {assistantTranslationCandidates.length > 0 ? (
                  <div className={styles.reserveAssistantPreviewWeb}>
                    <small>{assistantTranslationCandidates.length} réserve{assistantTranslationCandidates.length > 1 ? 's' : ''} avec texte à traduire</small>
                    {assistantTranslationCandidates.slice(0, 3).map(reserve => (
                      <div key={reserve.id}>
                        <strong>{reserve.id}</strong>
                        <span>{reserve.title}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.reserveAssistantEmptyWeb}>Aucun champ texte à traduire dans ce périmètre.</p>
                )}
                <button
                  type="button"
                  className={`${styles.reserveAssistantPrimaryWeb} ${styles.reserveAssistantTranslateButtonWeb}`}
                  disabled={props.saving || assistantTranslationCandidates.length === 0}
                  onClick={() => props.onTranslateReserves(assistantTargets, assistantLanguage)}
                >
                  Traduire en {selectedAssistantLanguage.label}
                </button>
              </section>

              {props.saving && (
                <div className={styles.reserveAssistantProgressWeb}>
                  <strong>Traitement en cours...</strong>
                  <span>Gardez cette fenêtre ouverte pendant l’opération.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {pdfModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          onMouseDown={() => {
            if (!pdfBusy) setPdfModalOpen(false);
          }}
        >
          <section className={`${styles.modalPanel} ${styles.reservePdfModalWeb}`} onMouseDown={event => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Export PDF</p>
                <h2>Réserves</h2>
                <span>Générez une fiche individuelle ou un rapport global comme sur mobile.</span>
              </div>
              <button type="button" onClick={() => setPdfModalOpen(false)} disabled={pdfBusy}>Fermer</button>
            </div>
            <div className={styles.reservePdfBodyWeb}>
              <section className={styles.reservePdfSectionWeb}>
                <strong>Périmètre</strong>
                <div className={styles.reservePdfScopeGridWeb}>
                  {[
                    { key: 'view' as const, label: 'Vue actuelle', hint: 'Filtres actifs', count: reserves.length },
                    { key: 'selected' as const, label: 'Fiche réserve', hint: selectedReserve?.id ?? 'Aucune réserve', count: selectedReserve ? 1 : 0 },
                    { key: 'company' as const, label: 'Entreprise', hint: pdfCompany || 'À choisir', count: pdfCompanyPreviewCount },
                    { key: 'company_multi' as const, label: 'Plusieurs', hint: `${pdfCompaniesMulti.size} sélectionnée${pdfCompaniesMulti.size > 1 ? 's' : ''}`, count: pdfCompaniesMultiPreviewCount },
                    { key: 'no_company' as const, label: 'Sans entreprise', hint: 'Réserves non assignées', count: pdfMode === 'no_company' ? pdfTargetReserves.length : reserves.filter(reserve => reserveCompanies(reserve).length === 0).length },
                  ].map(option => {
                    const active = pdfMode === option.key;
                    const disabled = option.key === 'selected'
                      ? !selectedReserve
                      : option.key === 'company' || option.key === 'company_multi'
                        ? pdfCompanies.length === 0
                        : false;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={active ? styles.reservePdfScopeActiveWeb : ''}
                        disabled={disabled || pdfBusy}
                        onClick={() => {
                          setPdfMode(option.key);
                          if (option.key === 'company' && !pdfCompany) setPdfCompany(pdfCompanies[0] ?? '');
                          if (option.key === 'company_multi' && pdfCompaniesMulti.size === 0 && pdfCompanies[0]) {
                            setPdfCompaniesMulti(new Set([pdfCompanies[0]]));
                          }
                        }}
                      >
                        <span>{option.label}</span>
                        <small>{option.hint}</small>
                        <em>{option.count}</em>
                      </button>
                    );
                  })}
                </div>
              </section>

              {pdfMode === 'company' && (
                <section className={styles.reservePdfSectionWeb}>
                  <strong>Entreprise</strong>
                  <select value={pdfCompany} onChange={event => setPdfCompany(event.target.value)} disabled={pdfBusy}>
                    <option value="">Choisir une entreprise</option>
                    {pdfCompanies.map(company => (
                      <option key={company} value={company}>{company}</option>
                    ))}
                  </select>
                </section>
              )}

              {pdfMode === 'company_multi' && (
                <section className={styles.reservePdfSectionWeb}>
                  <div className={styles.reservePdfSectionHeaderWeb}>
                    <strong>Entreprises</strong>
                    <div>
                      <button type="button" onClick={() => setPdfCompaniesMulti(new Set(pdfCompanies))} disabled={pdfBusy}>Tout</button>
                      <button type="button" onClick={() => setPdfCompaniesMulti(new Set())} disabled={pdfBusy}>Effacer</button>
                    </div>
                  </div>
                  <div className={styles.reservePdfCompanyGridWeb}>
                    {pdfCompanies.map(company => {
                      const checked = pdfCompaniesMulti.has(company);
                      const count = reserves.filter(reserve => reserveCompanies(reserve).includes(company)).length;
                      return (
                        <button
                          key={company}
                          type="button"
                          className={checked ? styles.reservePdfCompanyActiveWeb : ''}
                          disabled={pdfBusy}
                          onClick={() => {
                            setPdfCompaniesMulti(prev => {
                              const next = new Set(prev);
                              if (next.has(company)) next.delete(company);
                              else next.add(company);
                              return next;
                            });
                          }}
                        >
                          <span>{checked ? '✓' : ''}</span>
                          <strong>{company}</strong>
                          <em>{count}</em>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className={styles.reservePdfSectionWeb}>
                <strong>Langue du PDF</strong>
                <div className={styles.reservePdfLangRowWeb}>
                  {TEXT_LANG_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={pdfLanguage === option.value ? styles.reservePdfLangActiveWeb : ''}
                      disabled={pdfBusy}
                      onClick={() => setPdfLanguage(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <div className={styles.reservePdfPreviewWeb}>
                <div>
                  <strong>{pdfTargetReserves.length}</strong>
                  <span>{pdfMode === 'selected' ? 'fiche individuelle' : 'réserves dans le rapport'}</span>
                </div>
                <small>{pdfScopeLabel} · {pdfLanguage.toUpperCase()}</small>
              </div>

              <div className={styles.reservePdfActionsWeb}>
                <button type="button" onClick={() => setPdfModalOpen(false)} disabled={pdfBusy}>Annuler</button>
                <button
                  type="button"
                  className={styles.reservePdfPrimaryWeb}
                  disabled={pdfBusy || pdfTargetReserves.length === 0}
                  onClick={() => void handleReservePdfExport()}
                >
                  {pdfBusy ? 'Génération...' : 'Télécharger PDF'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {(!isCompactReserveView || showMobileReserveDetail) && (
      <section className={`${styles.panel} ${styles.reservesDetailPanel} ${showMobileReserveDetail ? styles.reservesMobileDetailPanel : ''}`}>
        {showMobileReserveDetail && (
          <button
            type="button"
            className={styles.reserveMobileBackButton}
            onClick={() => {
              setMobileDetailOpen(false);
              setCommentText('');
            }}
          >
            <span>←</span>
            Retour aux réserves
          </button>
        )}
        {detailReserve ? (
          <>
            <div className={styles.reserveDetailHeader}>
              <div>
                <p className={styles.eyebrow}>{detailReserve.id}</p>
                <h2>{detailReserve.title}</h2>
                <span>{[detailReserve.building, detailReserve.level, detailReserve.zone].filter(Boolean).join(' · ') || 'Sans localisation'}</span>
              </div>
              <span className={styles.badge}>{PRIORITY_LABELS[detailReserve.priority] ?? detailReserve.priority}</span>
            </div>
            <div className={styles.reserveDetailBody}>
            <p className={styles.description}>{detailReserve.description || 'Aucune description.'}</p>
            <dl className={styles.metaGrid}>
              <div><dt>Statut</dt><dd>{STATUS_LABELS[detailReserve.status] ?? detailReserve.status}</dd></div>
              <div><dt>Entreprise</dt><dd>{reserveCompanies(detailReserve).join(', ') || '—'}</dd></div>
              <div><dt>Échéance</dt><dd>{prettyDate(detailReserve.deadline)}</dd></div>
              <div><dt>Plan</dt><dd>{detailReserve.plan_id ? 'Épinglée' : 'Non épinglée'}</dd></div>
              <div><dt>Accusé réception</dt><dd>{detailReserve.enterprise_acknowledged_at ? prettyDate(detailReserve.enterprise_acknowledged_at, true) : 'Manquant'}</dd></div>
              <div><dt>Archive</dt><dd>{detailReserve.archived_at ? prettyDate(detailReserve.archived_at, true) : 'Active'}</dd></div>
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
                      <span className={styles.photoAnnotationFrame}>
                        <img src={photo.uri} alt={photo.comment ?? photo.name ?? 'Photo réserve'} />
                        <PhotoAnnotationLayer annotations={photoAnnotationsFrom(photo)} compact />
                      </span>
                      <span className={styles.reservePhotoKindBadge}>{photo.kind === 'resolution' ? 'Levée' : 'Constat'}</span>
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
                await props.onComment(detailReserve, commentText);
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
            <div className={styles.reserveDetailExportRow}>
              <button
                type="button"
                onClick={() => {
                  setPdfMode('selected');
                  setPdfModalOpen(true);
                }}
                disabled={pdfBusy}
              >
                Fiche PDF
              </button>
            </div>
            {props.editable && (
              <div className={styles.actionBar}>
                <button type="button" onClick={() => props.onEdit(detailReserve)}>Modifier</button>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <button type="button" key={value} disabled={props.saving || detailReserve.status === value} onClick={() => props.onStatus(detailReserve.id, value)}>
                    {label}
                  </button>
                ))}
                <button type="button" onClick={() => props.onArchive(detailReserve)}>{detailReserve.archived_at ? 'Désarchiver' : 'Archiver'}</button>
                <button type="button" className={styles.dangerButton} onClick={() => props.onDelete(detailReserve)}>Supprimer</button>
              </div>
            )}
            <HistoryBlock title="Commentaires" rows={detailReserve.comments ?? []} />
            <HistoryBlock title="Historique" rows={detailReserve.history ?? []} />
            </div>
          </>
        ) : (
          <p className={styles.empty}>Sélectionnez une réserve.</p>
        )}
      </section>
      )}
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

function drawingPath(points: WebPlanDrawing['points']) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function renderWebPlanDrawing(drawing: WebPlanDrawing, key: string) {
  const points = drawing.points ?? [];
  if (!points.length) return null;
  const first = points[0];
  const last = points[points.length - 1] ?? first;
  const strokeWidth = Math.max(0.18, Math.min(3.4, Number(drawing.strokeWidth || 3) * 0.22));
  const opacity = drawing.opacity ?? (drawing.tool === 'highlight' ? 0.28 : 1);
  const common = {
    stroke: drawing.color || '#ef4444',
    strokeWidth,
    opacity,
    vectorEffect: 'non-scaling-stroke' as const,
  };

  if (drawing.tool === 'rect' || drawing.tool === 'cloud' || drawing.tool === 'highlight') {
    const x = Math.min(first.x, last.x);
    const y = Math.min(first.y, last.y);
    const width = Math.abs(last.x - first.x);
    const height = Math.abs(last.y - first.y);
    return (
      <rect
        key={key}
        x={x}
        y={y}
        width={width}
        height={height}
        rx={drawing.tool === 'cloud' ? 2.5 : 0.7}
        fill={drawing.tool === 'highlight' ? drawing.color || '#facc15' : 'none'}
        {...common}
      />
    );
  }

  if (drawing.tool === 'ellipse') {
    const cx = (first.x + last.x) / 2;
    const cy = (first.y + last.y) / 2;
    return (
      <ellipse
        key={key}
        cx={cx}
        cy={cy}
        rx={Math.abs(last.x - first.x) / 2}
        ry={Math.abs(last.y - first.y) / 2}
        fill="none"
        {...common}
      />
    );
  }

  if (drawing.tool === 'line' || drawing.tool === 'arrow') {
    const angle = Math.atan2(last.y - first.y, last.x - first.x);
    const arrowLength = Math.max(1.4, strokeWidth * 4);
    const arrowAngle = Math.PI / 7;
    const left = {
      x: last.x - arrowLength * Math.cos(angle - arrowAngle),
      y: last.y - arrowLength * Math.sin(angle - arrowAngle),
    };
    const right = {
      x: last.x - arrowLength * Math.cos(angle + arrowAngle),
      y: last.y - arrowLength * Math.sin(angle + arrowAngle),
    };
    return (
      <g key={key}>
        <line x1={first.x} y1={first.y} x2={last.x} y2={last.y} fill="none" {...common} />
        {drawing.tool === 'arrow' && (
          <path
            d={`M ${left.x} ${left.y} L ${last.x} ${last.y} L ${right.x} ${right.y}`}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...common}
          />
        )}
      </g>
    );
  }

  if (drawing.tool === 'text') {
    return (
      <text
        key={key}
        x={first.x}
        y={first.y}
        fill={drawing.color || '#ef4444'}
        fontSize={Math.max(1.6, Math.min(4.2, Number(drawing.fontSize ?? 14) / 5))}
        fontWeight={800}
        opacity={opacity}
      >
        {drawing.text}
      </text>
    );
  }

  return (
    <path
      key={key}
      d={drawingPath(points)}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...common}
    />
  );
}

function WebPdfPlan({
  uri,
  name,
  pins,
  focusedReserveId,
  canCreate,
  canMovePins,
  canAnnotate,
  annotations,
  placementPreview,
  onCreateReserveAtPin,
  onPinMove,
  onAnnotationsChange,
  onPinClick,
  onPinDoubleClick,
  onClearFocus,
}: {
  uri: string;
  name: string;
  pins: PlanPin[];
  focusedReserveId?: string | null;
  canCreate?: boolean;
  canMovePins?: boolean;
  canAnnotate?: boolean;
  annotations?: WebPlanDrawing[];
  placementPreview?: PinPlacementPreview | null;
  onCreateReserveAtPin?: (x: number, y: number) => void;
  onPinMove?: (reserveId: string, x: number, y: number) => PinMoveResult;
  onAnnotationsChange?: (annotations: WebPlanDrawing[]) => void;
  onPinClick: (reserveId: string) => void;
  onPinDoubleClick: (reserveId: string) => void;
  onClearFocus?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const lastFocusZoomRef = useRef('');
  const drawingPointerRef = useRef<number | null>(null);
  const movePreviewTimerRef = useRef<number | null>(null);
  const suppressNextPageClickRef = useRef(false);
  const panStateRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    moved: false,
  });
  const [scale, setScale] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [drawWidth, setDrawWidth] = useState(4);
  const [liveDrawing, setLiveDrawing] = useState<WebPlanDrawing | null>(null);
  const [localAnnotations, setLocalAnnotations] = useState<WebPlanDrawing[]>(annotations ?? []);
  const [moveMode, setMoveMode] = useState(false);
  const [movePreview, setMovePreview] = useState<PinPlacementPreview | null>(null);

  useEffect(() => {
    setScale(0);
    setPageSize({ width: 0, height: 0 });
    setError('');
    setAnnotationMode(false);
    setLiveDrawing(null);
    setMoveMode(false);
    setMovePreview(null);
    lastFocusZoomRef.current = '';
  }, [uri]);

  useEffect(() => {
    setLocalAnnotations(annotations ?? []);
  }, [annotations, uri]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  useEffect(() => {
    return () => {
      if (movePreviewTimerRef.current) window.clearTimeout(movePreviewTimerRef.current);
    };
  }, []);

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

  function pagePointFromEvent(event: MouseEvent<HTMLDivElement> | PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Number(clampPercent(((event.clientX - rect.left) / rect.width) * 100).toFixed(2)),
      y: Number(clampPercent(((event.clientY - rect.top) / rect.height) * 100).toFixed(2)),
    };
  }

  function commitAnnotations(next: WebPlanDrawing[]) {
    setLocalAnnotations(next);
    onAnnotationsChange?.(next);
  }

  function isPdfPanControl(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('button, a, input, select, textarea, [role="button"], [data-pdf-pan-ignore="true"]'));
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (annotationMode) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isPdfPanControl(event.target)) return;
    const viewport = viewportRef.current;
    if (!viewport || (viewport.scrollWidth <= viewport.clientWidth && viewport.scrollHeight <= viewport.clientHeight)) return;
    panStateRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsPanning(true);
  }

  function handleViewportPointerMove(event: PointerEvent<HTMLDivElement>) {
    const panState = panStateRef.current;
    if (!panState.active || panState.pointerId !== event.pointerId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    if (!panState.moved && Math.hypot(deltaX, deltaY) > 4) {
      panState.moved = true;
    }
    viewport.scrollLeft = panState.scrollLeft - deltaX;
    viewport.scrollTop = panState.scrollTop - deltaY;
    if (panState.moved) event.preventDefault();
  }

  function finishViewportPan(event: PointerEvent<HTMLDivElement>) {
    const panState = panStateRef.current;
    if (!panState.active || panState.pointerId !== event.pointerId) return;
    if (panState.moved) {
      suppressNextPageClickRef.current = true;
      window.setTimeout(() => {
        suppressNextPageClickRef.current = false;
      }, 120);
    }
    panStateRef.current = {
      active: false,
      pointerId: -1,
      startX: 0,
      startY: 0,
      scrollLeft: 0,
      scrollTop: 0,
      moved: false,
    };
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setIsPanning(false);
  }

  async function handlePageClick(event: MouseEvent<HTMLDivElement>) {
    if (suppressNextPageClickRef.current) {
      suppressNextPageClickRef.current = false;
      return;
    }
    if (annotationMode) return;
    const { x, y } = pagePointFromEvent(event);
    if (moveMode && canMovePins && focusedReserveId) {
      setMoveMode(false);
      const moveResult = await Promise.resolve(onPinMove?.(focusedReserveId, x, y));
      if (moveResult === false) return;
      const preview: PinPlacementPreview = {
        id: `move-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        planId: 'current',
        x,
        y,
        label: 'Épingle déplacée',
      };
      setMovePreview(preview);
      if (movePreviewTimerRef.current) window.clearTimeout(movePreviewTimerRef.current);
      movePreviewTimerRef.current = window.setTimeout(() => setMovePreview(null), 850);
      return;
    }
    if (focusedReserveId) {
      setMoveMode(false);
      onClearFocus?.();
      return;
    }
    if (!canCreate) return;
    onCreateReserveAtPin?.(x, y);
  }

  function handleDrawPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!annotationMode || !canAnnotate) return;
    event.preventDefault();
    event.stopPropagation();
    drawingPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pagePointFromEvent(event);
    setLiveDrawing({
      id: `drawing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tool: 'pen',
      points: [point],
      color: drawColor,
      strokeWidth: drawWidth,
      page: 1,
    });
  }

  function handleDrawPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (drawingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const point = pagePointFromEvent(event);
    setLiveDrawing(current => {
      if (!current) return current;
      const last = current.points[current.points.length - 1];
      if (last && Math.abs(last.x - point.x) + Math.abs(last.y - point.y) < 0.1) return current;
      return { ...current, points: [...current.points, point] };
    });
  }

  function handleDrawPointerUp(event: PointerEvent<SVGSVGElement>) {
    if (drawingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    drawingPointerRef.current = null;
    setLiveDrawing(current => {
      if (current && current.points.length > 1) {
        commitAnnotations([...localAnnotations, current]);
      }
      return null;
    });
  }

  const focusedPin = focusedReserveId ? pins.find(pin => pin.reserve.id === focusedReserveId) : null;
  const activePreview = placementPreview ?? movePreview;

  const pdfShell = (
    <div className={`${styles.webPdfShell} ${isFullscreen ? styles.webPdfShellFullscreen : ''}`}>
      <div className={styles.webPdfToolbar}>
        <div className={styles.webPdfZoomControls}>
          <button type="button" onClick={() => setScale(value => Math.max(0.08, Number(((value || 1) - 0.1).toFixed(2))))}>−</button>
          <strong>{scale ? Math.round(scale * 100) : '…'}%</strong>
          <button type="button" onClick={() => setScale(value => Math.min(3, Number(((value || 1) + 0.1).toFixed(2))))}>+</button>
        </div>
        <button type="button" onClick={() => setScale(0)}>Adapter</button>
        <button type="button" onClick={() => { setIsFullscreen(value => !value); setScale(0); }}>
          {isFullscreen ? 'Réduire' : 'Grand plan'}
        </button>
        {canMovePins && focusedPin && (
          <button
            type="button"
            className={moveMode ? styles.webPdfToolbarActive : ''}
            onClick={() => {
              setMoveMode(value => !value);
              setAnnotationMode(false);
            }}
          >
            {moveMode ? 'Cliquez la position' : 'Déplacer épingle'}
          </button>
        )}
        {canAnnotate && (
          <button
            type="button"
            className={annotationMode ? styles.webPdfToolbarActive : ''}
            onClick={() => {
              setAnnotationMode(value => !value);
              setMoveMode(false);
            }}
          >
            Crayon
          </button>
        )}
        <a href={uri} target="_blank" rel="noreferrer">Ouvrir le PDF</a>
      </div>
      {canAnnotate && annotationMode && (
        <div className={styles.webPdfAnnotateControls}>
          <span>Couleur</span>
          {['#ef4444', '#f59e0b', '#22c55e', '#2563eb', '#111827'].map(color => (
            <button
              key={color}
              type="button"
              className={drawColor === color ? styles.webPdfColorButtonActive : styles.webPdfColorButton}
              style={{ background: color }}
              onClick={() => setDrawColor(color)}
              aria-label={`Couleur ${color}`}
            />
          ))}
          <span>Trait</span>
          {[1, 4, 8, 14].map(width => (
            <button
              key={width}
              type="button"
              className={`${styles.webPdfWidthButton} ${drawWidth === width ? styles.webPdfToolbarActive : ''}`}
              onClick={() => setDrawWidth(width)}
            >
              {width}
            </button>
          ))}
          <button
            type="button"
            disabled={localAnnotations.length === 0}
            onClick={() => commitAnnotations(localAnnotations.slice(0, -1))}
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={localAnnotations.length === 0}
            onClick={() => commitAnnotations([])}
          >
            Effacer
          </button>
        </div>
      )}
      {moveMode && focusedPin && (
        <div className={styles.webPdfMoveHint}>
          Cliquez sur le plan pour repositionner l'épingle {focusedPin.number}.
        </div>
      )}
      <div
        ref={viewportRef}
        className={`${styles.webPdfViewport} ${isPanning ? styles.webPdfViewportPanning : ''}`}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={finishViewportPan}
        onPointerCancel={finishViewportPan}
      >
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
          <svg
            className={`${styles.webPdfAnnotationLayer} ${annotationMode ? styles.webPdfAnnotationLayerActive : ''}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            onPointerDown={handleDrawPointerDown}
            onPointerMove={handleDrawPointerMove}
            onPointerUp={handleDrawPointerUp}
            onPointerCancel={handleDrawPointerUp}
          >
            {localAnnotations.map((drawing, index) => renderWebPlanDrawing(drawing, drawing.id ?? `drawing-${index}`))}
            {liveDrawing && renderWebPlanDrawing(liveDrawing, 'live-drawing')}
          </svg>
          {activePreview && (
            <div
              key={activePreview.id}
              className={styles.pinPlacementPreview}
              style={{ left: `${activePreview.x}%`, top: `${activePreview.y}%` }}
            >
              <span>{activePreview.label}</span>
            </div>
          )}
          {pins.map((pin) => (
            <button
              key={pin.reserve.id}
              className={`${styles.pin} ${focusedReserveId === pin.reserve.id ? styles.pinFocused : ''}`}
              style={{ left: `${pin.x}%`, top: `${pin.y}%`, background: pin.color }}
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

  if (isFullscreen && typeof document !== 'undefined') {
    return createPortal(pdfShell, document.body);
  }

  return pdfShell;
}

function PlansView({
  plans,
  reserves,
  companies,
  selectedPlan,
  setSelectedPlanId,
  setSelectedReserveId,
  setTab,
  onCreateReserve,
  onCreateReserveAtPin,
  onMoveReservePin,
  onUpdatePlanAnnotations,
  onGeneratePlansPdf,
  generatingReport,
  defaultReportLanguage,
  editable,
}: any) {
  const [buildingQuery, setBuildingQuery] = useState('');
  const [selectedBuildingKey, setSelectedBuildingKey] = useState('all');
  const [activeFamilyKey, setActiveFamilyKey] = useState('all');
  const [buildingFamilyMenuOpen, setBuildingFamilyMenuOpen] = useState(false);
  const [buildingFamilyMenuQuery, setBuildingFamilyMenuQuery] = useState('');
  const [expandedBuildingKeys, setExpandedBuildingKeys] = useState<Set<string>>(() => new Set());
  const [recentBuildingKeys, setRecentBuildingKeys] = useState<string[]>(() => readStoredStringList(WEB_RECENT_BUILDINGS_KEY));
  const [selectedPlanReserveId, setSelectedPlanReserveId] = useState<string | null>(null);
  const [planReservePanelOpen, setPlanReservePanelOpen] = useState(false);
  const [focusedPlanReserveId, setFocusedPlanReserveId] = useState<string | null>(null);
  const [pinPlacementPreview, setPinPlacementPreview] = useState<PinPlacementPreview | null>(null);
  const [plansPdfOpen, setPlansPdfOpen] = useState(false);
  const [plansPdfScope, setPlansPdfScope] = useState<'plan' | 'global'>('plan');
  const [plansPdfMode, setPlansPdfMode] = useState<'all' | 'company_single' | 'company_multi' | 'manual'>('all');
  const [plansPdfCompanySingle, setPlansPdfCompanySingle] = useState('');
  const [plansPdfCompaniesMulti, setPlansPdfCompaniesMulti] = useState<Set<string>>(new Set());
  const [plansPdfManualSelection, setPlansPdfManualSelection] = useState<Set<string>>(new Set());
  const [plansPdfGlobalCompany, setPlansPdfGlobalCompany] = useState<string | null>(null);
  const [plansPdfStatusFilter, setPlansPdfStatusFilter] = useState<Set<string>>(new Set());
  const [plansPdfLanguage, setPlansPdfLanguage] = useState<TextLang>(defaultReportLanguage ?? 'fr');
  const pinPlacementTimerRef = useRef<number | null>(null);
  const planReserves = useMemo(
    () => selectedPlan ? reserves.filter((r: any) => getReservePlanId(r) === String(selectedPlan.id)) : [],
    [reserves, selectedPlan?.id],
  );
  const displayPlanReserves = useMemo(
    () => planReserves.filter((reserve: any) => shouldNumberReserveOnPlan(reserve, selectedPlanReserveId ?? focusedPlanReserveId)),
    [focusedPlanReserveId, planReserves, selectedPlanReserveId],
  );
  const planPinNumberMap = useMemo(
    () => createPlanPinNumberMap(displayPlanReserves),
    [displayPlanReserves],
  );
  const exportablePlanReserves = useMemo(
    () => planReserves.filter((reserve: any) => !isReserveArchived(reserve)),
    [planReserves],
  );
  const exportableProjectReserves = useMemo(
    () => reserves.filter((reserve: any) => !isReserveArchived(reserve)),
    [reserves],
  );
  const selectedPlanReserve = planReserves.find((reserve: any) => reserve.id === selectedPlanReserveId) ?? null;
  const selectedPlanBuildingKey = selectedPlan ? getPlanBuildingKey(selectedPlan) : 'all';
  const reserveCountByPlanId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const reserve of reserves) {
      if (!reserve?.plan_id || reserve.archived_at || reserve.archivedAt) continue;
      counts.set(reserve.plan_id, (counts.get(reserve.plan_id) ?? 0) + 1);
    }
    return counts;
  }, [reserves]);
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
  const orderedBuildingFamilies = useMemo(
    () => [...buildingFamilies.families].sort((a, b) => (
      b.groups.length - a.groups.length
      || a.label.localeCompare(b.label, 'fr', { numeric: true, sensitivity: 'base' })
    )),
    [buildingFamilies.families],
  );
  const buildingFamilyOptions = useMemo(() => (
    buildingFamilies.useGrouping
      ? [
          { key: 'all', label: 'Tous', count: buildingGroups.length },
          ...orderedBuildingFamilies.map(family => ({
            key: family.key,
            label: family.label,
            count: family.groups.length,
          })),
        ]
      : []
  ), [buildingFamilies.useGrouping, buildingGroups.length, orderedBuildingFamilies]);
  const primaryBuildingFamilyOptions = useMemo(() => {
    const primary = buildingFamilyOptions.slice(0, 4);
    const active = buildingFamilyOptions.find(option => option.key === activeFamilyKey);
    if (!active || primary.some(option => option.key === active.key)) return primary;
    return [primary[0], ...primary.slice(1, 3), active].filter(Boolean) as typeof buildingFamilyOptions;
  }, [activeFamilyKey, buildingFamilyOptions]);
  const visibleBuildingFamilyKeys = useMemo(
    () => new Set(primaryBuildingFamilyOptions.map(option => option.key)),
    [primaryBuildingFamilyOptions],
  );
  const hiddenBuildingFamilyOptions = useMemo(
    () => buildingFamilyOptions.filter(option => option.key !== 'all' && !visibleBuildingFamilyKeys.has(option.key)),
    [buildingFamilyOptions, visibleBuildingFamilyKeys],
  );
  const filteredHiddenBuildingFamilyOptions = useMemo(() => {
    const query = normalizeSearchText(buildingFamilyMenuQuery);
    if (!query) return hiddenBuildingFamilyOptions;
    return hiddenBuildingFamilyOptions.filter(option => normalizeSearchText(option.label).includes(query));
  }, [buildingFamilyMenuQuery, hiddenBuildingFamilyOptions]);
  useEffect(() => {
    if (!buildingFamilies.useGrouping && activeFamilyKey !== 'all') setActiveFamilyKey('all');
    if (buildingFamilies.useGrouping && activeFamilyKey !== 'all' && !buildingFamilies.families.some(family => family.key === activeFamilyKey)) {
      setActiveFamilyKey('all');
    }
  }, [activeFamilyKey, buildingFamilies]);
  useEffect(() => {
    if (buildingQuery.trim() || !buildingFamilies.useGrouping) {
      setBuildingFamilyMenuOpen(false);
      setBuildingFamilyMenuQuery('');
    }
  }, [buildingFamilies.useGrouping, buildingQuery]);
  const handleSelectBuildingFamily = (key: string) => {
    setActiveFamilyKey(key);
    setBuildingFamilyMenuOpen(false);
    setBuildingFamilyMenuQuery('');
  };
  const familyFilteredBuildingGroups = useMemo(() => {
    if (buildingQuery.trim() || !buildingFamilies.useGrouping || activeFamilyKey === 'all') return buildingGroups;
    return buildingGroups.filter(group => (buildingFamilies.familyOf.get(group.key) ?? '__others__') === activeFamilyKey);
  }, [activeFamilyKey, buildingFamilies, buildingGroups, buildingQuery]);
  const filteredBuildingGroups = useMemo(() => {
    const query = normalizeSearchText(buildingQuery);
    if (!query) {
      return familyFilteredBuildingGroups.map(group => ({ ...group, displayPlans: group.plans }));
    }
    return familyFilteredBuildingGroups
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
  }, [buildingQuery, familyFilteredBuildingGroups]);
  const totalReserveCount = buildingGroups.reduce((sum, group) => sum + group.reserveCount, 0);
  const recentBuildingGroups = recentBuildingKeys
    .map(key => buildingGroups.find(group => group.key === key))
    .filter(Boolean)
    .slice(0, 3) as typeof buildingGroups;
  const hasBuildingFamilyFilter = buildingFamilies.useGrouping && activeFamilyKey !== 'all';
  useEffect(() => {
    setSelectedPlanReserveId(null);
    setPlanReservePanelOpen(false);
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
  const rememberBuildingGroup = (key: string) => {
    if (!key || key === 'all') return;
    setRecentBuildingKeys(prev => {
      const next = [key, ...prev.filter(item => item !== key)].slice(0, 5);
      if (typeof window !== 'undefined') window.localStorage.setItem(WEB_RECENT_BUILDINGS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const handleSelectBuildingGroup = (group: { key: string; plans: any[]; displayPlans?: any[] }) => {
    setSelectedBuildingKey(group.key);
    rememberBuildingGroup(group.key);
    setExpandedBuildingKeys(prev => {
      const next = new Set(prev);
      next.add(group.key);
      return next;
    });
    const sourcePlans = group.displayPlans?.length ? group.displayPlans : group.plans;
    if (!sourcePlans.some(plan => plan.id === selectedPlan?.id) && sourcePlans[0]) {
      setSelectedPlanId(sourcePlans[0].id);
    }
  };
  const openReserveFromPin = (reserveId: string) => {
    setSelectedReserveId(reserveId);
    setTab('reserves');
  };
  const assignOrCreatePinAt = (x: number, y: number) => {
    if (!selectedPlan) return;
    const nextX = Number(clampPercent(x).toFixed(2));
    const nextY = Number(clampPercent(y).toFixed(2));
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
  const planPins = displayPlanReserves
    .map((reserve: any) => {
      const rawX = Number(reserve.plan_x);
      const rawY = Number(reserve.plan_y);
      // Historical web pins could be saved as 0..1. Mobile pins are 0..100.
      const ratioMode = Number.isFinite(rawX) && Number.isFinite(rawY) && Math.abs(rawX) <= 1 && Math.abs(rawY) <= 1;
      return {
        reserve,
        number: getPlanPinNumber(planPinNumberMap, reserve) ?? 0,
        x: planCoordinateToPercent(reserve.plan_x, ratioMode),
        y: planCoordinateToPercent(reserve.plan_y, ratioMode),
        color: getReservePinColor(reserve, companies ?? []),
      };
    })
    .filter((pin: any) => pin.x != null && pin.y != null) as PlanPin[];
  const activePlacementPreview = selectedPlan && pinPlacementPreview?.planId === selectedPlan.id
    ? pinPlacementPreview
    : null;
  const planPdfCompanies = useMemo(() => {
    const map = new Map<string, number>();
    for (const reserve of exportablePlanReserves) {
      for (const company of reserveCompanies(reserve)) {
        map.set(company, (map.get(company) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
  }, [exportablePlanReserves]);
  const globalPdfCompanies = useMemo(() => {
    const map = new Map<string, number>();
    for (const reserve of exportableProjectReserves) {
      for (const company of reserveCompanies(reserve)) {
        map.set(company, (map.get(company) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
  }, [exportableProjectReserves]);
  const plansPdfTargetReserves = useMemo(() => {
    if (plansPdfScope === 'plan') {
      if (plansPdfMode === 'company_single') {
        return plansPdfCompanySingle
          ? exportablePlanReserves.filter((reserve: any) => reserveMatchesCompanyName(reserve, plansPdfCompanySingle))
          : [];
      }
      if (plansPdfMode === 'company_multi') {
        if (plansPdfCompaniesMulti.size === 0) return [];
        return exportablePlanReserves.filter((reserve: any) =>
          reserveCompanies(reserve).some(company => plansPdfCompaniesMulti.has(company))
        );
      }
      if (plansPdfMode === 'manual') {
        if (plansPdfManualSelection.size === 0) return [];
        return exportablePlanReserves.filter((reserve: any) => plansPdfManualSelection.has(String(reserve.id)));
      }
      return exportablePlanReserves;
    }

    return exportableProjectReserves.filter((reserve: any) => {
      if (plansPdfGlobalCompany && !reserveMatchesCompanyName(reserve, plansPdfGlobalCompany)) return false;
      if (plansPdfStatusFilter.size > 0 && !plansPdfStatusFilter.has(String(reserve.status ?? 'open'))) return false;
      return true;
    });
  }, [
    exportablePlanReserves,
    exportableProjectReserves,
    plansPdfCompaniesMulti,
    plansPdfCompanySingle,
    plansPdfGlobalCompany,
    plansPdfManualSelection,
    plansPdfMode,
    plansPdfScope,
    plansPdfStatusFilter,
  ]);
  const plansPdfTargetPlanIds = useMemo(() => {
    const ids = new Set<string>();
    for (const reserve of plansPdfTargetReserves) {
      const planId = getReservePlanId(reserve);
      if (planId) ids.add(planId);
    }
    return ids;
  }, [plansPdfTargetReserves]);
  const plansPdfTargetPlans = plansPdfScope === 'plan'
    ? (selectedPlan ? [selectedPlan] : [])
    : plans.filter((plan: any) => plansPdfTargetPlanIds.has(String(plan.id)));
  const plansPdfBusy = generatingReport === `plans-${plansPdfLanguage}`;
  const plansPdfCompanyLabel =
    plansPdfScope === 'global'
      ? plansPdfGlobalCompany
      : plansPdfMode === 'company_single'
        ? plansPdfCompanySingle || null
        : plansPdfMode === 'company_multi'
          ? `${plansPdfCompaniesMulti.size} entreprises`
          : plansPdfMode === 'manual'
            ? 'Sélection manuelle'
            : null;
  const plansPdfStatusLabel = plansPdfStatusFilter.size > 0
    ? [...plansPdfStatusFilter].map(status => STATUS_LABELS[status] ?? status).join(', ')
    : null;

  useEffect(() => {
    setPlansPdfLanguage(defaultReportLanguage ?? 'fr');
  }, [defaultReportLanguage]);

  useEffect(() => {
    setPlansPdfManualSelection(new Set(exportablePlanReserves.map((reserve: any) => String(reserve.id))));
    if (plansPdfCompanySingle && !planPdfCompanies.some(company => company.name === plansPdfCompanySingle)) {
      setPlansPdfCompanySingle(planPdfCompanies[0]?.name ?? '');
    }
  }, [exportablePlanReserves, planPdfCompanies, plansPdfCompanySingle]);

  async function handlePlansPdfExport() {
    if (plansPdfBusy || plansPdfTargetReserves.length === 0) return;
    await onGeneratePlansPdf(
      plansPdfTargetPlans,
      plansPdfTargetReserves,
      plansPdfLanguage,
      plansPdfCompanyLabel,
      plansPdfStatusLabel,
    );
  }

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
          <div className={styles.buildingFamilyToolbarWeb}>
            <div className={styles.buildingFamilyRowWeb}>
              {primaryBuildingFamilyOptions.map(option => (
                <button
                  key={option.key}
                  type="button"
                  className={activeFamilyKey === option.key ? styles.buildingFamilyActiveWeb : ''}
                  onClick={() => handleSelectBuildingFamily(option.key)}
                >
                  {option.label} <em>{option.count}</em>
                </button>
              ))}
              {hiddenBuildingFamilyOptions.length > 0 && (
                <div className={styles.buildingFamilyMoreWeb}>
                  <button
                    type="button"
                    className={buildingFamilyMenuOpen ? styles.buildingFamilyMoreActiveWeb : ''}
                    aria-expanded={buildingFamilyMenuOpen}
                    aria-controls="building-family-popover"
                    onClick={() => setBuildingFamilyMenuOpen(open => !open)}
                  >
                    + {hiddenBuildingFamilyOptions.length} {hiddenBuildingFamilyOptions.length > 1 ? 'familles' : 'famille'}
                  </button>
                  {buildingFamilyMenuOpen && (
                    <div id="building-family-popover" className={styles.buildingFamilyPopoverWeb}>
                      <div className={styles.buildingFamilyPopoverHeaderWeb}>
                        <strong>Toutes les familles</strong>
                        <button
                          type="button"
                          onClick={() => {
                            setBuildingFamilyMenuOpen(false);
                            setBuildingFamilyMenuQuery('');
                          }}
                        >
                          Fermer
                        </button>
                      </div>
                      <label className={styles.buildingFamilyPopoverSearchWeb}>
                        <span>⌕</span>
                        <input
                          value={buildingFamilyMenuQuery}
                          onChange={event => setBuildingFamilyMenuQuery(event.target.value)}
                          placeholder="Rechercher une famille..."
                          autoFocus
                        />
                      </label>
                      <div className={styles.buildingFamilyPopoverListWeb}>
                        {filteredHiddenBuildingFamilyOptions.length > 0 ? (
                          filteredHiddenBuildingFamilyOptions.map(option => (
                            <button
                              key={option.key}
                              type="button"
                              className={activeFamilyKey === option.key ? styles.buildingFamilyActiveWeb : ''}
                              onClick={() => handleSelectBuildingFamily(option.key)}
                            >
                              <span>{option.label}</span>
                              <em>{option.count}</em>
                            </button>
                          ))
                        ) : (
                          <p>Aucune famille trouvée.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
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
          {!buildingQuery && recentBuildingGroups.length > 0 && !hasBuildingFamilyFilter ? (
            <div className={styles.buildingRecentBlockWeb}>
              <div className={styles.buildingMiniSectionTitleWeb}>Récents</div>
              {recentBuildingGroups.map(group => (
                <button
                  key={`recent-${group.key}`}
                  type="button"
                  className={`${styles.buildingRecentButtonWeb} ${selectedBuildingKey === group.key ? styles.buildingFilterActiveWeb : ''}`}
                  onClick={() => handleSelectBuildingGroup(group)}
                >
                  <span>{group.name}</span>
                  <em>{group.reserveCount}</em>
                </button>
              ))}
            </div>
          ) : null}
          {filteredBuildingGroups.map((group: any) => {
            const isSelectedGroup = selectedBuildingKey === group.key || (selectedBuildingKey === 'all' && selectedPlanBuildingKey === group.key);
            const isExpanded = Boolean(buildingQuery) || isSelectedGroup || expandedBuildingKeys.has(group.key);
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
                      const planReserveCount = reserveCountByPlanId.get(plan.id) ?? 0;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={`${styles.buildingPlanRowWeb} ${selectedPlan?.id === plan.id ? styles.selectedRow : ''}`}
                          onClick={() => {
                            setSelectedBuildingKey(group.key);
                            rememberBuildingGroup(group.key);
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
            <div className={`${styles.sectionHeader} ${styles.planPreviewHeader}`}>
              <div className={styles.planPreviewTitle}>
                <p className={styles.eyebrow}>{selectedPlan.file_type ?? 'plan'}</p>
                <h2>{selectedPlan.name}</h2>
              </div>
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  onClick={() => setPlansPdfOpen(true)}
                  disabled={!selectedPlan || exportableProjectReserves.length === 0}
                >
                  PDF
                </button>
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
            <div className={`${styles.planWorkArea} ${planReservePanelOpen ? styles.planWorkAreaWithReservePanel : styles.planWorkAreaReserveCollapsed}`}>
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
                    canMovePins={editable}
                    canAnnotate={editable}
                    annotations={Array.isArray(selectedPlan.annotations) ? selectedPlan.annotations : []}
                    placementPreview={activePlacementPreview}
                    onCreateReserveAtPin={assignOrCreatePinAt}
                    onPinMove={(reserveId, x, y) => {
                      const reserve = planReserves.find((item: any) => item.id === reserveId);
                      if (!reserve) return false;
                      return onMoveReservePin?.(reserve, selectedPlan, x, y) ?? false;
                    }}
                    onAnnotationsChange={(nextAnnotations) => onUpdatePlanAnnotations?.(selectedPlan, nextAnnotations)}
                    onPinClick={(reserveId) => {
                      setSelectedPlanReserveId(reserveId);
                      setFocusedPlanReserveId(reserveId);
                    }}
                    onPinDoubleClick={openReserveFromPin}
                    onClearFocus={() => setFocusedPlanReserveId(null)}
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
                      if (focusedPlanReserveId) {
                        setFocusedPlanReserveId(null);
                        return;
                      }
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
                      style={{ left: `${pin.x}%`, top: `${pin.y}%`, background: pin.color }}
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
              {planReservePanelOpen ? (
                <aside className={styles.planReservePanel}>
                  <div className={styles.planReserveHeader}>
                    <div>
                      <h3>Réserves</h3>
                      <span>{displayPlanReserves.length} sur ce plan</span>
                    </div>
                    <div className={styles.planReserveHeaderActions}>
                      <strong>{planPins.length} épinglées</strong>
                      <button
                        type="button"
                        onClick={() => setPlanReservePanelOpen(false)}
                        aria-label="Replier les réserves du plan"
                      >
                        →
                      </button>
                    </div>
                  </div>
                  <div className={styles.planReserveList}>
                    {displayPlanReserves.map((reserve: any) => (
                      <button
                        key={reserve.id}
                        className={`${styles.planReserveRow} ${selectedPlanReserveId === reserve.id ? styles.planReserveRowActive : ''}`}
                        onClick={() => setSelectedPlanReserveId(reserve.id)}
                      >
                        <span className={styles.planReserveNumber} style={{ background: getReservePinColor(reserve, companies ?? []) }}>
                          {getPlanPinNumber(planPinNumberMap, reserve) ?? '—'}
                        </span>
                        <span>
                          <strong>{reserve.title}</strong>
                          <small>{[STATUS_LABELS[reserve.status] ?? reserve.status, reserve.company_name, reserve.zone].filter(Boolean).join(' · ')}</small>
                        </span>
                      </button>
                    ))}
                    {!displayPlanReserves.length && (
                      <div className={styles.planReserveEmpty}>
                        <strong>Aucune réserve</strong>
                        <span>Les réserves épinglées sur ce plan apparaîtront ici.</span>
                      </div>
                    )}
                  </div>
                  {selectedPlanReserve && (
                    <div className={styles.planReserveQuickCard}>
                      <div className={styles.planReserveQuickHeader}>
                        <span className={styles.planReserveNumber} style={{ background: getReservePinColor(selectedPlanReserve, companies ?? []) }}>
                          {getPlanPinNumber(planPinNumberMap, selectedPlanReserve) ?? '—'}
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
              ) : (
                <button
                  type="button"
                  className={styles.planReserveCollapsedRail}
                  onClick={() => setPlanReservePanelOpen(true)}
                  aria-expanded={false}
                  aria-label={`Afficher les réserves du plan (${displayPlanReserves.length})`}
                >
                  <span>Réserves</span>
                  <strong>{displayPlanReserves.length}</strong>
                  <em>{planPins.length} épinglées</em>
                  <b>←</b>
                </button>
              )}
            </div>
          </>
        ) : <p className={styles.empty}>Sélectionnez un plan.</p>}
      </section>

      {plansPdfOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          onMouseDown={() => {
            if (!plansPdfBusy) setPlansPdfOpen(false);
          }}
        >
          <section className={`${styles.modalPanel} ${styles.reservePdfModalWeb} ${styles.plansPdfModalWeb}`} onMouseDown={event => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Export PDF</p>
                <h2>Plans</h2>
                <span>
                  {plansPdfScope === 'plan'
                    ? `Plan : ${selectedPlan?.name ?? '—'}`
                    : 'Rapport global du chantier avec les réserves par bâtiment et par plan.'}
                </span>
              </div>
              <button type="button" onClick={() => setPlansPdfOpen(false)} disabled={plansPdfBusy}>Fermer</button>
            </div>
            <div className={styles.reservePdfBodyWeb}>
              <section className={styles.reservePdfSectionWeb}>
                <strong>Périmètre</strong>
                <div className={`${styles.reservePdfScopeGridWeb} ${styles.plansPdfScopeGridWeb}`}>
                  {[
                    { key: 'plan' as const, label: 'Ce plan', hint: selectedPlan?.name ?? 'Aucun plan', count: exportablePlanReserves.length },
                    { key: 'global' as const, label: 'Rapport global', hint: 'Tous bâtiments et plans', count: exportableProjectReserves.length },
                  ].map(option => (
                    <button
                      key={option.key}
                      type="button"
                      className={plansPdfScope === option.key ? styles.reservePdfScopeActiveWeb : ''}
                      disabled={plansPdfBusy || (option.key === 'plan' && !selectedPlan)}
                      onClick={() => setPlansPdfScope(option.key)}
                    >
                      <span>{option.label}</span>
                      <small>{option.hint}</small>
                      <em>{option.count}</em>
                    </button>
                  ))}
                </div>
              </section>

              {plansPdfScope === 'plan' ? (
                <>
                  <section className={styles.reservePdfSectionWeb}>
                    <strong>Réserves du plan</strong>
                    <div className={styles.plansPdfModeGridWeb}>
                      {[
                        { key: 'all' as const, label: 'Toutes', count: exportablePlanReserves.length },
                        { key: 'company_single' as const, label: 'Une entreprise', count: plansPdfCompanySingle ? exportablePlanReserves.filter((reserve: any) => reserveMatchesCompanyName(reserve, plansPdfCompanySingle)).length : 0 },
                        { key: 'company_multi' as const, label: 'Plusieurs', count: plansPdfCompaniesMulti.size ? exportablePlanReserves.filter((reserve: any) => reserveCompanies(reserve).some(company => plansPdfCompaniesMulti.has(company))).length : 0 },
                        { key: 'manual' as const, label: 'Sélection', count: plansPdfManualSelection.size },
                      ].map(option => (
                        <button
                          key={option.key}
                          type="button"
                          className={plansPdfMode === option.key ? styles.reservePdfLangActiveWeb : ''}
                          disabled={plansPdfBusy || (option.key !== 'all' && exportablePlanReserves.length === 0)}
                          onClick={() => {
                            setPlansPdfMode(option.key);
                            if (option.key === 'company_single' && !plansPdfCompanySingle) {
                              setPlansPdfCompanySingle(planPdfCompanies[0]?.name ?? '');
                            }
                            if (option.key === 'company_multi' && plansPdfCompaniesMulti.size === 0 && planPdfCompanies[0]) {
                              setPlansPdfCompaniesMulti(new Set([planPdfCompanies[0].name]));
                            }
                          }}
                        >
                          <span>{option.label}</span>
                          <em>{option.count}</em>
                        </button>
                      ))}
                    </div>
                  </section>

                  {plansPdfMode === 'company_single' && (
                    <section className={styles.reservePdfSectionWeb}>
                      <strong>Entreprise</strong>
                      <select value={plansPdfCompanySingle} onChange={event => setPlansPdfCompanySingle(event.target.value)} disabled={plansPdfBusy}>
                        <option value="">Choisir une entreprise</option>
                        {planPdfCompanies.map(company => (
                          <option key={company.name} value={company.name}>{company.name} ({company.count})</option>
                        ))}
                      </select>
                    </section>
                  )}

                  {plansPdfMode === 'company_multi' && (
                    <section className={styles.reservePdfSectionWeb}>
                      <div className={styles.reservePdfSectionHeaderWeb}>
                        <strong>Entreprises</strong>
                        <div>
                          <button type="button" onClick={() => setPlansPdfCompaniesMulti(new Set(planPdfCompanies.map(company => company.name)))} disabled={plansPdfBusy}>Tout</button>
                          <button type="button" onClick={() => setPlansPdfCompaniesMulti(new Set())} disabled={plansPdfBusy}>Effacer</button>
                        </div>
                      </div>
                      <div className={styles.reservePdfCompanyGridWeb}>
                        {planPdfCompanies.map(company => {
                          const checked = plansPdfCompaniesMulti.has(company.name);
                          return (
                            <button
                              key={company.name}
                              type="button"
                              className={checked ? styles.reservePdfCompanyActiveWeb : ''}
                              disabled={plansPdfBusy}
                              onClick={() => {
                                setPlansPdfCompaniesMulti(prev => {
                                  const next = new Set(prev);
                                  if (next.has(company.name)) next.delete(company.name);
                                  else next.add(company.name);
                                  return next;
                                });
                              }}
                            >
                              <span>{checked ? '✓' : ''}</span>
                              <strong>{company.name}</strong>
                              <em>{company.count}</em>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {plansPdfMode === 'manual' && (
                    <section className={styles.reservePdfSectionWeb}>
                      <div className={styles.reservePdfSectionHeaderWeb}>
                        <strong>Sélection manuelle</strong>
                        <div>
                          <button type="button" onClick={() => setPlansPdfManualSelection(new Set(exportablePlanReserves.map((reserve: any) => String(reserve.id))))} disabled={plansPdfBusy}>Tout</button>
                          <button type="button" onClick={() => setPlansPdfManualSelection(new Set())} disabled={plansPdfBusy}>Effacer</button>
                        </div>
                      </div>
                      <div className={styles.reservePdfCompanyGridWeb}>
                        {exportablePlanReserves.map((reserve: any, index: number) => {
                          const checked = plansPdfManualSelection.has(String(reserve.id));
                          return (
                            <button
                              key={reserve.id}
                              type="button"
                              className={checked ? styles.reservePdfCompanyActiveWeb : ''}
                              disabled={plansPdfBusy}
                              onClick={() => {
                                setPlansPdfManualSelection(prev => {
                                  const next = new Set(prev);
                                  const id = String(reserve.id);
                                  if (next.has(id)) next.delete(id);
                                  else next.add(id);
                                  return next;
                                });
                              }}
                            >
                              <span>{checked ? '✓' : ''}</span>
                              <strong>{index + 1}. {reserve.title}</strong>
                              <em>{reserve.id}</em>
                            </button>
                          );
                        })}
                        {!exportablePlanReserves.length && <p className={styles.empty}>Aucune réserve sur ce plan.</p>}
                      </div>
                    </section>
                  )}
                </>
              ) : (
                <>
                  <section className={styles.reservePdfSectionWeb}>
                    <strong>Entreprise</strong>
                    <div className={styles.reservePdfCompanyGridWeb}>
                      <button
                        type="button"
                        className={plansPdfGlobalCompany === null ? styles.reservePdfCompanyActiveWeb : ''}
                        disabled={plansPdfBusy}
                        onClick={() => setPlansPdfGlobalCompany(null)}
                      >
                        <span>{plansPdfGlobalCompany === null ? '✓' : ''}</span>
                        <strong>Toutes les entreprises</strong>
                        <em>{exportableProjectReserves.length}</em>
                      </button>
                      {globalPdfCompanies.map(company => (
                        <button
                          key={company.name}
                          type="button"
                          className={plansPdfGlobalCompany === company.name ? styles.reservePdfCompanyActiveWeb : ''}
                          disabled={plansPdfBusy}
                          onClick={() => setPlansPdfGlobalCompany(company.name)}
                        >
                          <span>{plansPdfGlobalCompany === company.name ? '✓' : ''}</span>
                          <strong>{company.name}</strong>
                          <em>{company.count}</em>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className={styles.reservePdfSectionWeb}>
                    <div className={styles.reservePdfSectionHeaderWeb}>
                      <strong>Filtrer par statut</strong>
                      <div>
                        <button type="button" onClick={() => setPlansPdfStatusFilter(new Set())} disabled={plansPdfBusy}>Tous</button>
                      </div>
                    </div>
                    <div className={styles.plansPdfStatusGridWeb}>
                      {STATUS_OPTIONS.map(([status, label]) => {
                        const checked = plansPdfStatusFilter.has(status);
                        return (
                          <button
                            key={status}
                            type="button"
                            className={checked ? styles.reservePdfLangActiveWeb : ''}
                            disabled={plansPdfBusy}
                            onClick={() => {
                              setPlansPdfStatusFilter(prev => {
                                const next = new Set(prev);
                                if (next.has(status)) next.delete(status);
                                else next.add(status);
                                return next;
                              });
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}

              <section className={styles.reservePdfSectionWeb}>
                <strong>Langue du PDF</strong>
                <div className={styles.reservePdfLangRowWeb}>
                  {TEXT_LANG_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={plansPdfLanguage === option.value ? styles.reservePdfLangActiveWeb : ''}
                      disabled={plansPdfBusy}
                      onClick={() => setPlansPdfLanguage(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <div className={styles.reservePdfPreviewWeb}>
                <div>
                  <strong>{plansPdfTargetReserves.length}</strong>
                  <span>réserves seront exportées</span>
                </div>
                <small>{plansPdfTargetPlans.length} plan{plansPdfTargetPlans.length > 1 ? 's' : ''} · {plansPdfLanguage.toUpperCase()}</small>
              </div>

              <div className={styles.reservePdfActionsWeb}>
                <button type="button" onClick={() => setPlansPdfOpen(false)} disabled={plansPdfBusy}>Annuler</button>
                <button
                  type="button"
                  className={styles.reservePdfPrimaryWeb}
                  disabled={plansPdfBusy || plansPdfTargetReserves.length === 0}
                  onClick={() => void handlePlansPdfExport()}
                >
                  {plansPdfBusy ? 'Génération...' : 'Télécharger PDF'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function VisitesView({
  data,
  visites,
  reserves,
  companies,
  onCreateVisit,
  onCreateReserveFromVisit,
  onOpenReserve,
  onUnlinkReserve,
  onAttachReserves,
  onArchiveReserve,
  onDeleteReserve,
  onUpdateVisit,
  onDeleteVisit,
  onGenerateVisitReport,
  generatingReport,
  restricted,
  editable,
}: any) {
  const [statusFilter, setStatusFilter] = useState<'all' | VisitDraft['status']>('all');
  const [selectedVisitId, setSelectedVisitId] = useState<string>('');
  const [attachVisitId, setAttachVisitId] = useState<string>('');
  const [attachSearch, setAttachSearch] = useState('');
  const [attachScopeOnly, setAttachScopeOnly] = useState(true);
  const [attachSelectedIds, setAttachSelectedIds] = useState<string[]>([]);
  const [reportLanguage, setReportLanguage] = useState<'fr' | 'en' | 'es'>('fr');
  const [locationVisitId, setLocationVisitId] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [locationDraft, setLocationDraft] = useState<{
    building: string;
    level: string;
    zone: string;
    defaultPlanId: string;
    visitedLocations: VisitDraft['visitedLocations'];
  }>({ building: '', level: '', zone: '', defaultPlanId: '', visitedLocations: [] });
  const [signatureVisitId, setSignatureVisitId] = useState('');
  const [signatureTab, setSignatureTab] = useState<'conducteur' | 'entreprise'>('conducteur');
  const [signatureData, setSignatureData] = useState<{ conducteur?: string | null; entreprise?: string | null }>({});
  const [signatureDrawing, setSignatureDrawing] = useState(false);
  const [signatureStrokes, setSignatureStrokes] = useState(0);
  const [signatureName, setSignatureName] = useState('');
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  function visitStatus(visit: any): VisitDraft['status'] {
    return (visit?.status ?? 'planned') as VisitDraft['status'];
  }

  function visitType(visit: any): VisitDraft['visitType'] {
    return (visit?.visit_type ?? visit?.visitType ?? 'controle') as VisitDraft['visitType'];
  }

  function visitChecklist(visit: any): Array<{ id: string; label: string; checked: boolean }> {
    return Array.isArray(visit?.checklist_items)
      ? visit.checklist_items
      : Array.isArray(visit?.checklistItems)
        ? visit.checklistItems
        : [];
  }

  function visitParticipants(visit: any): any[] {
    return Array.isArray(visit?.participants) ? visit.participants : [];
  }

  function visitTags(visit: any): string[] {
    return Array.isArray(visit?.tags) ? visit.tags : [];
  }

  function visitReserveIds(visit: any) {
    return new Set(Array.isArray(visit?.reserve_ids) ? visit.reserve_ids : Array.isArray(visit?.reserveIds) ? visit.reserveIds : []);
  }

  function visitReserves(visit: any) {
    const ids = visitReserveIds(visit);
    return reserves.filter((reserve: any) => reserve.visite_id === visit.id || reserve.visiteId === visit.id || ids.has(reserve.id));
  }

  function visitLocationLabel(visit: any) {
    const locations = getVisitLocations(visit);
    if (locations.length) {
      const names = locations.map(location => location.buildingName || location.building_name).filter(Boolean);
      if (names.length === 1) return names[0];
      return `${names.length} bâtiments`;
    }
    return [visit.building, visit.level, visit.zone].filter(Boolean).join(' · ') || 'Périmètre chantier';
  }

  function visitCompanyNames(visit: any) {
    return getVisitCompanyIds(visit)
      .map(companyId => companies.find((company: any) => company.id === companyId)?.name)
      .filter(Boolean);
  }

  function timeRange(visit: any) {
    return [visit.start_time ?? visit.startTime, visit.end_time ?? visit.endTime].filter(Boolean).join(' → ');
  }

  const sortedVisits = useMemo(() => [...visites].sort((a: any, b: any) => {
    const dateDiff = new Date(b.date ?? b.created_at ?? 0).getTime() - new Date(a.date ?? a.created_at ?? 0).getTime();
    return dateDiff || String(a.title ?? '').localeCompare(String(b.title ?? ''), 'fr');
  }), [visites]);

  const visibleVisits = useMemo(() => (
    statusFilter === 'all'
      ? sortedVisits
      : sortedVisits.filter((visit: any) => visitStatus(visit) === statusFilter)
  ), [sortedVisits, statusFilter]);

  const selectedVisit = sortedVisits.find((visit: any) => visit.id === selectedVisitId)
    ?? visibleVisits[0]
    ?? sortedVisits[0]
    ?? null;
  const selectedVisitReserves = selectedVisit ? visitReserves(selectedVisit) : [];
  const attachVisit = sortedVisits.find((visit: any) => visit.id === attachVisitId) ?? null;
  const attachVisitReserveIds = attachVisit ? visitReserveIds(attachVisit) : new Set<string>();
  const attachVisitedNames = new Set(getVisitLocations(attachVisit).map(location => location.buildingName || location.building_name).filter(Boolean));
  if (attachVisit?.building) attachVisitedNames.add(attachVisit.building);
  const attachableReserves = reserves
    .filter((reserve: any) => {
      if (!attachVisit) return false;
      if (reserve.visite_id === attachVisit.id || reserve.visiteId === attachVisit.id || attachVisitReserveIds.has(reserve.id)) return false;
      if (attachVisit.chantier_id && reserve.chantier_id && reserve.chantier_id !== attachVisit.chantier_id) return false;
      if (attachScopeOnly && attachVisitedNames.size && reserve.building && !attachVisitedNames.has(reserve.building)) return false;
      const q = normalizeSearchText(attachSearch);
      if (!q) return true;
      return normalizeSearchText([
        reserve.id,
        reserve.title,
        reserve.description,
        reserve.company,
        ...(reserve.companies ?? []),
        reserve.building,
        reserve.level,
        reserve.zone,
      ].join(' ')).includes(q);
    })
    .slice(0, 80);

  const locationVisit = sortedVisits.find((visit: any) => visit.id === locationVisitId) ?? null;
  const locationProjectId = locationVisit?.chantier_id ?? locationVisit?.chantierId ?? '';
  const locationProject = data?.chantiers?.find((project: any) => project.id === locationProjectId) ?? null;
  const locationBuildings = projectBuildings(locationProject);
  const locationPlans = (data?.sitePlans ?? []).filter((plan: any) => getChantierId(plan) === locationProjectId);
  const locationHasHierarchy = locationBuildings.length > 0;
  const selectedLocationIds = new Set(locationDraft.visitedLocations.map(location => location.buildingId).filter(Boolean));
  const filteredLocationBuildings = locationBuildings.filter((building: any) => {
    const q = normalizeSearchText(locationSearch);
    if (!q) return true;
    return normalizeSearchText(building.name).includes(q) ||
      (building.levels ?? []).some((level: any) => normalizeSearchText(level.name).includes(q));
  });
  const signatureVisit = sortedVisits.find((visit: any) => visit.id === signatureVisitId) ?? null;

  useEffect(() => {
    if (!signatureVisit) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(520, Math.floor((rect.width || 520) * ratio));
    const height = Math.max(180, Math.floor((rect.height || 180) * ratio));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    const dataUrl = signatureTab === 'conducteur' ? signatureData.conducteur : signatureData.entreprise;
    if (dataUrl) {
      const image = new Image();
      image.onload = () => {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, (rect.width || 520), (rect.height || 180));
      };
      image.src = dataUrl;
    }
  }, [signatureVisit, signatureTab, signatureData.conducteur, signatureData.entreprise]);

  const stats = {
    total: sortedVisits.length,
    planned: sortedVisits.filter((visit: any) => visitStatus(visit) === 'planned').length,
    in_progress: sortedVisits.filter((visit: any) => visitStatus(visit) === 'in_progress').length,
    completed: sortedVisits.filter((visit: any) => visitStatus(visit) === 'completed').length,
  };

  function openAttachModal(visit: any) {
    setAttachVisitId(visit.id);
    setAttachSearch('');
    setAttachScopeOnly(true);
    setAttachSelectedIds([]);
  }

  function toggleAttachSelection(reserveId: string) {
    setAttachSelectedIds(prev => prev.includes(reserveId) ? prev.filter(id => id !== reserveId) : [...prev, reserveId]);
  }

  async function applyAttach() {
    if (!attachVisit || !attachSelectedIds.length) return;
    await onAttachReserves(attachVisit, attachSelectedIds);
    setAttachVisitId('');
    setAttachSelectedIds([]);
  }

  function toggleChecklist(visit: any, itemId: string) {
    const nextChecklist = visitChecklist(visit).map(item => item.id === itemId ? { ...item, checked: !item.checked } : item);
    onUpdateVisit(visit, {
      checklist_items: nextChecklist,
      status: visitStatus(visit) === 'planned' ? 'in_progress' : visitStatus(visit),
    });
  }

  function openLocationModal(visit: any) {
    const locations = getVisitLocations(visit)
      .map(location => ({
        buildingId: location.buildingId ?? location.building_id,
        buildingName: location.buildingName ?? location.building_name ?? location.name ?? '',
        defaultPlanId: location.defaultPlanId ?? location.default_plan_id,
      }))
      .filter(location => location.buildingName);
    setLocationVisitId(visit.id);
    setLocationSearch('');
    setLocationDraft({
      building: visit.building ?? '',
      level: visit.level ?? '',
      zone: visit.zone ?? '',
      defaultPlanId: getVisitDefaultPlanId(visit),
      visitedLocations: locations,
    });
  }

  function toggleLocationBuilding(building: any) {
    setLocationDraft(prev => {
      const exists = prev.visitedLocations.some(location => location.buildingId === building.id);
      return {
        ...prev,
        visitedLocations: exists
          ? prev.visitedLocations.filter(location => location.buildingId !== building.id)
          : [...prev.visitedLocations, { buildingId: building.id, buildingName: building.name }],
      };
    });
  }

  function selectLocationBuildings() {
    const source = locationSearch.trim() ? filteredLocationBuildings : locationBuildings;
    setLocationDraft(prev => {
      const selected = new Set(prev.visitedLocations.map(location => location.buildingId).filter(Boolean));
      const additions = source
        .filter((building: any) => !selected.has(building.id))
        .map((building: any) => ({ buildingId: building.id, buildingName: building.name }));
      return { ...prev, visitedLocations: [...prev.visitedLocations, ...additions] };
    });
  }

  function plansForLocationBuilding(building: any) {
    return locationPlans.filter((plan: any) =>
      getPlanBuildingId(plan) === building.id ||
      (!getPlanBuildingId(plan) && getPlanBuildingName(plan) === building.name)
    );
  }

  function updateLocationPlan(buildingId: string, planId: string) {
    setLocationDraft(prev => ({
      ...prev,
      visitedLocations: prev.visitedLocations.map(location =>
        location.buildingId === buildingId ? { ...location, defaultPlanId: planId || undefined } : location
      ),
    }));
  }

  async function applyLocationEdit() {
    if (!locationVisit) return;
    if (locationHasHierarchy && !locationDraft.visitedLocations.length) {
      window.alert('Sélectionnez au moins un bâtiment pour le périmètre de visite.');
      return;
    }
    const singleLocation = locationHasHierarchy && locationDraft.visitedLocations.length === 1
      ? locationDraft.visitedLocations[0]
      : null;
    await onUpdateVisit(locationVisit, {
      visited_locations: locationHasHierarchy ? locationDraft.visitedLocations : null,
      building: locationHasHierarchy ? (singleLocation?.buildingName ?? null) : (locationDraft.building || null),
      level: locationHasHierarchy ? null : (locationDraft.level || null),
      zone: locationHasHierarchy ? null : (locationDraft.zone || null),
      default_plan_id: locationHasHierarchy ? (singleLocation?.defaultPlanId ?? null) : (locationDraft.defaultPlanId || null),
    });
    setLocationVisitId('');
  }

  function openSignatureModal(visit: any) {
    setSignatureVisitId(visit.id);
    setSignatureTab('conducteur');
    setSignatureData({
      conducteur: visit.conducteur_signature ?? visit.conducteurSignature ?? null,
      entreprise: visit.entreprise_signature ?? visit.entrepriseSignature ?? null,
    });
    setSignatureName(visit.entreprise_signataire ?? visit.entrepriseSignataire ?? '');
    setSignatureStrokes(0);
  }

  function signaturePoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function beginSignature(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = signaturePoint(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setSignatureDrawing(true);
  }

  function drawSignature(event: PointerEvent<HTMLCanvasElement>) {
    if (!signatureDrawing) return;
    const ctx = signatureCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = signaturePoint(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endSignature() {
    const canvas = signatureCanvasRef.current;
    if (!signatureDrawing || !canvas) return;
    setSignatureDrawing(false);
    const dataUrl = canvas.toDataURL('image/png');
    setSignatureData(prev => ({ ...prev, [signatureTab]: dataUrl }));
    setSignatureStrokes(prev => prev + 1);
  }

  function clearSignature() {
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData(prev => ({ ...prev, [signatureTab]: null }));
  }

  async function saveSignature() {
    if (!signatureVisit) return;
    if (!signatureData.conducteur && !signatureData.entreprise) {
      window.alert('Ajoutez au moins une signature avant d’enregistrer.');
      return;
    }
    if (signatureData.entreprise && !signatureName.trim()) {
      window.alert('Renseignez le nom du signataire entreprise.');
      return;
    }
    await onUpdateVisit(signatureVisit, {
      conducteur_signature: signatureData.conducteur ?? null,
      entreprise_signature: signatureData.entreprise ?? null,
      entreprise_signataire: signatureName.trim() || null,
      signed_at: todayISO(),
      status: 'completed',
    });
    setSignatureVisitId('');
  }

  if (restricted) {
    return (
      <section className={styles.panel}>
        <div className={styles.restrictedState}>
          <span>🔒</span>
          <strong>Visites réservées à l’équipe chantier</strong>
          <p>Les sous-traitants consultent leurs réserves et échanges, mais ne pilotent pas les comptes rendus de visite.</p>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.visitesWorkspace}>
      <section className={styles.visitesListPanel}>
        <div className={styles.visitPanelHeader}>
          <div>
            <p className={styles.eyebrow}>Visites chantier</p>
            <h2>Visites</h2>
          </div>
          {editable ? <button type="button" onClick={onCreateVisit}>Créer</button> : null}
        </div>
        <div className={styles.visitStatsGrid}>
          {[
            { key: 'all' as const, label: 'Total', value: stats.total },
            { key: 'planned' as const, label: 'Planifiées', value: stats.planned },
            { key: 'in_progress' as const, label: 'En cours', value: stats.in_progress },
            { key: 'completed' as const, label: 'Terminées', value: stats.completed },
          ].map(item => (
            <button
              key={item.key}
              type="button"
              className={statusFilter === item.key ? styles.visitStatActive : styles.visitStat}
              onClick={() => setStatusFilter(item.key)}
            >
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className={styles.visitFilterChips}>
          {(['all', 'planned', 'in_progress', 'completed'] as const).map(key => (
            <button
              key={key}
              type="button"
              className={statusFilter === key ? styles.chipActive : styles.chip}
              onClick={() => setStatusFilter(key)}
            >
              {key === 'all' ? 'Toutes' : VISIT_STATUS_LABELS[key]}
            </button>
          ))}
        </div>
        <div className={styles.visitCardsList}>
          {visibleVisits.map((visit: any) => {
            const type = VISIT_TYPE_OPTIONS.find(option => option.value === visitType(visit)) ?? VISIT_TYPE_OPTIONS[0];
            const status = visitStatus(visit);
            const cardReserves = visitReserves(visit);
            const checklist = visitChecklist(visit);
            const done = checklist.filter(item => item.checked).length;
            const selected = selectedVisit?.id === visit.id;
            return (
              <button
                key={visit.id}
                type="button"
                className={selected ? styles.visitCardActive : styles.visitCard}
                onClick={() => setSelectedVisitId(visit.id)}
              >
                <div className={styles.visitCardTop}>
                  <span className={styles.visitTypePill} style={{ color: type.color, background: `${type.color}16` }}>{type.label}</span>
                  <span className={`${styles.visitStatusPill} ${styles[`visitStatus_${status}`] ?? ''}`}>{VISIT_STATUS_LABELS[status]}</span>
                </div>
                <strong>{visit.title}</strong>
                <small>{prettyDate(visit.date)}{timeRange(visit) ? ` · ${timeRange(visit)}` : ''}</small>
                <span>{visitLocationLabel(visit)}</span>
                <div className={styles.visitCardFooter}>
                  <em>{cardReserves.length} réserve{cardReserves.length > 1 ? 's' : ''}</em>
                  <em>{checklist.length ? `${done}/${checklist.length} checklist` : 'Sans checklist'}</em>
                </div>
              </button>
            );
          })}
          {!visibleVisits.length && <p className={styles.empty}>Aucune visite dans cette vue.</p>}
        </div>
      </section>

      <section className={styles.visitDetailPanel}>
        {selectedVisit ? (
          <>
            <div className={styles.visitDetailHeader}>
              <div>
                <p className={styles.eyebrow}>{VISIT_TYPE_LABELS[visitType(selectedVisit)]}</p>
                <h2>{selectedVisit.title}</h2>
                <span>{prettyDate(selectedVisit.date)}{timeRange(selectedVisit) ? ` · ${timeRange(selectedVisit)}` : ''}</span>
              </div>
              <div className={styles.visitDetailActions}>
                <select
                  value={visitStatus(selectedVisit)}
                  onChange={event => onUpdateVisit(selectedVisit, { status: event.target.value })}
                  disabled={!editable}
                >
                  {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {editable ? <button type="button" onClick={() => onDeleteVisit(selectedVisit)}>Supprimer</button> : null}
              </div>
            </div>

            {selectedVisit.cover_photo_uri || selectedVisit.coverPhotoUri ? (
              <img className={styles.visitCoverHero} src={assetUrl({ uri: selectedVisit.cover_photo_uri ?? selectedVisit.coverPhotoUri }, 'photos')} alt="Photo de couverture de la visite" />
            ) : null}

            <div className={styles.visitInfoGrid}>
              <div><span>Conducteur</span><strong>{selectedVisit.conducteur || 'Non renseigné'}</strong></div>
              <div><span>Périmètre</span><strong>{visitLocationLabel(selectedVisit)}</strong></div>
              <div><span>Entreprises</span><strong>{visitCompanyNames(selectedVisit).join(', ') || 'Aucune'}</strong></div>
              <div><span>Délai cible</span><strong>{getVisitReserveDeadline(selectedVisit) || 'Non défini'}</strong></div>
              <div><span>Réserves</span><strong>{selectedVisitReserves.length}</strong></div>
              <div><span>Signatures</span><strong>{selectedVisit.signed_at || selectedVisit.signedAt ? 'Signée' : 'Non signée'}</strong></div>
            </div>
            {editable ? (
              <div className={styles.visitDetailQuickActions}>
                <button type="button" onClick={() => openLocationModal(selectedVisit)}>Modifier la localisation</button>
                <button type="button" onClick={() => openSignatureModal(selectedVisit)}>
                  {selectedVisit.signed_at || selectedVisit.signedAt ? 'Voir / modifier les signatures' : 'Signer la visite'}
                </button>
              </div>
            ) : null}

            {selectedVisit.notes ? (
              <section className={styles.visitDetailBlock}>
                <h3>Notes et objectifs</h3>
                <p>{selectedVisit.notes}</p>
              </section>
            ) : null}

            {visitTags(selectedVisit).length ? (
              <div className={styles.visitTagList}>
                {visitTags(selectedVisit).map(tag => <span key={tag}>{tag}</span>)}
              </div>
            ) : null}

            <section className={styles.visitDetailBlock}>
              <div className={styles.visitBlockHeader}>
                <div>
                  <h3>Checklist de contrôle</h3>
                  <span>{visitChecklist(selectedVisit).filter(item => item.checked).length}/{visitChecklist(selectedVisit).length} points validés</span>
                </div>
              </div>
              <div className={styles.visitChecklistWeb}>
                {visitChecklist(selectedVisit).map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.checked ? styles.visitChecklistDone : styles.visitChecklistTodo}
                    disabled={!editable}
                    onClick={() => toggleChecklist(selectedVisit, item.id)}
                  >
                    <span>{item.checked ? '✓' : ''}</span>
                    {item.label}
                  </button>
                ))}
                {!visitChecklist(selectedVisit).length && <p className={styles.empty}>Aucune checklist associée.</p>}
              </div>
            </section>

            <section className={styles.visitDetailBlock}>
              <div className={styles.visitBlockHeader}>
                <div>
                  <h3>Participants</h3>
                  <span>{visitParticipants(selectedVisit).length} personne{visitParticipants(selectedVisit).length > 1 ? 's' : ''}</span>
                </div>
              </div>
              <div className={styles.visitParticipantGridWeb}>
                {visitParticipants(selectedVisit).map(participant => (
                  <article key={participant.id ?? participant.name}>
                    <strong>{participant.name}</strong>
                    <span>{[participant.role, participant.company, participant.email].filter(Boolean).join(' · ') || 'Participant'}</span>
                  </article>
                ))}
                {!visitParticipants(selectedVisit).length && <p className={styles.empty}>Aucun participant renseigné.</p>}
              </div>
            </section>

            <section className={styles.visitDetailBlock}>
              <div className={styles.visitBlockHeader}>
                <div>
                  <h3>Réserves de la visite</h3>
                  <span>{selectedVisitReserves.length} rattachée{selectedVisitReserves.length > 1 ? 's' : ''}</span>
                </div>
                {editable ? (
                  <div className={styles.visitInlineActions}>
                    <button type="button" onClick={() => openAttachModal(selectedVisit)}>Rattacher existante</button>
                    <button type="button" onClick={() => onCreateReserveFromVisit(selectedVisit)}>Nouvelle réserve</button>
                  </div>
                ) : null}
              </div>
              <div className={styles.visitReserveListWeb}>
                {selectedVisitReserves.map((reserve: any) => (
                  <article key={reserve.id}>
                    <button type="button" onClick={() => onOpenReserve(reserve)}>
                      <strong>{reserve.id}</strong>
                      <span>{reserve.title}</span>
                      <small>{[STATUS_LABELS[reserve.status] ?? reserve.status, reserve.company, reserve.building].filter(Boolean).join(' · ')}</small>
                    </button>
                    {editable ? (
                      <div>
                        <button type="button" onClick={() => onUnlinkReserve(selectedVisit, reserve)}>Délier</button>
                        <button type="button" onClick={() => onArchiveReserve(reserve)}>{reserve.archived_at ? 'Désarchiver' : 'Archiver'}</button>
                        <button type="button" onClick={() => onDeleteReserve(reserve)}>Supprimer</button>
                      </div>
                    ) : null}
                  </article>
                ))}
                {!selectedVisitReserves.length && <p className={styles.empty}>Aucune réserve rattachée à cette visite.</p>}
              </div>
            </section>

            <section className={styles.visitReportCardWeb}>
              <div>
                <strong>Compte-rendu PDF</strong>
                <span>Structure, checklist, réserves rattachées et photos, comme sur mobile.</span>
              </div>
              <div className={styles.visitReportControls}>
                {(['fr', 'en', 'es'] as const).map(language => (
                  <button
                    key={language}
                    type="button"
                    className={reportLanguage === language ? styles.chipActive : styles.chip}
                    onClick={() => setReportLanguage(language)}
                  >
                    {language.toUpperCase()}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onGenerateVisitReport(selectedVisit, reportLanguage)}
                  disabled={generatingReport === `visit_report-${reportLanguage}`}
                >
                  {generatingReport === `visit_report-${reportLanguage}` ? 'Génération...' : 'Exporter PDF'}
                </button>
              </div>
            </section>
          </>
        ) : (
          <p className={styles.empty}>Sélectionnez une visite.</p>
        )}
      </section>

      {locationVisit ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={`${styles.modalPanel} ${styles.visitLocationModal}`}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Périmètre de visite</p>
                <h2>Modifier la localisation</h2>
                <span>{locationVisit.title}</span>
              </div>
              <button type="button" onClick={() => setLocationVisitId('')}>Fermer</button>
            </div>
            <div className={styles.reserveModalBody}>
              {locationHasHierarchy ? (
                <>
                  <section className={styles.reserveFormSection}>
                    <div className={styles.reserveFormSectionHeader}>
                      <div>
                        <strong>Bâtiments visités</strong>
                        <span>Ce périmètre limite ensuite la création de réserves depuis cette visite.</span>
                      </div>
                      <span className={styles.reserveCountPill}>{locationDraft.visitedLocations.length} / {locationBuildings.length}</span>
                    </div>
                    <div className={styles.visitBuildingToolbar}>
                      <div className={styles.visitSearch}>
                        <span>⌕</span>
                        <input value={locationSearch} onChange={event => setLocationSearch(event.target.value)} placeholder="Rechercher bâtiment ou niveau..." />
                      </div>
                      <button type="button" onClick={selectLocationBuildings}>
                        {locationSearch.trim() ? 'Sélectionner les résultats' : 'Tout sélectionner'}
                      </button>
                      <button type="button" disabled={!locationDraft.visitedLocations.length} onClick={() => setLocationDraft(prev => ({ ...prev, visitedLocations: [] }))}>
                        Effacer
                      </button>
                    </div>
                    {locationDraft.visitedLocations.length ? (
                      <div className={styles.visitSelectedLocations}>
                        {locationDraft.visitedLocations.slice(0, 12).map(location => (
                          <button
                            key={location.buildingId ?? location.buildingName}
                            type="button"
                            onClick={() => setLocationDraft(prev => ({
                              ...prev,
                              visitedLocations: prev.visitedLocations.filter(item =>
                                location.buildingId ? item.buildingId !== location.buildingId : item.buildingName !== location.buildingName
                              ),
                            }))}
                          >
                            {location.buildingName} ×
                          </button>
                        ))}
                        {locationDraft.visitedLocations.length > 12 ? <span>+{locationDraft.visitedLocations.length - 12}</span> : null}
                      </div>
                    ) : null}
                    <div className={styles.visitBuildingGrid}>
                      {filteredLocationBuildings.map((building: any) => {
                        const active = selectedLocationIds.has(building.id);
                        return (
                          <button
                            key={building.id}
                            type="button"
                            className={active ? styles.visitBuildingCardActive : styles.visitBuildingCard}
                            onClick={() => toggleLocationBuilding(building)}
                          >
                            <span className={styles.visitBuildingIcon}>{active ? '✓' : '▦'}</span>
                            <strong>{building.name}</strong>
                            <small>{(building.levels ?? []).length} niveaux</small>
                          </button>
                        );
                      })}
                      {!filteredLocationBuildings.length ? <p className={styles.empty}>Aucun bâtiment trouvé.</p> : null}
                    </div>
                  </section>
                  {locationDraft.visitedLocations.length ? (
                    <section className={styles.reserveFormSection}>
                      <div className={styles.reserveFormSectionHeader}>
                        <div>
                          <strong>Plans par défaut</strong>
                          <span>Chaque bâtiment peut préparer le plan proposé lors de la création d’une réserve.</span>
                        </div>
                      </div>
                      <div className={styles.visitLocationPreview}>
                        {locationDraft.visitedLocations.map(location => {
                          const building = locationBuildings.find((item: any) => item.id === location.buildingId || item.name === location.buildingName);
                          const buildingPlans = building ? plansForLocationBuilding(building) : [];
                          return (
                            <div key={location.buildingId ?? location.buildingName} className={styles.visitSelectedLocationCard}>
                              <div>
                                <strong>{location.buildingName}</strong>
                                <small>{buildingPlans.length} plan{buildingPlans.length > 1 ? 's' : ''} disponible{buildingPlans.length > 1 ? 's' : ''}</small>
                              </div>
                              <select
                                value={location.defaultPlanId ?? ''}
                                disabled={!location.buildingId}
                                onChange={event => location.buildingId && updateLocationPlan(location.buildingId, event.target.value)}
                                className={styles.visitPlanSelect}
                              >
                                <option value="">Aucun plan par défaut</option>
                                {buildingPlans.map((plan: any) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : (
                <section className={styles.reserveFormSection}>
                  <div className={styles.reserveFormSectionHeader}>
                    <div>
                      <strong>Localisation simple</strong>
                      <span>Bâtiment, niveau, zone et plan de référence.</span>
                    </div>
                  </div>
                  <div className={styles.reserveModalGrid}>
                    <label>
                      Bâtiment
                      <input value={locationDraft.building} onChange={event => setLocationDraft(prev => ({ ...prev, building: event.target.value }))} />
                    </label>
                    <label>
                      Niveau
                      <input value={locationDraft.level} onChange={event => setLocationDraft(prev => ({ ...prev, level: event.target.value }))} />
                    </label>
                    <label>
                      Zone
                      <input value={locationDraft.zone} onChange={event => setLocationDraft(prev => ({ ...prev, zone: event.target.value }))} />
                    </label>
                    <label>
                      Plan de référence
                      <select value={locationDraft.defaultPlanId} onChange={event => setLocationDraft(prev => ({ ...prev, defaultPlanId: event.target.value }))}>
                        <option value="">Aucun plan</option>
                        {locationPlans.map((plan: any) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                      </select>
                    </label>
                  </div>
                </section>
              )}
            </div>
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setLocationVisitId('')}>Annuler</button>
              <button type="button" onClick={applyLocationEdit}>Enregistrer</button>
            </div>
          </div>
        </div>
      ) : null}

      {signatureVisit ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={`${styles.modalPanel} ${styles.visitSignatureModal}`}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Compte-rendu de visite</p>
                <h2>Signatures</h2>
                <span>{signatureVisit.title}</span>
              </div>
              <button type="button" onClick={() => setSignatureVisitId('')}>Fermer</button>
            </div>
            <div className={styles.reserveModalBody}>
              <div className={styles.visitSignatureTabs}>
                <button type="button" className={signatureTab === 'conducteur' ? styles.segmentedActive : ''} onClick={() => setSignatureTab('conducteur')}>
                  Conducteur
                </button>
                <button type="button" className={signatureTab === 'entreprise' ? styles.segmentedActive : ''} onClick={() => setSignatureTab('entreprise')}>
                  Entreprise
                </button>
              </div>
              <section className={styles.visitSignatureBox}>
                <div className={styles.visitSignatureHeader}>
                  <div>
                    <strong>{signatureTab === 'conducteur' ? (signatureVisit.conducteur || 'Conducteur') : 'Représentant entreprise'}</strong>
                    <span>Signez dans la zone ci-dessous, comme sur mobile.</span>
                  </div>
                  {signatureTab === 'entreprise' ? (
                    <input value={signatureName} onChange={event => setSignatureName(event.target.value)} placeholder="Nom du signataire entreprise" />
                  ) : null}
                </div>
                <canvas
                  ref={signatureCanvasRef}
                  className={styles.visitSignatureCanvas}
                  onPointerDown={beginSignature}
                  onPointerMove={drawSignature}
                  onPointerUp={endSignature}
                  onPointerCancel={endSignature}
                  aria-label="Zone de signature"
                />
                <div className={styles.visitSignatureActions}>
                  <button type="button" onClick={clearSignature}>Effacer cette signature</button>
                  <span>{signatureStrokes > 0 ? 'Signature capturée.' : 'Tracez la signature avec la souris ou le doigt.'}</span>
                </div>
              </section>
            </div>
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setSignatureVisitId('')}>Annuler</button>
              <button type="button" onClick={saveSignature}>Enregistrer les signatures</button>
            </div>
          </div>
        </div>
      ) : null}

      {attachVisit ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={`${styles.modalPanel} ${styles.visitAttachModal}`}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Réserves existantes</p>
                <h2>Rattacher à la visite</h2>
                <span>{attachVisit.title}</span>
              </div>
              <button type="button" onClick={() => setAttachVisitId('')}>Fermer</button>
            </div>
            <div className={styles.reserveModalBody}>
              <div className={styles.visitBuildingToolbar}>
                <div className={styles.visitSearch}>
                  <span>⌕</span>
                  <input value={attachSearch} onChange={event => setAttachSearch(event.target.value)} placeholder="Rechercher ID, titre, entreprise, bâtiment..." />
                </div>
                <button type="button" className={attachScopeOnly ? styles.chipActive : styles.chip} onClick={() => setAttachScopeOnly(prev => !prev)}>
                  Périmètre visite
                </button>
              </div>
              <div className={styles.visitAttachList}>
                {attachableReserves.map((reserve: any) => {
                  const active = attachSelectedIds.includes(reserve.id);
                  return (
                    <button
                      key={reserve.id}
                      type="button"
                      className={active ? styles.visitAttachReserveActive : styles.visitAttachReserve}
                      onClick={() => toggleAttachSelection(reserve.id)}
                    >
                      <span>{active ? '✓' : ''}</span>
                      <strong>{reserve.id}</strong>
                      <div>
                        <b>{reserve.title}</b>
                        <small>{[reserve.company, reserve.building, reserve.level].filter(Boolean).join(' · ')}</small>
                      </div>
                    </button>
                  );
                })}
                {!attachableReserves.length && <p className={styles.empty}>Aucune réserve disponible pour ce périmètre.</p>}
              </div>
            </div>
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setAttachVisitId('')}>Annuler</button>
              <button type="button" onClick={applyAttach} disabled={!attachSelectedIds.length}>
                Rattacher {attachSelectedIds.length ? `(${attachSelectedIds.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
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

function MediaView({ photos, documents, isSubcontractor }: { photos: any[]; documents: any[]; isSubcontractor?: boolean }) {
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
            <p>
              {isSubcontractor
                ? 'Photos liées à vos réserves.'
                : 'Photos, documents et pièces jointes synchronisés depuis le terrain.'}
            </p>
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
      {!isSubcontractor && (
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
      )}
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
            <p>Export structuré avec informations de visite, checklist, notes et réserves rattachées.</p>
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
              {generatingReport === `visit_report-${language}` ? 'Génération...' : 'Télécharger PDF'}
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

type TerrainHubIconName =
  | 'warning'
  | 'eye'
  | 'calendar'
  | 'shield'
  | 'clipboard'
  | 'map'
  | 'people'
  | 'camera'
  | 'document-text'
  | 'shield-checkmark'
  | 'settings';

function TerrainHubIcon({ name }: { name: TerrainHubIconName }) {
  const common = {
    vectorEffect: 'non-scaling-stroke' as const,
  };
  const icons = {
    warning: (
      <>
        <path {...common} d="M11.1 4.4 2.8 18.6A1.7 1.7 0 0 0 4.3 21h15.4a1.7 1.7 0 0 0 1.5-2.4L12.9 4.4a1 1 0 0 0-1.8 0Z" />
        <path {...common} d="M12 8.8v5.2" />
        <path {...common} d="M12 17.2h.01" />
      </>
    ),
    eye: (
      <>
        <path {...common} d="M2.5 12s3.4-6.5 9.5-6.5S21.5 12 21.5 12s-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z" />
        <circle {...common} cx="12" cy="12" r="3.2" />
      </>
    ),
    calendar: (
      <>
        <rect {...common} x="3.5" y="5.2" width="17" height="15.3" rx="2.2" />
        <path {...common} d="M7.8 3.5v3.4M16.2 3.5v3.4M3.8 9.4h16.4" />
        <path {...common} d="M8 13h2M13.8 13h2M8 16.4h2M13.8 16.4h2" />
      </>
    ),
    shield: (
      <>
        <path {...common} d="M12 3.4 4.8 6.2v5.4c0 4.7 3.1 7.7 7.2 9 4.1-1.3 7.2-4.3 7.2-9V6.2L12 3.4Z" />
        <path {...common} d="M12 8.2v5.1" />
        <path {...common} d="M12 16.4h.01" />
      </>
    ),
    clipboard: (
      <>
        <path {...common} d="M9.2 4.5h5.6a2 2 0 0 1 2 2v.7H7.2v-.7a2 2 0 0 1 2-2Z" />
        <path {...common} d="M8 6.3H6.4a2.2 2.2 0 0 0-2.2 2.2v10A2.2 2.2 0 0 0 6.4 20.7h11.2a2.2 2.2 0 0 0 2.2-2.2v-10a2.2 2.2 0 0 0-2.2-2.2H16" />
        <path {...common} d="M8 12h8M8 15.5h5.5" />
      </>
    ),
    map: (
      <>
        <path {...common} d="m3.6 6.2 5.2-2 6.4 2 5.2-2v13.6l-5.2 2-6.4-2-5.2 2V6.2Z" />
        <path {...common} d="M8.8 4.2v13.6M15.2 6.2v13.6" />
      </>
    ),
    people: (
      <>
        <circle {...common} cx="9" cy="8" r="3" />
        <path {...common} d="M3.8 19.5c.7-3 2.6-4.8 5.2-4.8s4.5 1.8 5.2 4.8" />
        <circle {...common} cx="16.2" cy="9.2" r="2.4" />
        <path {...common} d="M14.6 15.1c2.8.1 4.8 1.7 5.6 4.4" />
      </>
    ),
    camera: (
      <>
        <path {...common} d="M4.4 7.6h3l1.2-2h6.8l1.2 2h3a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H4.4a2 2 0 0 1-2-2V9.6a2 2 0 0 1 2-2Z" />
        <circle {...common} cx="12" cy="13.8" r="3.5" />
      </>
    ),
    'document-text': (
      <>
        <path {...common} d="M6.5 3.5h7.7l3.3 3.4v13.6h-11a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
        <path {...common} d="M14 3.8v3.6h3.4M8 11h8M8 14.5h8M8 18h5" />
      </>
    ),
    'shield-checkmark': (
      <>
        <path {...common} d="M12 3.4 4.8 6.2v5.4c0 4.7 3.1 7.7 7.2 9 4.1-1.3 7.2-4.3 7.2-9V6.2L12 3.4Z" />
        <path {...common} d="m8.8 12.4 2.2 2.2 4.4-5" />
      </>
    ),
    settings: (
      <>
        <path {...common} d="M12 8.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z" />
        <path {...common} d="M19.4 13.7c.1-.6.1-1.1 0-1.7l2-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.5-.9L15 4.4h-4L10.6 7a7.4 7.4 0 0 0-1.5.9l-2.5-1-2 3.5 2 1.6a8.4 8.4 0 0 0 0 1.7l-2 1.6 2 3.5 2.5-1c.5.4 1 .7 1.5.9l.4 2.6h4l.4-2.6c.5-.2 1-.5 1.5-.9l2.5 1 2-3.5-2-1.6Z" />
      </>
    ),
  } satisfies Record<TerrainHubIconName, ReactNode>;

  return (
    <svg className={styles.terrainHubIconSvg} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {icons[name]}
    </svg>
  );
}

function TerrainView({ scoped, data, profile, setTab }: any) {
  const isSubcontractor = profile?.role === 'sous_traitant';
  const admin = isAdmin(profile);
  const openIncidents = scoped.incidents.filter((incident: any) => incident.status !== 'resolved' && incident.status !== 'closed').length;
  const delayedTasks = scoped.tasks.filter((task: any) => task.status === 'delayed' || task.status === 'late').length;
  const openReserves = scoped.reserves.filter((reserve: any) => !isReserveArchived(reserve) && reserve.status !== 'closed').length;
  const documentCount = scoped.documents.length + scoped.photos.length;

  type TerrainHubCard = {
    icon: TerrainHubIconName;
    title: string;
    subtitle: string;
    count?: number | string;
    tab?: TabId;
    passive?: boolean;
    tone?: 'green' | 'red' | 'amber' | 'blue';
  };

  const sections: Array<{ title: string; cards: TerrainHubCard[] }> = [
    {
      title: 'Terrain quotidien',
      cards: isSubcontractor
        ? [
            { icon: 'warning', title: 'Mes réserves', subtitle: 'Réserves à traiter', count: openReserves, tab: 'reserves', tone: 'amber' },
          ]
        : [
            { icon: 'eye', title: 'Visites chantier', subtitle: 'Contrôles, CR et réserves liées', count: scoped.visites.length, tab: 'visites', tone: 'blue' },
            { icon: 'calendar', title: 'Planning', subtitle: delayedTasks ? `${delayedTasks} tâche(s) en retard` : 'Tâches et échéances', count: scoped.tasks.length, tab: 'planning', tone: delayedTasks ? 'red' : 'green' },
            { icon: 'shield', title: 'Incidents', subtitle: 'Sécurité et alertes terrain', count: openIncidents, tab: 'incidents', tone: openIncidents ? 'red' : 'green' },
            { icon: 'clipboard', title: 'OPR', subtitle: 'Opérations préalables à réception', count: scoped.oprs.length, tab: 'opr', tone: 'blue' },
          ],
    },
    {
      title: 'Chantier',
      cards: [
        { icon: 'map', title: 'Plans', subtitle: 'PDF, épingles et réserves plan', count: scoped.plans.length, tab: 'plans', tone: 'blue' },
        { icon: 'warning', title: 'Réserves', subtitle: 'Suivi chantier et entreprises', count: scoped.reserves.length, tab: 'reserves', tone: 'amber' },
        ...(!isSubcontractor
          ? [{ icon: 'people' as TerrainHubIconName, title: 'Équipes', subtitle: 'Pointage et entreprises', count: data.companies.length, tab: 'equipes' as TabId, tone: 'green' as const }]
          : []),
      ],
    },
    {
      title: 'Documents',
      cards: [
        {
          icon: 'camera',
          title: 'Médias',
          subtitle: isSubcontractor ? 'Photos liées à mes réserves' : 'Photos terrain et documents',
          count: documentCount,
          tab: 'media',
          tone: 'green',
        },
        ...(!isSubcontractor
          ? [{ icon: 'document-text' as TerrainHubIconName, title: 'Rapports', subtitle: 'Exports et comptes-rendus', count: scoped.visites.length + scoped.reserves.length, tab: 'rapports' as TabId, tone: 'blue' as const }]
          : []),
      ],
    },
    {
      title: admin ? 'Administration' : 'Compte',
      cards: [
        ...(admin
          ? [{ icon: 'shield-checkmark' as TerrainHubIconName, title: 'Administration', subtitle: 'Utilisateurs et configuration', count: data.profiles.length, tab: 'admin' as TabId, tone: 'amber' as const }]
          : []),
        { icon: 'settings', title: 'Réglages', subtitle: 'Compte, notifications et projet', tab: 'settings', tone: 'blue' },
      ],
    },
  ];

  return (
    <div className={styles.stack}>
      <section className={styles.terrainHub}>
        <div className={styles.terrainHubIntro}>
          <div>
            <p className={styles.eyebrow}>Terrain</p>
            <h2>Accès chantier</h2>
            <span>Le hub reprend la logique mobile : un seul onglet pour ouvrir les outils terrain, documents et compte.</span>
          </div>
        </div>
        {sections.map(section => (
          <div key={section.title} className={styles.terrainHubSection}>
            <h3>{section.title}</h3>
            <div className={styles.terrainHubGrid}>
              {section.cards.map(card => (
                <button
                  key={`${section.title}-${card.title}`}
                  type="button"
                  className={`${styles.terrainHubCard} ${card.passive ? styles.terrainHubCardPassive : ''} ${card.tone ? styles[`terrainHubCard_${card.tone}`] : ''}`}
                  onClick={() => card.tab && setTab(card.tab)}
                  disabled={!card.tab}
                >
                  <span className={styles.terrainHubIcon}>
                    <TerrainHubIcon name={card.icon} />
                  </span>
                  <span className={styles.terrainHubCardText}>
                    <strong>{card.title}</strong>
                    <small>{card.subtitle}</small>
                  </span>
                  {card.count !== undefined ? <em>{card.count}</em> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function IncidentsView({ incidents }: { incidents: any[] }) {
  const openIncidents = incidents.filter(isIncidentOpenWeb);
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Incidents ouverts" value={openIncidents.length} hint="À traiter" tone={openIncidents.length ? 'red' : 'green'} />
        <Kpi title="Total incidents" value={incidents.length} hint="Historique terrain" />
        <Kpi title="Critiques" value={incidents.filter((incident: any) => incident.priority === 'critical' || incident.severity === 'critical').length} hint="Priorité haute" tone="red" />
        <Kpi title="Clôturés" value={incidents.filter((incident: any) => !isIncidentOpenWeb(incident)).length} hint="Résolus" tone="green" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Incidents terrain</h2>
            <p>Suivi sécurité et alertes remontées depuis le chantier.</p>
          </div>
        </div>
        <div className={styles.compactList}>
          {incidents.map((incident: any) => (
            <button key={incident.id}>
              <span>{STATUS_LABELS[incident.status] ?? incident.status ?? 'Incident'} · {prettyDate(incident.created_at ?? incident.date, true)}</span>
              <strong>{incident.title ?? incident.name ?? incident.description ?? incident.id}</strong>
            </button>
          ))}
          {!incidents.length && <p className={styles.empty}>Aucun incident terrain.</p>}
        </div>
      </section>
    </div>
  );
}

function OprView({ oprs, reserves, setTab, setSelectedReserveId }: {
  oprs: any[];
  reserves: any[];
  setTab: (tab: TabId) => void;
  setSelectedReserveId: (id: string) => void;
}) {
  const oprReserves = reserves.filter((reserve: any) => reserve.type === 'observation' || reserve.visit_type === 'opr' || reserve.source === 'opr');
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="OPR" value={oprs.length} hint="Contrôles OPR" />
        <Kpi title="Réserves liées" value={oprReserves.length} hint="Issues des OPR" tone="amber" />
        <Kpi title="Ouvertes" value={oprReserves.filter((reserve: any) => reserve.status !== 'closed' && !isReserveArchived(reserve)).length} hint="À suivre" tone="red" />
        <Kpi title="Clôturées" value={oprReserves.filter((reserve: any) => reserve.status === 'closed').length} hint="Terminées" tone="green" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>OPR chantier</h2>
            <p>Contrôles OPR et réserves associées au périmètre sélectionné.</p>
          </div>
        </div>
        <div className={styles.threeCols}>
          <SimpleColumn title="Contrôles" rows={oprs} primary="title" secondary="status" />
          <div>
            <h3>Réserves OPR</h3>
            <div className={styles.compactList}>
              {oprReserves.slice(0, 12).map((reserve: any) => (
                <button key={reserve.id} type="button" onClick={() => { setSelectedReserveId(reserve.id); setTab('reserves'); }}>
                  <span>{STATUS_LABELS[reserve.status] ?? reserve.status ?? 'Réserve'} · {reserve.building ?? reserve.batiment ?? 'Plan'}</span>
                  <strong>{reserve.title ?? reserve.name ?? reserve.id}</strong>
                </button>
              ))}
              {!oprReserves.length && <small>Aucune réserve OPR.</small>}
            </div>
          </div>
          <SimpleColumn title="À réceptionner" rows={oprReserves.filter((reserve: any) => reserve.status !== 'closed')} primary="title" secondary="deadline" />
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
  const recognitionRef = useRef<any>(null);
  const manualStopRef = useRef(false);
  const receivedResultRef = useRef(false);

  useEffect(() => () => {
    try {
      recognitionRef.current?.abort?.();
    } catch {
      // Some browsers throw when speech recognition is already closed.
    }
    recognitionRef.current = null;
  }, []);

  function setPreferredLang(next: TextLang) {
    setLang(next);
    if (typeof window !== 'undefined') window.localStorage.setItem('buildtrack-web-dictation-lang', next);
  }

  function stopDictation() {
    manualStopRef.current = true;
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // Some browsers throw when speech recognition is already closed.
    }
    recognitionRef.current = null;
    setBusy(null);
  }

  async function startDictation(nextLang: TextLang) {
    setPreferredLang(nextLang);
    setDictationOpen(true);
    setMessage('');
    if (typeof window === 'undefined') return;
    if (busy === 'dictation') {
      stopDictation();
      return;
    }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setMessage("La dictée vocale n'est pas disponible dans ce navigateur. Essayez Chrome ou Edge.");
      return;
    }

    if (window.isSecureContext === false) {
      setMessage('La dictée nécessite une page sécurisée en HTTPS.');
      return;
    }

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (micError: any) {
        const code = micError?.name === 'NotFoundError' || micError?.name === 'DevicesNotFoundError'
          ? 'audio-capture'
          : 'not-allowed';
        setMessage(speechRecognitionErrorMessage(code));
        return;
      }
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    manualStopRef.current = false;
    receivedResultRef.current = false;
    recognition.lang = TEXT_LANG_OPTIONS.find(item => item.value === nextLang)?.speech ?? 'fr-FR';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    setBusy('dictation');
    recognition.onstart = () => setMessage('Parlez maintenant...');
    recognition.onresult = (event: any) => {
      const text = event?.results?.[0]?.[0]?.transcript;
      if (text) {
        receivedResultRef.current = true;
        onChange(appendDictationText(value, text));
        setMessage('Dictée ajoutée.');
      }
    };
    recognition.onerror = (event: any) => {
      const code = String(event?.error ?? '');
      if (manualStopRef.current && code === 'aborted') return;
      setMessage(speechRecognitionErrorMessage(code));
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setBusy(null);
      if (manualStopRef.current) setMessage('');
      if (receivedResultRef.current) window.setTimeout(() => setMessage(''), 1800);
    };
    try {
      recognition.start();
    } catch (startError: any) {
      recognitionRef.current = null;
      setBusy(null);
      setMessage(startError?.name === 'InvalidStateError'
        ? 'Une dictée est déjà en cours. Patientez une seconde puis réessayez.'
        : 'Impossible de démarrer la dictée. Réessayez dans quelques secondes.');
    }
  }

  async function translate(target: TextLang) {
    if (!value.trim()) return;
    setMessage('');
    setBusy(`translate-${target}`);
    try {
      const translated = await requestWebTranslation({ text: value, source: 'auto', target, context });
      onChange(translated);
    } catch (err: any) {
      setMessage(err?.message ?? 'Traduction Azure indisponible.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.textAssist}>
      <div className={styles.textAssistGrid}>
        <section className={`${styles.textAssistSection} ${dictationOpen || busy === 'dictation' ? styles.textAssistSectionOpen : ''}`}>
          <div className={styles.textAssistSectionHeader}>
            <button
              type="button"
              onClick={() => {
                if (busy === 'dictation') {
                  stopDictation();
                } else if (dictationOpen) {
                  void startDictation(lang);
                } else {
                  setDictationOpen(true);
                }
              }}
              className={`${styles.microIconButton} ${busy === 'dictation' ? styles.textAssistActive : ''}`}
              aria-label={busy === 'dictation' ? 'Arrêter la dictée' : dictationOpen ? `Démarrer la dictée en ${TEXT_LANG_OPTIONS.find(option => option.value === lang)?.name ?? 'français'}` : 'Choisir la langue de dictée'}
              aria-expanded={dictationOpen || busy === 'dictation'}
              title={busy === 'dictation' ? 'Arrêter la dictée' : dictationOpen ? 'Démarrer la dictée' : 'Choisir la langue de dictée'}
            >
              <MicrophoneIcon />
            </button>
            <div>
              <strong>{busy === 'dictation' ? 'Écoute en cours' : 'Dictée vocale'}</strong>
              <small>
                {busy === 'dictation'
                  ? `Parlez en ${TEXT_LANG_OPTIONS.find(option => option.value === lang)?.name ?? 'français'}`
                  : `Langue parlée sélectionnée : ${TEXT_LANG_OPTIONS.find(option => option.value === lang)?.label ?? 'FR'}`}
              </small>
            </div>
          </div>
          {dictationOpen || busy === 'dictation' ? (
            <div className={styles.dictationPanelWeb}>
              <div className={styles.dictationPicker}>
                {TEXT_LANG_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={lang === option.value ? styles.dictationLangActive : styles.dictationLang}
                    onClick={() => {
                      if (busy === 'dictation') return;
                      setPreferredLang(option.value);
                      setMessage('');
                    }}
                    disabled={busy === 'dictation'}
                    aria-pressed={lang === option.value}
                  >
                    <span>{option.label}</span>
                    <small>{option.name}</small>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={styles.dictationStartButtonWeb}
                onClick={() => (busy === 'dictation' ? stopDictation() : startDictation(lang))}
              >
                {busy === 'dictation' ? 'Arrêter' : `Dicter en ${TEXT_LANG_OPTIONS.find(option => option.value === lang)?.label ?? 'FR'}`}
              </button>
            </div>
          ) : null}
        </section>

        <section className={styles.textAssistSection}>
          <div className={styles.textAssistSectionHeader}>
            <div className={styles.translationIconWeb}>文</div>
            <div>
              <strong>Traduction</strong>
              <small>Remplace le texte par la langue choisie</small>
            </div>
          </div>
          <div className={styles.translationPickerWeb}>
            {TEXT_LANG_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => translate(option.value)}
                disabled={!value.trim() || busy === `translate-${option.value}`}
              >
                {busy === `translate-${option.value}` ? '...' : `Vers ${option.label}`}
              </button>
            ))}
          </div>
        </section>
      </div>
      {message ? <small className={styles.textAssistMessage}>{message}</small> : null}
    </div>
  );
}

function PhotoAnnotationLayer({ annotations, compact = false }: { annotations?: WebPhotoAnnotation[]; compact?: boolean }) {
  const normalized = normalizePhotoAnnotations(annotations);
  if (!normalized.length) return null;
  return (
    <span className={styles.photoAnnotationLayer} aria-hidden="true">
      <svg className={styles.photoAnnotationSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        {normalized
          .filter(annotation => annotation.tool === 'pen' && (annotation.points?.length ?? 0) > 1)
          .map(annotation => (
            <polyline
              key={annotation.id}
              points={annotation.points!.map(point => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={annotation.color}
              strokeWidth={Math.max(0.35, (annotation.strokeWidth ?? 8) * (compact ? 0.12 : 0.18))}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
      </svg>
      {normalized
        .filter(annotation => annotation.tool !== 'pen')
        .map(annotation => (
          <span
            key={annotation.id}
            className={[
              styles.photoAnnotationMarker,
              annotation.tool === 'text' ? styles.photoAnnotationMarkerText : '',
              annotation.tool === 'rect' ? styles.photoAnnotationMarkerRect : '',
              annotation.tool === 'measure' ? styles.photoAnnotationMarkerMeasure : '',
            ].filter(Boolean).join(' ')}
            style={{
              left: `${annotation.x}%`,
              top: `${annotation.y}%`,
              '--marker-color': annotation.color,
            } as React.CSSProperties}
          >
            {annotation.tool === 'text'
              ? annotation.label
              : annotation.tool === 'arrow'
                ? '↗'
                : annotation.tool === 'rect'
                  ? ''
                  : annotation.tool === 'measure'
                    ? '↔'
                    : annotation.label.slice(0, 2)}
          </span>
        ))}
    </span>
  );
}

function PhotoAnnotatorModal({
  photo,
  onClose,
  onSave,
}: {
  photo: WebPhotoDraft;
  onClose: () => void;
  onSave: (annotations: WebPhotoAnnotation[]) => void;
}) {
  const [annotations, setAnnotations] = useState<WebPhotoAnnotation[]>(() => normalizePhotoAnnotations(photo.annotations));
  const [activeTool, setActiveTool] = useState<WebPhotoAnnotationTool>('dot');
  const [selectedColor, setSelectedColor] = useState(PHOTO_ANNOTATION_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [currentStroke, setCurrentStroke] = useState<WebPhotoAnnotation | null>(null);
  const currentStrokeRef = useRef<WebPhotoAnnotation | null>(null);
  const stageRef = useRef<HTMLButtonElement | null>(null);

  function pointFromEvent(event: PointerEvent<HTMLButtonElement>): WebPhotoAnnotationPoint {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 50 };
    return {
      x: Number(clampPercent(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100).toFixed(2)),
      y: Number(clampPercent(((event.clientY - rect.top) / Math.max(1, rect.height)) * 100).toFixed(2)),
    };
  }

  function shouldAppendPoint(points: WebPhotoAnnotationPoint[], point: WebPhotoAnnotationPoint) {
    const last = points[points.length - 1];
    if (!last) return true;
    return Math.hypot(point.x - last.x, point.y - last.y) >= 0.35;
  }

  function beginStroke(event: PointerEvent<HTMLButtonElement>) {
    const point = pointFromEvent(event);
    const stroke: WebPhotoAnnotation = {
      id: createPhotoAnnotationId(),
      x: point.x,
      y: point.y,
      color: selectedColor,
      label: 'Crayon',
      tool: 'pen',
      points: [point],
      strokeWidth,
    };
    currentStrokeRef.current = stroke;
    setCurrentStroke(stroke);
  }

  function moveStroke(event: PointerEvent<HTMLButtonElement>) {
    const stroke = currentStrokeRef.current;
    if (!stroke) return;
    const point = pointFromEvent(event);
    const points = stroke.points ?? [];
    if (!shouldAppendPoint(points, point)) return;
    const next = { ...stroke, points: [...points, point] };
    currentStrokeRef.current = next;
    setCurrentStroke(next);
  }

  function finishStroke() {
    const stroke = currentStrokeRef.current;
    if (!stroke) return;
    if ((stroke.points?.length ?? 0) > 1) {
      setAnnotations(prev => [...prev, stroke]);
    }
    currentStrokeRef.current = null;
    setCurrentStroke(null);
  }

  function addAnnotation(point: WebPhotoAnnotationPoint) {
    if (activeTool === 'text') {
      const text = typeof window !== 'undefined' ? window.prompt("Texte de l'annotation") : '';
      if (!text?.trim()) return;
      setAnnotations(prev => [
        ...prev,
        {
          id: createPhotoAnnotationId(),
          x: point.x,
          y: point.y,
          color: selectedColor,
          label: text.trim(),
          text: text.trim(),
          tool: 'text',
        },
      ]);
      return;
    }

    setAnnotations(prev => [
      ...prev,
      {
        id: createPhotoAnnotationId(),
        x: point.x,
        y: point.y,
        color: selectedColor,
        label: activeTool === 'measure'
          ? `M${prev.filter(item => item.tool === 'measure').length + 1}`
          : String(prev.filter(item => item.tool !== 'pen').length + 1),
        tool: activeTool,
      },
    ]);
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    stageRef.current?.setPointerCapture?.(event.pointerId);
    if (activeTool === 'pen') {
      beginStroke(event);
      return;
    }
    addAnnotation(pointFromEvent(event));
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.photoAnnotatorBackdrop} role="dialog" aria-modal="true">
      <div className={styles.photoAnnotatorPanel}>
        <div className={styles.photoAnnotatorHeader}>
          <div>
            <p className={styles.eyebrow}>Photo</p>
            <h2>Annoter la photo</h2>
            <span>{photo.name ?? 'Photo réserve'}</span>
          </div>
          <button type="button" onClick={onClose}>Fermer</button>
        </div>
        <div className={styles.photoAnnotatorToolbar}>
          <div className={styles.photoAnnotatorTools}>
            {[
              ['dot', 'Point'],
              ['text', 'Texte'],
              ['arrow', 'Flèche'],
              ['rect', 'Zone'],
              ['measure', 'Mesure'],
              ['pen', 'Crayon'],
            ].map(([tool, label]) => (
              <button
                key={tool}
                type="button"
                className={activeTool === tool ? styles.photoAnnotatorToolActive : ''}
                onClick={() => setActiveTool(tool as WebPhotoAnnotationTool)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.photoAnnotatorSwatches}>
            {PHOTO_ANNOTATION_COLORS.map(color => (
              <button
                key={color}
                type="button"
                className={selectedColor === color ? styles.photoAnnotatorSwatchActive : ''}
                style={{ background: color }}
                onClick={() => setSelectedColor(color)}
                aria-label={`Couleur ${color}`}
              />
            ))}
          </div>
          {activeTool === 'pen' ? (
            <div className={styles.photoAnnotatorStrokes}>
              {PHOTO_ANNOTATION_STROKES.map(size => (
                <button
                  key={size}
                  type="button"
                  className={strokeWidth === size ? styles.photoAnnotatorStrokeActive : ''}
                  onClick={() => setStrokeWidth(size)}
                >
                  <span style={{ height: size, background: selectedColor }} />
                  {size}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          ref={stageRef}
          className={styles.photoAnnotatorStage}
          onPointerDown={handlePointerDown}
          onPointerMove={event => {
            if (activeTool === 'pen' && currentStrokeRef.current) moveStroke(event);
          }}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onPointerLeave={finishStroke}
        >
          <img src={photo.uri} alt={photo.name ?? 'Photo réserve'} draggable={false} />
          <PhotoAnnotationLayer annotations={[...annotations, ...(currentStroke ? [currentStroke] : [])]} />
        </button>
        <div className={styles.photoAnnotatorFooter}>
          <button type="button" onClick={() => setAnnotations(prev => prev.slice(0, -1))} disabled={!annotations.length}>
            Annuler le dernier
          </button>
          <button type="button" onClick={() => setAnnotations([])} disabled={!annotations.length}>
            Effacer
          </button>
          <button type="button" onClick={() => onSave(normalizePhotoAnnotations(annotations))}>
            Valider
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
  const [annotatingPhoto, setAnnotatingPhoto] = useState<WebPhotoDraft | null>(null);
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
          annotations: [],
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

  function savePhotoAnnotations(photoId: string, annotations: WebPhotoAnnotation[]) {
    setDraft(prev => ({
      ...prev,
      photos: prev.photos.map(photo =>
        photo.id === photoId
          ? { ...photo, annotations: normalizePhotoAnnotations(annotations) }
          : photo
      ),
    }));
    setAnnotatingPhoto(null);
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
                <small>Choisissez un modèle pour pré-remplir le titre et la description.</small>
              )}
            </div>
            <div className={styles.reservePhotoBox}>
              <div className={styles.reservePhotoHeader}>
                <div>
                  <strong>Photos ({draft.photos.length}/6)</strong>
                  <span>Ajoutez des photos de constat ou de levée.</span>
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
                      <button
                        type="button"
                        className={styles.reservePhotoPreviewButton}
                        onClick={() => setAnnotatingPhoto(photo)}
                      >
                        <span className={styles.photoAnnotationFrame}>
                          <img src={photo.uri} alt={photo.name ?? 'Photo réserve'} />
                          <PhotoAnnotationLayer annotations={photo.annotations} compact />
                        </span>
                      </button>
                      <div className={styles.reservePhotoActions}>
                        <button type="button" onClick={() => setAnnotatingPhoto(photo)}>Annoter</button>
                        <button type="button" onClick={() => togglePhotoKind(photo.id)}>
                          {photo.kind === 'resolution' ? 'Levée' : 'Constat'}
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
                    <strong>{mode === 'edit' ? 'Position actuelle sur le plan' : 'Épingle capturée sur le plan'}</strong>
                    <small>
                      {mode === 'edit'
                        ? 'Cette réserve est déjà localisée sur ce plan. Retirer supprimera l’épingle lors de l’enregistrement.'
                        : `La réserve sera créée directement à cette position${draft.planX != null && draft.planY != null ? ` (${Math.round(draft.planX)} %, ${Math.round(draft.planY)} %).` : '.'}`}
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
                    <small>
                      {mode === 'edit'
                        ? 'Cette réserve restera associée au plan, sans position précise. Sur web, un clic sur le PDF crée une nouvelle réserve épinglée.'
                        : 'Pour créer une réserve déjà localisée, utilisez la page Plans et cliquez directement sur le PDF.'}
                    </small>
                  </span>
                </div>
              ) : (
                <div className={styles.formWide}>
                  <div className={styles.reserveNoticeWarning}>
                    {mode === 'edit'
                      ? 'Sans plan associé, cette réserve ne sera plus localisée sur un plan.'
                      : 'Sans plan associé, la réserve sera créée hors plan.'}
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
        {annotatingPhoto ? (
          <PhotoAnnotatorModal
            photo={annotatingPhoto}
            onClose={() => setAnnotatingPhoto(null)}
            onSave={annotations => savePhotoAnnotations(annotatingPhoto.id, annotations)}
          />
        ) : null}
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
