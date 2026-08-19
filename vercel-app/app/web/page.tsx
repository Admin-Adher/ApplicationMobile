'use client';

import { createContext, useCallback, useContext, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  WEB_LANGUAGES,
  createWebT,
  getBrowserLang,
  localeForLang,
  normalizeLang,
  translateWebStaticText,
  type SupportedLang,
  type WebTranslator,
} from '@/lib/i18n';
import { createAuthScopedLoadGuard } from '@/lib/auth-load-guard';
import { publishWhenCurrent } from '@/lib/progressive-workspace-load';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { BuildTrackAccess, BuildTrackAccessLoading } from './BuildTrackAccess';
import { useAuthenticatedWorkspaceSession } from './AuthenticatedWorkspaceSession';
import { WorkspaceChrome } from './WorkspaceChrome';
import { DashboardWebView, type DashboardIntent, type DashboardSource } from './dashboard/DashboardWebView';
import {
  WorkspaceBackButton,
  WorkspaceIcon,
  WorkspacePageHeader,
  WorkspaceSearch,
} from './plan-reserve-workspace/WorkspaceChrome';
import {
  buildPlanLibraryModel,
  buildReserveWorkspaceSummary,
  filterPlanLibraryGroups,
} from './plan-reserve-workspace/workspace-model';
import {
  orderCompactBuildingGroups,
  takeCompactBuildingBatch,
  toggleCompactBuildingKey,
  WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE,
} from './plan-reserve-workspace/building-navigator';
import {
  buildReserveNavigatorModel,
  createReserveNavigatorState,
  showNextReserveBatch,
  showReserveNavigatorDetail,
  showReserveNavigatorList,
  syncReserveNavigatorScope,
} from './plan-reserve-workspace/reserve-navigator';
import {
  buildPlanReserveNavigatorModel,
  createPlanReserveNavigatorState,
  getPlanReserveMarkerTextColor,
  showNextPlanReserveBatch,
  syncPlanReserveNavigatorScope,
} from './plan-reserve-workspace/plan-reserve-navigator';
import {
  calculatePdfFitScale,
  resolvePlanCanvasTapIntent,
  shouldRefitPdfOnResize,
  type PdfZoomMode,
} from './plan-reserve-workspace/plan-interaction';
import {
  createDedicatedPdfLoadingTask,
  loadPdfJs,
  warmPdfJsWhenIdle,
} from './plan-reserve-workspace/pdfjs-client';
import { useResponsiveWorkspaceNavigation } from './plan-reserve-workspace/useResponsiveWorkspace';
import { usePrivateMediaAccess, useVisiblePrivateMedia } from './plan-reserve-workspace/usePrivateMedia';
import {
  clearPlanPreviewsForUser,
  rasterizePlanPreview,
  readPlanPreview,
  writePlanPreview,
  type PlanPreviewRecord,
} from './plan-reserve-workspace/plan-preview-cache';
import {
  PLAN_DRAWING_TOOLS,
  beginPlanDrawing,
  canRedoPlanDrawing,
  canUndoPlanDrawing,
  clearPlanDrawings,
  commitPlanDrawing,
  createPlanAnnotationSession,
  deletePlanDrawing,
  deletePlanDrawingsForPage,
  filterPlanDrawingsByPage,
  redoPlanDrawing,
  sanitizePlanDrawings,
  selectPlanDrawing,
  undoPlanDrawing,
  type PlanAnnotationSession,
  type PlanDrawing,
  type PlanDrawingTool,
} from '../../../lib/plan-annotations/model';
import { LatestWriteQueue } from '../../../lib/plan-annotations/latest-write-queue';
import {
  createPendingPlanAnnotationSnapshot,
  getCanonicalPlanAnnotationSignature,
  overlayPendingPlanAnnotationSnapshots,
  type PendingPlanAnnotationSnapshot,
} from '../../../lib/plan-annotations/pending-snapshots';
import { renderPlanAnnotationsToCanvas } from '../../../lib/plan-annotations/canvas-renderer';
import {
  PlanAnnotationRasterizationError,
  renderPlanImageWithAnnotationsToDataUrl,
} from '../../../lib/plan-annotations/image-rasterizer';
import {
  isRegistryBackedRef,
  resolvePrivateMediaRefs,
  retryPrivateMedia,
  uploadRegisteredWebFile,
} from '@/lib/private-media-client';
import { RESERVE_STATUS_LABELS, RESERVE_PRIORITY_LABELS } from '@/lib/reserveLabels';
import InventoryWorkspace from './inventory-workspace/InventoryWorkspace';
import MessagesWorkspace from './messages-workspace/MessagesWorkspace';
import {
  mergeMessageReadState,
  type MessageSendInput,
} from './messages-workspace/messages-model';
import workspaceStyles from './plan-reserve-workspace/PlanReserveWorkspace.module.css';
import styles from './web.module.css';

const webPlanAnnotationWriteQueue = new LatestWriteQueue<PlanDrawing[]>();

type Role = 'super_admin' | 'admin' | 'conducteur' | 'chef_equipe' | 'magasinier' | 'sous_traitant' | 'observateur' | string;

type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  role_label?: string | null;
  organization_id?: string | null;
  company_id?: string | null;
  preferred_language?: SupportedLang | null;
  last_read_by_channel?: Record<string, string> | null;
  permissions_override?: PermissionsOverride | null;
  permissionsOverride?: PermissionsOverride | null;
};

type WebPermissions = {
  canCreate: boolean;
  canEdit: boolean;
  canEditOwn: boolean;
  canDelete: boolean;
  canExport: boolean;
  canManageTeams: boolean;
  canViewTeams: boolean;
  canUpdateAttendance: boolean;
  canMovePins: boolean;
  canEditChantier: boolean;
  canViewInventory: boolean;
  canRecordInventory: boolean;
  canManageInventoryProducts: boolean;
  canAdjustInventory: boolean;
  canExportInventory: boolean;
};

type PermissionsOverride = Partial<WebPermissions>;

const WEB_ROLE_PERMISSIONS: Record<string, WebPermissions> = {
  super_admin:   { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: true,  canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: true,  canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: true,  canAdjustInventory: true,  canExportInventory: true  },
  admin:         { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: true,  canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: true,  canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: true,  canAdjustInventory: true,  canExportInventory: true  },
  conducteur:    { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: false, canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: true,  canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: false, canAdjustInventory: false, canExportInventory: true  },
  chef_equipe:   { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: false, canExport: false, canManageTeams: false, canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: false, canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: false, canAdjustInventory: false, canExportInventory: false },
  magasinier:    { canCreate: false, canEdit: false, canEditOwn: false, canDelete: false, canExport: false, canManageTeams: false, canViewTeams: false, canUpdateAttendance: false, canMovePins: false, canEditChantier: false, canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: true,  canAdjustInventory: false, canExportInventory: true  },
  observateur:   { canCreate: false, canEdit: false, canEditOwn: false, canDelete: false, canExport: true,  canManageTeams: false, canViewTeams: true,  canUpdateAttendance: false, canMovePins: false, canEditChantier: false, canViewInventory: true,  canRecordInventory: false, canManageInventoryProducts: false, canAdjustInventory: false, canExportInventory: true  },
  sous_traitant: { canCreate: false, canEdit: false, canEditOwn: true,  canDelete: false, canExport: false, canManageTeams: false, canViewTeams: false, canUpdateAttendance: false, canMovePins: false, canEditChantier: false, canViewInventory: false, canRecordInventory: false, canManageInventoryProducts: false, canAdjustInventory: false, canExportInventory: false },
};

const WEB_PERMISSION_DEFS: { key: keyof WebPermissions; label: string; description: string; inventory: boolean }[] = [
  { key: 'canViewInventory', label: 'Consulter le stock', description: 'Produits, alertes et historique des mouvements', inventory: true },
  { key: 'canRecordInventory', label: 'Enregistrer entrées et sorties', description: 'Créer les références pendant une entrée', inventory: true },
  { key: 'canManageInventoryProducts', label: 'Gérer les fiches produits', description: 'Références, photos, emplacements et stocks minimums', inventory: true },
  { key: 'canExportInventory', label: 'Exporter le stock', description: 'Exports Excel, Word, CSV et PDF', inventory: true },
  { key: 'canAdjustInventory', label: 'Autoriser le stock négatif', description: 'Exception sensible, désactivée par défaut pour le magasinier', inventory: true },
  { key: 'canCreate', label: 'Créer des réserves', description: 'Ajouter de nouvelles réserves sur les plans', inventory: false },
  { key: 'canEdit', label: 'Modifier toutes les réserves', description: "Éditer les réserves de l'organisation", inventory: false },
  { key: 'canEditOwn', label: 'Modifier ses réserves', description: 'Éditer uniquement ses propres réserves', inventory: false },
  { key: 'canDelete', label: 'Mettre en corbeille', description: 'Retirer des réserves actives', inventory: false },
  { key: 'canExport', label: 'Exporter les données BuildTrack', description: 'Rapports et exports hors stock', inventory: false },
  { key: 'canManageTeams', label: 'Gérer les équipes', description: 'Administration des équipes chantier', inventory: false },
  { key: 'canViewTeams', label: 'Voir les équipes', description: 'Consulter les équipes et leurs membres', inventory: false },
  { key: 'canUpdateAttendance', label: 'Gérer les présences', description: 'Pointage et présence terrain', inventory: false },
  { key: 'canMovePins', label: 'Déplacer les pins', description: 'Repositionner les épingles sur les plans', inventory: false },
  { key: 'canEditChantier', label: 'Modifier les chantiers', description: 'Informations générales du chantier', inventory: false },
];

function cyclePermissionOverride(current: boolean | undefined): boolean | undefined {
  if (current === undefined) return true;
  if (current === true) return false;
  return undefined;
}

type Organization = {
  id: string;
  name?: string | null;
  slug?: string | null;
  created_at?: string | null;
};

type WebState = {
  chantiers: any[];
  reserves: any[];
  deletedReserves: any[];
  sitePlans: any[];
  companies: any[];
  organizations: Organization[];
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
  timeEntries: any[];
  regulatoryDocs: any[];
  notificationPreferences: any[];
  journalEntries: any[];
  checklists: any[];
  inventoryProducts: any[];
  inventoryMovements: any[];
};

type StorageUsageGuardrail = {
  status?: 'ok' | 'warning' | 'critical' | string;
  total_mb?: number;
  warning_mb?: number;
  critical_mb?: number;
  object_count?: number;
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
  // Convention commune web/mobile : 'image' = x, y et points sont des % du
  // rectangle réel de l'image (dimensions naturelles). Absent = annotation
  // legacy, % du conteneur d'origine (rendue sur toute la surface du cadre).
  coordSpace?: 'image';
};

type WebPhotoDraft = {
  id: string;
  uri: string;
  name?: string;
  kind?: 'defect' | 'resolution';
  file?: File;
  existing?: boolean;
  annotations?: WebPhotoAnnotation[];
  // Objet photo JSONB d'origine (photos existantes) : sert de base au patch de
  // sauvegarde pour ne pas réécrire takenAt/takenBy ni perdre les champs non
  // re-mappés (label, gpsLat/gpsLon/gpsAccuracy...).
  original?: Record<string, any>;
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
  textColor: string;
};

type PinPlacementPreview = {
  id: string;
  planId: string;
  x: number;
  y: number;
  label: string;
};

type PinMoveResult = Promise<boolean | void> | boolean | void;

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
  deletedReserves: [],
  sitePlans: [],
  companies: [],
  organizations: [],
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
  timeEntries: [],
  regulatoryDocs: [],
  notificationPreferences: [],
  journalEntries: [],
  checklists: [],
  inventoryProducts: [],
  inventoryMovements: [],
};

const WEB_LANGUAGE_PREFERENCE_KEY = 'buildtrack-web-language-preference-v1';
const WEB_LANGUAGE_LEGACY_KEY = 'buildtrack-web-language';
const WEB_LAST_TAB_KEY = 'buildtrack-web-last-tab-v1';
const WEB_EXPORT_LANGUAGE_KEY = 'buildtrack-export-language-v1';
const WEB_RECENT_BUILDINGS_KEY = 'buildtrack-web-recent-buildings-v1';
const WEB_RESERVE_HISTORY_STATE = '__buildtrackReserveDetail';
const PHOTO_ANNOTATION_COLORS = ['#EF4444', '#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#FFFFFF', '#111827'];
const PHOTO_ANNOTATION_STROKES = [2, 8, 18];

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'inventory', label: 'Stock', icon: 'grid' },
  { id: 'chantiers', label: 'Chantiers', icon: 'hammer' },
  { id: 'plans', label: 'Plans', icon: 'map' },
  { id: 'reserves', label: 'Réserves', icon: 'warning' },
  { id: 'messages', label: 'Messages', icon: 'chatbubbles' },
  { id: 'terrain', label: 'Terrain', icon: 'hammer' },
  { id: 'journal', label: 'Journal', icon: 'document-text' },
  { id: 'pointage', label: 'Pointage', icon: 'time' },
  { id: 'analytics', label: 'Analytics', icon: 'grid' },
  { id: 'documents', label: 'Documents', icon: 'document-text' },
  { id: 'checklists', label: 'Checklists', icon: 'checkbox' },
  { id: 'reglementaire', label: 'Réglementaire', icon: 'warning' },
  { id: 'search', label: 'Recherche', icon: 'options' },
  { id: 'incidents', label: 'Incidents', icon: 'alert-circle' },
  { id: 'opr', label: 'OPR', icon: 'checkbox' },
  { id: 'visites', label: 'Visites', icon: 'checkbox' },
  { id: 'planning', label: 'Planning', icon: 'time' },
  { id: 'media', label: 'Médias', icon: 'images' },
  { id: 'rapports', label: 'Rapports', icon: 'document-text' },
  { id: 'equipes', label: 'Équipes', icon: 'people-circle' },
  { id: 'settings', label: 'Paramètres', icon: 'options' },
  { id: 'admin', label: 'Administration', icon: 'settings' },
] as const;

type TabId = typeof TABS[number]['id'];
type NavIconName = typeof TABS[number]['icon'];

const NAV_GROUPS: { label: string; items: TabId[] }[] = [
  { label: 'Navigation', items: ['dashboard', 'plans', 'reserves', 'messages', 'terrain'] },
];

type WebI18nValue = {
  lang: SupportedLang;
  languagePreference: WebLanguagePreference;
  deviceLanguage: SupportedLang;
  locale: string;
  t: WebTranslator;
  setLang: (lang: SupportedLang) => void | Promise<void>;
  setLanguagePreference: (preference: WebLanguagePreference) => void | Promise<void>;
};

type WebLanguagePreference = 'auto' | SupportedLang;

const defaultWebT = createWebT('fr');

const WebI18nContext = createContext<WebI18nValue>({
  lang: 'fr',
  languagePreference: 'auto',
  deviceLanguage: 'fr',
  locale: localeForLang('fr'),
  t: defaultWebT,
  setLang: () => undefined,
  setLanguagePreference: () => undefined,
});

function useWebI18n() {
  return useContext(WebI18nContext);
}

const TAB_LABEL_FALLBACK: Partial<Record<string, string>> = {
  dashboard: 'Aujourd’hui',
  admin: 'Pilotage',
  inventory: 'Stock',
  chantiers: 'Chantiers',
  journal: 'Journal',
  pointage: 'Pointage',
  analytics: 'Analytics',
  documents: 'Documents',
  checklists: 'Checklists',
  reglementaire: 'Réglementaire',
  search: 'Recherche',
};

function tabLabel(tabId: TabId, t: WebTranslator, role?: string | null) {
  if (tabId === 'dashboard') return t('nav.today') === 'nav.today' ? 'Aujourd’hui' : t('nav.today');
  if (tabId === 'admin') {
    return role === 'super_admin'
      ? (t('nav.clients') === 'nav.clients' ? 'Clients' : t('nav.clients'))
      : (t('nav.pilotage') === 'nav.pilotage' ? 'Pilotage' : t('nav.pilotage'));
  }
  const key = `nav.${tabId}`;
  const translated = t(key);
  return translated === key ? TAB_LABEL_FALLBACK[tabId] ?? translated : translated;
}

function workspaceRoleLabel(profile: Profile | null, t: WebTranslator) {
  const key = profile?.role ? `role.${profile.role}` : '';
  if (key) {
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return profile?.role_label ?? profile?.role ?? t('common.user');
}

function failedTableList(t: WebTranslator, tables: string[]) {
  return tables.map(table => {
    const key = `sync.table.${table}`;
    const translated = t(key);
    return translated === key ? table.replaceAll('_', ' ') : translated;
  }).join(', ');
}

function readStoredWebLanguagePreference(): { preference: WebLanguagePreference; hasStored: boolean } {
  if (typeof window === 'undefined') return { preference: 'auto', hasStored: false };
  const stored = window.localStorage.getItem(WEB_LANGUAGE_PREFERENCE_KEY);
  if (stored === 'auto' || stored === 'fr' || stored === 'en' || stored === 'es') {
    return { preference: stored, hasStored: true };
  }
  const legacy = window.localStorage.getItem(WEB_LANGUAGE_LEGACY_KEY);
  if (legacy === 'fr' || legacy === 'en' || legacy === 'es') {
    return { preference: legacy, hasStored: true };
  }
  return { preference: 'auto', hasStored: false };
}

function resolveWebLanguagePreference(preference: WebLanguagePreference, profileLanguage?: SupportedLang | null, deviceLanguage: SupportedLang = getBrowserLang()) {
  if (preference !== 'auto') return preference;
  return profileLanguage ?? deviceLanguage;
}

function storeWebLanguagePreference(preference: WebLanguagePreference, effectiveLanguage: SupportedLang) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(WEB_LANGUAGE_PREFERENCE_KEY, preference);
  window.localStorage.setItem(WEB_LANGUAGE_LEGACY_KEY, effectiveLanguage);
}

const STATIC_I18N_ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt'] as const;

function WebStaticI18nBridge() {
  const { lang } = useWebI18n();
  const textSourcesRef = useRef<WeakMap<Text, string>>(new WeakMap());

  const translateTextNode = useCallback((node: Text) => {
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style, noscript, textarea, code, pre, [data-bt-i18n-skip="true"]')) return;
    const current = node.nodeValue ?? '';
    if (!/[A-Za-zÀ-ÿ]/.test(current)) return;
    const sources = textSourcesRef.current;
    const previousSource = sources.get(node);
    const previousTranslation = previousSource ? translateWebStaticText(previousSource, lang) : null;
    const source = previousSource && current === previousTranslation ? previousSource : current;
    sources.set(node, source);
    const next = translateWebStaticText(source, lang);
    if (node.nodeValue !== next) node.nodeValue = next;
  }, [lang]);

  const translateElementAttributes = useCallback((element: Element) => {
    if (!(element instanceof HTMLElement)) return;
    if (element.closest('[data-bt-i18n-skip="true"]')) return;
    for (const attr of STATIC_I18N_ATTRIBUTES) {
      const current = element.getAttribute(attr);
      if (!current || !/[A-Za-zÀ-ÿ]/.test(current)) continue;
      const sourceAttr = `data-bt-i18n-${attr}`;
      const previousSource = element.getAttribute(sourceAttr);
      const previousTranslation = previousSource ? translateWebStaticText(previousSource, lang) : null;
      const source = previousSource && current === previousTranslation ? previousSource : current;
      if (previousSource !== source) element.setAttribute(sourceAttr, source);
      const next = translateWebStaticText(source, lang);
      if (current !== next) element.setAttribute(attr, next);
    }
  }, [lang]);

  const translateTree = useCallback((root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root as Text);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }

    const elementRoot = root.nodeType === Node.ELEMENT_NODE ? root as Element : null;
    if (elementRoot) translateElementAttributes(elementRoot);

    const parent = root as ParentNode;
    if ('querySelectorAll' in parent) {
      parent.querySelectorAll('*').forEach(translateElementAttributes);
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      translateTextNode(current as Text);
      current = walker.nextNode();
    }
  }, [translateElementAttributes, translateTextNode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    const wrappedConfirm: typeof window.confirm = (message?: string) =>
      originalConfirm.call(window, translateWebStaticText(String(message ?? ''), lang));
    const wrappedAlert: typeof window.alert = (message?: any) =>
      originalAlert.call(window, typeof message === 'string' ? translateWebStaticText(message, lang) : message);

    window.confirm = wrappedConfirm;
    window.alert = wrappedAlert;

    return () => {
      if (window.confirm === wrappedConfirm) window.confirm = originalConfirm;
      if (window.alert === wrappedAlert) window.alert = originalAlert;
    };
  }, [lang]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    const root = document.body;
    translateTree(root);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') {
          translateTextNode(record.target as Text);
        } else if (record.type === 'attributes') {
          translateElementAttributes(record.target as Element);
        } else {
          record.addedNodes.forEach(translateTree);
        }
      }
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: [...STATIC_I18N_ATTRIBUTES],
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [lang, translateElementAttributes, translateTextNode, translateTree]);

  return null;
}

const TERRAIN_CHILD_TABS = new Set<TabId>([
  'chantiers',
  'journal',
  'pointage',
  'analytics',
  'documents',
  'checklists',
  'reglementaire',
  'search',
  'visites',
  'planning',
  'incidents',
  'opr',
  'messages',
  'inventory',
  'media',
  'rapports',
  'equipes',
  'settings',
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

// Source unique des libellés/couleurs de statut : lib/reserveLabels.ts
// (partagée avec les PDF, emails et la page publique réserve).
const STATUS_LABELS: Record<string, string> = RESERVE_STATUS_LABELS;

const PRIORITY_LABELS: Record<string, string> = RESERVE_PRIORITY_LABELS;

const STATUS_OPTIONS = Object.entries(STATUS_LABELS);
const RESERVE_FILTER_OPTIONS = [
  { key: 'all', label: 'Tous' },
  ...STATUS_OPTIONS.map(([key, label]) => ({ key, label })),
  { key: 'overdue', label: 'En retard' },
  { key: 'due_soon', label: 'Échéance proche' },
  { key: 'ack_missing', label: 'AR manquants' },
  { key: 'ack_received', label: 'AR reçus' },
  { key: 'archived', label: 'Archivées' },
  { key: 'deleted', label: 'Corbeille' },
] as const;

const PLAN_RESERVE_WORKSPACE_COPY: Record<SupportedLang, {
  reserves: {
    description: string;
    visible: string;
    active: string;
    overdue: string;
    verification: string;
    create: string;
    export: string;
    assistant: string;
    back: string;
  };
  plans: {
    eyebrow: string;
    title: string;
    description: string;
    plans: string;
    buildings: string;
    pins: string;
    newPlan: string;
    back: string;
  };
}> = {
  fr: {
    reserves: {
      description: 'Priorisez, localisez et levez chaque observation depuis une vue de travail unique.',
      visible: 'Affichées',
      active: 'Actives',
      overdue: 'En retard',
      verification: 'Validation',
      create: 'Nouvelle réserve',
      export: 'Exporter',
      assistant: 'Assistant',
      back: 'Retour aux réserves',
    },
    plans: {
      eyebrow: "Documents d'exécution",
      title: 'Plans du chantier',
      description: 'Retrouvez un plan, inspectez ses réserves et intervenez directement au bon emplacement.',
      plans: 'Plans',
      buildings: 'Bâtiments',
      pins: 'Épingles',
      newPlan: 'Nouveau plan',
      back: 'Retour à la bibliothèque',
    },
  },
  en: {
    reserves: {
      description: 'Prioritize, locate and close every snag from one focused workspace.',
      visible: 'Shown',
      active: 'Active',
      overdue: 'Overdue',
      verification: 'Review',
      create: 'New snag',
      export: 'Export',
      assistant: 'Assistant',
      back: 'Back to snags',
    },
    plans: {
      eyebrow: 'Construction documents',
      title: 'Project plans',
      description: 'Find a plan, inspect its snags and act directly at the right location.',
      plans: 'Plans',
      buildings: 'Buildings',
      pins: 'Pins',
      newPlan: 'New plan',
      back: 'Back to the library',
    },
  },
  es: {
    reserves: {
      description: 'Priorice, ubique y cierre cada reserva desde un único espacio de trabajo.',
      visible: 'Mostradas',
      active: 'Activas',
      overdue: 'Con retraso',
      verification: 'Validación',
      create: 'Nueva reserva',
      export: 'Exportar',
      assistant: 'Asistente',
      back: 'Volver a las reservas',
    },
    plans: {
      eyebrow: 'Documentos de ejecución',
      title: 'Planos de la obra',
      description: 'Encuentre un plano, revise sus reservas y actúe directamente en la ubicación correcta.',
      plans: 'Planos',
      buildings: 'Edificios',
      pins: 'Pines',
      newPlan: 'Nuevo plano',
      back: 'Volver a la biblioteca',
    },
  },
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super administrateur',
  admin: 'Administrateur',
  conducteur: 'Conducteur de travaux',
  chef_equipe: "Chef d'équipe",
  magasinier: 'Magasinier',
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

function canPermanentlyDeleteReserve(profile: Profile | null) {
  return profile?.role === 'super_admin' || profile?.role === 'admin';
}

function isConducteur(profile: Profile | null) {
  return profile?.role === 'conducteur';
}

function profilePermissionsOverride(profile: Profile | null): PermissionsOverride | undefined {
  const override = profile?.permissions_override ?? profile?.permissionsOverride;
  if (!override || typeof override !== 'object' || Array.isArray(override)) return undefined;
  return override;
}

function resolveWebPermissions(profile: Profile | null): WebPermissions {
  if (!profile) return WEB_ROLE_PERMISSIONS.observateur;
  const role = String(profile.role ?? 'observateur');
  const base = WEB_ROLE_PERMISSIONS[role] ?? WEB_ROLE_PERMISSIONS.observateur;
  const merged: WebPermissions = {
    canCreate: base.canCreate ?? false,
    canEdit: base.canEdit ?? false,
    canEditOwn: base.canEditOwn ?? false,
    canDelete: base.canDelete ?? false,
    canExport: base.canExport ?? false,
    canManageTeams: base.canManageTeams ?? false,
    canViewTeams: base.canViewTeams ?? false,
    canUpdateAttendance: base.canUpdateAttendance ?? false,
    canMovePins: base.canMovePins ?? false,
    canEditChantier: base.canEditChantier ?? false,
    canViewInventory: base.canViewInventory ?? false,
    canRecordInventory: base.canRecordInventory ?? false,
    canManageInventoryProducts: base.canManageInventoryProducts ?? false,
    canAdjustInventory: base.canAdjustInventory ?? false,
    canExportInventory: base.canExportInventory ?? false,
  };
  if (role === 'super_admin') return merged;
  const override = profilePermissionsOverride(profile);
  if (!override) return merged;
  for (const key of Object.keys(override) as (keyof PermissionsOverride)[]) {
    if (override[key] !== undefined) {
      (merged as any)[key] = override[key];
    }
  }
  return merged;
}

function canCreate(profile: Profile | null) {
  return resolveWebPermissions(profile).canCreate;
}

function canEdit(profile: Profile | null) {
  return resolveWebPermissions(profile).canEdit;
}

function canDelete(profile: Profile | null) {
  return resolveWebPermissions(profile).canDelete;
}

function canExport(profile: Profile | null) {
  return resolveWebPermissions(profile).canExport;
}

function canManageTeams(profile: Profile | null) {
  return resolveWebPermissions(profile).canManageTeams;
}

function canViewTeams(profile: Profile | null) {
  return resolveWebPermissions(profile).canViewTeams;
}

function canUpdateAttendance(profile: Profile | null) {
  return resolveWebPermissions(profile).canUpdateAttendance;
}

function canMovePins(profile: Profile | null) {
  return resolveWebPermissions(profile).canMovePins;
}

function canEditChantier(profile: Profile | null) {
  return resolveWebPermissions(profile).canEditChantier;
}

function readStoredExportLanguage(): SupportedLang | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(WEB_EXPORT_LANGUAGE_KEY);
  return value === 'fr' || value === 'en' || value === 'es' ? value : null;
}

function canViewInventory(profile: Profile | null) {
  return resolveWebPermissions(profile).canViewInventory;
}

function canRecordInventory(profile: Profile | null) {
  return resolveWebPermissions(profile).canRecordInventory;
}

function canManageInventoryProducts(profile: Profile | null) {
  return resolveWebPermissions(profile).canManageInventoryProducts;
}

function canAdjustInventory(profile: Profile | null) {
  return resolveWebPermissions(profile).canAdjustInventory;
}

function canExportInventory(profile: Profile | null) {
  return resolveWebPermissions(profile).canExportInventory;
}

function isSubcontractor(profile: Profile | null) {
  return profile?.role === 'sous_traitant';
}

function canUseReserveTunnel(profile: Profile | null) {
  return canEdit(profile) || isSubcontractor(profile);
}

function userLabel(profile: Profile | null, authUser?: SupabaseUser | null) {
  return profile?.name || profile?.email || authUser?.email || 'BuildTrack Web';
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function reserveCompanySignatures(reserve: any): Record<string, { signature?: string; signataire?: string; signedAt?: string }> {
  const value = reserve?.company_signatures ?? reserve?.companySignatures;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function xmlEscape(value: string) {
  return value.replace(/[<>&"']/g, char => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  }[char] ?? char));
}

function signatureImageSrc(value: any) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.startsWith('data:')) return text;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}

function makeTypedSignatureDataUrl(signataire: string, signedAt: string) {
  const name = xmlEscape(signataire);
  const date = xmlEscape(signedAt);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="150" viewBox="0 0 420 150"><rect width="420" height="150" fill="white"/><path d="M34 96 C92 48, 120 130, 176 82 S274 62, 328 86 S378 98, 394 68" fill="none" stroke="#1A2742" stroke-width="5" stroke-linecap="round"/><text x="34" y="128" font-family="Arial, sans-serif" font-size="18" fill="#1A2742">${name}</text><text x="300" y="128" font-family="Arial, sans-serif" font-size="13" fill="#64748B">${date}</text></svg>`;
  return signatureImageSrc(svg);
}

// Traite une liste par lots parallèles : évite le N+1 séquentiel sans saturer le réseau.
async function runInBatches<T, R>(items: T[], batchSize: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = await Promise.all(items.slice(i, i + batchSize).map(task));
    results.push(...batch);
  }
  return results;
}

// Fermeture des modales à la touche Échap (aria-modal sans Escape = inaccessible).
function useEscapeClose(active: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

function todayISO() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function visitWeekPrefix(lang: SupportedLang) {
  return lang === 'en' ? 'W' : 'S';
}

function autoVisitTitle(type: VisitDraft['visitType'], date: string, lang: SupportedLang = 'fr') {
  return `${translateWebStaticText(VISIT_TYPE_LABELS[type], lang)} — ${visitWeekPrefix(lang)}${isoWeekFromISO(date)}`;
}

function makeVisitChecklist(type: VisitDraft['visitType'], lang: SupportedLang = 'fr') {
  return (VISIT_CHECKLIST_TEMPLATES[type] ?? []).map(label => ({
    id: crypto.randomUUID(),
    label: translateWebStaticText(label, lang),
    checked: false,
  }));
}

function nowISO() {
  return new Date().toISOString();
}

function prettyDate(value?: string | null, withTime = false) {
  if (!value) return '—';
  const date = parseDateSafe(value);
  if (!date) return value;
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

function isReserveDeleted(reserve: any) {
  return Boolean(reserve?.deleted_at ?? reserve?.deletedAt);
}

function isReserveClosed(reserve: any) {
  return String(reserve?.status ?? '').toLowerCase() === 'closed';
}

function getReserveCreatedSortKey(reserve: any) {
  const raw = String(reserve?.createdAt ?? reserve?.created_at ?? reserve?.created ?? reserve?.date ?? '');
  const parsed = parseDateSafe(raw);
  return parsed ? parsed.toISOString() : raw;
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
  const deadline = parseDateSafe(String(reserve.deadline));
  if (!deadline) return false;
  deadline.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return deadline < today;
}

function isReserveDueSoon(reserve: any, days = 3) {
  if (!reserve?.deadline || ['closed', 'verification'].includes(String(reserve?.status ?? ''))) return false;
  const deadline = parseDateSafe(String(reserve.deadline));
  if (!deadline) return false;
  deadline.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (deadline < today) return false;
  const limit = new Date(today);
  limit.setDate(limit.getDate() + days);
  return deadline <= limit;
}

function needsEnterpriseAck(reserve: any) {
  return reserveCompanies(reserve).length > 0 && !reserve?.enterprise_acknowledged_at && !reserve?.enterpriseAcknowledgedAt;
}

function hasEnterpriseAck(reserve: any) {
  return Boolean(reserve?.enterprise_acknowledged_at ?? reserve?.enterpriseAcknowledgedAt);
}

function parseDateSafe(value?: string | null) {
  if (!value) return null;
  const frenchMatch = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (frenchMatch) {
    const parsed = new Date(
      Number(frenchMatch[3]),
      Number(frenchMatch[2]) - 1,
      Number(frenchMatch[1]),
      Number(frenchMatch[4] ?? 0),
      Number(frenchMatch[5] ?? 0),
    );
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
  if (Array.isArray(project?.buildings)) return project.buildings;
  if (typeof project?.buildings === 'string' && project.buildings.trim()) {
    try {
      const parsed = JSON.parse(project.buildings);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
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

function storageAssetRef(raw: any, bucket: 'photos' | 'documents') {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value || /^file:\/\//i.test(value)) return '';
  if (/^(data:|blob:)/i.test(value)) return value;
  if (/^(https?:|btmedia:)/i.test(value)) return value;
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
  return storageAssetRef(raw, bucket);
}

function assetDedupeKey(url: string) {
  const value = String(url ?? '').trim();
  if (!value) return '';
  if (/^btmedia:\/\//i.test(value)) return value.toLowerCase();
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
      coordSpace: item?.coordSpace === 'image' ? 'image' as const : undefined,
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

const EMPTY_MEDIA_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function PrivateMediaImage({
  source,
  alt,
  className,
  immediate = false,
}: {
  source: unknown;
  alt: string;
  className?: string;
  immediate?: boolean;
}) {
  const { access, observe, requestNow } = useVisiblePrivateMedia(source, { immediate });
  return (
    <img
      ref={observe}
      className={className}
      src={access.url || EMPTY_MEDIA_IMAGE}
      alt={alt}
      loading={immediate ? 'eager' : 'lazy'}
      decoding="async"
      data-private-media-status={access.status}
      aria-busy={access.status === 'resolving' || access.status === 'idle'}
      onMouseEnter={requestNow}
    />
  );
}

function PrivatePhotoFrame({
  photo,
  className,
  compact = false,
  fit,
  immediate = false,
}: {
  photo: any;
  className?: string;
  compact?: boolean;
  fit?: 'cover' | 'contain';
  immediate?: boolean;
}) {
  const { access, observe, requestNow } = useVisiblePrivateMedia(photo?.uri, { immediate });
  return (
    <span
      ref={observe}
      className={className ?? styles.photoAnnotationFrame}
      data-private-media-status={access.status}
      onMouseEnter={requestNow}
    >
      <img
        src={access.url || EMPTY_MEDIA_IMAGE}
        alt={photo?.comment ?? photo?.name ?? 'Photo réserve'}
        loading={immediate ? 'eager' : 'lazy'}
        decoding="async"
        aria-busy={access.status === 'resolving' || access.status === 'idle'}
      />
      {access.url ? (
        <PhotoAnnotationLayer
          annotations={photoAnnotationsFrom(photo)}
          compact={compact}
          fit={fit}
          imageSrc={access.url}
        />
      ) : null}
    </span>
  );
}

function PrivateMediaLink({
  source,
  className,
  children,
}: {
  source: unknown;
  className?: string;
  children: ReactNode;
}) {
  const ref = String(source ?? '').trim();
  const { access, observe, requestNow } = useVisiblePrivateMedia(source);
  return (
    <a
      ref={observe}
      className={className}
      href={access.url || undefined}
      target={access.url ? '_blank' : undefined}
      rel={access.url ? 'noreferrer' : undefined}
      aria-disabled={!access.url}
      aria-busy={access.status === 'resolving' || access.status === 'idle'}
      onMouseEnter={requestNow}
      onFocus={requestNow}
      onClick={event => {
        if (access.url) return;
        event.preventDefault();
        requestNow();
        const pendingWindow = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
        if (pendingWindow) {
          pendingWindow.opener = null;
          try {
            pendingWindow.document.title = 'BuildTrack';
            pendingWindow.document.body.textContent = 'Ouverture sécurisée du document…';
          } catch {
            // The temporary document may already be isolated by the browser.
          }
        }
        void resolvePrivateMediaRefs([ref], { priority: 'critical' }).then(urls => {
          const url = urls.get(ref);
          if (url && pendingWindow && !pendingWindow.closed) {
            pendingWindow.location.replace(url);
          } else if (!url && pendingWindow && !pendingWindow.closed) {
            pendingWindow.close();
          }
        }).catch(() => {
          if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
        });
      }}
    >
      {children}
    </a>
  );
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

function normalizeStoredPlanPercent(value?: any) {
  const percent = normalizePlanPercent(value);
  return percent == null ? null : Math.round(clampPercent(percent));
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

function pdfBase64ToObjectUrl(pdfBase64: string) {
  if (typeof window === 'undefined') return '';
  const byteChars = atob(pdfBase64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i += 1) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
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

async function resolvePdfPhotoItems(items: any[]) {
  const refs = items.map(item => String(item?.uri ?? '').trim()).filter(Boolean);
  const resolved = await resolvePrivateMediaRefs(refs, { priority: 'background' });
  return items
    .map(item => {
      const ref = String(item?.uri ?? '').trim();
      const uri = resolved.get(ref) || (!isRegistryBackedRef(ref) ? ref : '');
      return uri ? { ...item, uri } : null;
    })
    .filter(Boolean);
}

const REPORT_MAX_TOTAL_REMOTE_PHOTOS = 150;
// 3 photos/réserve : les photos sont désormais empilées dans la colonne
// Observation des rapports (mise en page façon rapport de pendientes), comme
// sur mobile. Le pipeline serveur borne de toute façon le total (≈160 images).
const REPORT_MAX_PHOTOS_PER_RESERVE = 3;
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

async function getPdfRemoteReservePhotoItems(reserve: any, maxPhotosPerReserve: number) {
  if (maxPhotosPerReserve <= 0) return [];
  const resolved = await resolvePdfPhotoItems(getPdfReservePhotoItems(reserve).slice(0, maxPhotosPerReserve));
  return resolved
    .filter((photo: any) => isPdfReportRemoteAsset(photo.uri))
    .map((photo: any) => ({
      ...photo,
      uri: photo.uri,
    }));
}

async function withPdfRemoteReservePhotos(reserve: any, maxPhotosPerReserve: number) {
  if (!reserve) return reserve;
  const photos = await getPdfRemoteReservePhotoItems(reserve, maxPhotosPerReserve);

  return {
    ...reserve,
    photos,
    photoUri: photos[0]?.uri ?? reserve.photoUri ?? reserve.photo_uri ?? null,
    photo_uri: photos[0]?.uri ?? reserve.photo_uri ?? reserve.photoUri ?? null,
  };
}

async function withPdfRemoteReservePhotoList(reserves: any[], maxPhotosPerReserve: number, maxTotalPhotos = REPORT_MAX_TOTAL_REMOTE_PHOTOS) {
  let remaining = maxTotalPhotos;
  const selected: Array<{ reserve: any; photos: any[] }> = reserves.map(reserve => {
    const allowed = Math.max(0, Math.min(maxPhotosPerReserve, remaining));
    const photos = getPdfReservePhotoItems(reserve).slice(0, allowed);
    remaining -= photos.length;
    return { reserve, photos };
  });
  const allPhotos = selected.flatMap(item => item.photos);
  const resolvedRefs = await resolvePrivateMediaRefs(
    allPhotos.map(photo => String(photo?.uri ?? '')).filter(Boolean),
    { priority: 'background' },
  );
  return selected.map(({ reserve, photos }) => {
    const resolvedPhotos = photos
      .map((photo: any) => {
        const ref = String(photo?.uri ?? '').trim();
        const uri = resolvedRefs.get(ref) || (!isRegistryBackedRef(ref) ? ref : '');
        return uri && isPdfReportRemoteAsset(uri) ? { ...photo, uri } : null;
      })
      .filter(Boolean);
    return {
      ...reserve,
      photos: resolvedPhotos,
      photoUri: resolvedPhotos[0]?.uri ?? reserve.photoUri ?? reserve.photo_uri ?? null,
      photo_uri: resolvedPhotos[0]?.uri ?? reserve.photo_uri ?? reserve.photoUri ?? null,
    };
  });
}

async function withPdfEmbeddedVisitMedia(visit: any) {
  if (!visit) return visit;
  const coverRaw = visit.cover_photo_uri ?? visit.coverPhotoUri;
  if (!coverRaw) return visit;
  const coverRef = assetUrl({ uri: coverRaw }, 'photos') || String(coverRaw).trim();
  const resolved = await resolvePrivateMediaRefs([coverRef], { priority: 'background' });
  const coverUri = resolved.get(coverRef) || (!isRegistryBackedRef(coverRef) ? coverRef : '');
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

  const selectedPhotosByReserve = new Map<string, any[]>();
  const allSelectedPhotos: any[] = [];
  reserves.forEach((reserve, index) => {
    const reserveKey = String(reserve?.id ?? `reserve-${index}`);
    const selected = getPdfReservePhotoItems(reserve).slice(0, maxPhotosPerReserve);
    selectedPhotosByReserve.set(reserveKey, selected);
    allSelectedPhotos.push(...selected);
  });
  const resolvedUriByOriginalRef = new Map<string, string>();
  const resolvedRefs = await resolvePrivateMediaRefs(
    allSelectedPhotos.map(photo => String(photo?.uri ?? '')).filter(Boolean),
    { priority: 'background' },
  );
  allSelectedPhotos.forEach(photo => {
    const ref = String(photo?.uri ?? '').trim();
    const uri = resolvedRefs.get(ref) || (!isRegistryBackedRef(ref) ? ref : '');
    if (uri) resolvedUriByOriginalRef.set(ref, uri);
  });

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
      photos: (selectedPhotosByReserve.get(String(reserve?.id ?? `reserve-${index}`)) ?? [])
        .map(photo => {
          const uri = resolvedUriByOriginalRef.get(String(photo?.uri ?? '').trim());
          return uri && isPdfReportRemoteAsset(uri) ? { ...photo, uri } : null;
        })
        .filter(Boolean),
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

  const planItems = plans.map(plan => ({ plan, item: toPdfPlanItem(plan) }));
  const resolvedUris = await resolvePrivateMediaRefs(
    planItems.map(({ item }) => item.uri).filter(Boolean),
    { priority: 'background' },
  );
  const items: any[] = [];
  for (const { plan, item } of planItems) {
    if (!activePlanIds.has(item.id) || !item.uri) {
      items.push(item);
      continue;
    }

    const clientUri = resolvedUris.get(item.uri) || (!isRegistryBackedRef(item.uri) ? item.uri : '');
    let renderedUri: string | null = null;
    if (clientUri && isPdfPlan(plan, item.uri)) {
      renderedUri = await preRenderPdfPageToDataUrl(clientUri, 720, plan?.annotations);
    } else if (clientUri && String(item.fileType).toLowerCase() !== 'dxf') {
      const embeddedImage = await imageUrlToPdfDataUrl(clientUri);
      renderedUri = embeddedImage && (plan?.annotations?.length ?? 0) > 0
        ? await renderPlanImageWithAnnotationsToDataUrl(embeddedImage, 720, plan.annotations) ?? embeddedImage
        : embeddedImage;
    }
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

async function preRenderPdfPageToDataUrl(
  pdfUri: string,
  renderWidth: number,
  annotations: unknown = [],
) {
  if (typeof document === 'undefined' || !pdfUri) return null;
  const hasAnnotations = sanitizePlanDrawings(annotations).length > 0;
  try {
    const pdfjs: any = await loadPdfJs();
    const source = pdfUri.startsWith('data:')
      ? { data: dataUrlToPdfBytes(pdfUri) }
      : { url: pdfUri, withCredentials: false };
    const pdfSession = createDedicatedPdfLoadingTask(pdfjs, source);
    try {
      const pdf = await pdfSession.loadingTask.promise;
      const page = await pdf.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = renderWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) {
        if (hasAnnotations) throw new PlanAnnotationRasterizationError('Canvas is unavailable for annotated PDF export.');
        return null;
      }
      await page.render({ canvasContext: context, viewport }).promise;
      renderPlanAnnotationsToCanvas(context, canvas.width, canvas.height, annotations, 1);
      return canvas.toDataURL('image/jpeg', 0.88);
    } finally {
      await pdfSession.destroy();
    }
  } catch (error) {
    if (hasAnnotations) {
      if (error instanceof PlanAnnotationRasterizationError) throw error;
      throw new PlanAnnotationRasterizationError(undefined, { cause: error });
    }
    return null;
  }
}

async function getPlanImageForReserveReport(plan: any) {
  const uri = getPlanReportUri(plan);
  if (!uri) return null;
  const resolved = await resolvePrivateMediaRefs([uri]);
  const clientUri = resolved.get(uri) || (!isRegistryBackedRef(uri) ? uri : '');
  if (!clientUri) return null;
  if (!isPdfPlan(plan, clientUri)) {
    const embeddedImage = await imageUrlToPdfDataUrl(clientUri);
    if (!embeddedImage || (plan?.annotations?.length ?? 0) === 0) return embeddedImage;
    return await renderPlanImageWithAnnotationsToDataUrl(embeddedImage, 720, plan.annotations)
      ?? embeddedImage;
  }
  return await preRenderPdfPageToDataUrl(clientUri, 720, plan?.annotations);
}

function makeHistory(action: string, author: string, oldValue?: string, newValue?: string) {
  return {
    id: crypto.randomUUID(),
    action,
    author,
    createdAt: nowISO(),
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

function formatWebFileSize(size?: number | null) {
  const value = Number(size ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function detectWebPlanFileType(file?: File | null): 'pdf' | 'image' | 'dxf' | null {
  if (!file) return null;
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.dxf')) return 'dxf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name)) return 'image';
  return null;
}

function detectWebDocumentType(file?: File | null): 'plan' | 'report' | 'technical' | 'photo' | 'other' {
  if (!file) return 'other';
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  if (name.includes('plan') && (mime.includes('pdf') || name.endsWith('.pdf'))) return 'plan';
  if (/\.(docx?|pdf)$/i.test(name)) return 'report';
  if (/\.(xlsx?|csv|ods)$/i.test(name)) return 'technical';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name)) return 'photo';
  return 'other';
}

function makeWebLocalStorageKey(prefix: string, profile: Profile | null, selectedProjectId: string) {
  const org = profile?.organization_id ?? profile?.id ?? 'local';
  return `${prefix}:${org}:${selectedProjectId || 'all'}`;
}

function readWebLocalArray(key: string) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeWebLocalArray(key: string, value: any[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

// Journal/checklists : mapping lignes Supabase <-> forme d'affichage historique des vues web.
function mergeRealtimeRow(rows: any[], payload: any) {
  const next = payload?.new && Object.keys(payload.new).length ? payload.new : null;
  const oldId = payload?.old?.id ?? next?.id;
  if (payload?.eventType === 'DELETE') {
    return oldId ? rows.filter(row => String(row.id) !== String(oldId)) : rows;
  }
  if (!next?.id) return rows;
  const exists = rows.some(row => String(row.id) === String(next.id));
  return exists
    ? rows.map(row => (String(row.id) === String(next.id) ? { ...row, ...next } : row))
    : [next, ...rows];
}

function journalRowToEntry(row: any) {
  return {
    id: row.id,
    date: row.entry_date ?? row.date ?? '',
    weather: row.weather ?? '',
    weatherTemp: row.weather_temp ?? row.weatherTemp,
    weatherWind: row.weather_wind ?? row.weatherWind,
    workerCount: row.worker_count ?? row.workerCount ?? 0,
    workDone: row.work_done ?? row.workDone ?? '',
    materials: row.materials ?? '',
    incidents: row.incidents ?? '',
    observations: row.observations ?? '',
    visitors: row.visitors ?? '',
    author: row.author ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    chantierId: row.chantier_id ?? null,
  };
}

function checklistRowToView(row: any) {
  const items = (Array.isArray(row.items) ? row.items : []).map((item: any) => ({
    id: item.id ?? crypto.randomUUID(),
    label: item.label ?? '',
    checked: Boolean(item.done ?? item.checked),
  }));
  const done = items.filter((item: any) => item.checked).length;
  return {
    id: row.id,
    title: row.title ?? '',
    items,
    status: items.length && done === items.length ? 'completed' : done > 0 ? 'in_progress' : 'draft',
    createdAt: row.created_at ?? row.createdAt ?? '',
    createdBy: row.author ?? row.createdBy ?? '',
    chantierId: row.chantier_id ?? null,
  };
}

function checklistItemsToRows(items: any[]) {
  return (items ?? []).map((item: any) => ({
    id: item.id ?? crypto.randomUUID(),
    label: item.label ?? '',
    done: Boolean(item.done ?? item.checked),
  }));
}

async function uploadWebFile(bucket: 'photos' | 'documents', file: File, prefix: string) {
  return uploadRegisteredWebFile(bucket, file, safeStorageName(prefix));
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

// Notifications push vers les utilisateurs mobiles. L'API /api/send-push
// résout elle-même les destinataires (membres du canal, entreprises de la
// réserve), applique les préférences et les heures calmes. Fire-and-forget :
// un échec de push ne doit jamais bloquer ni faire échouer l'action métier.
// Sans ces appels, les actions effectuées depuis le web (réserve créée,
// statut changé, message envoyé) ne notifiaient personne sur mobile.
function triggerWebPush(payload:
  | { type: 'message-created'; messageId: string }
  | { type: 'reserve-created'; reserveId: string }
  | { type: 'reserve-status-changed'; reserveId: string; newStatus?: string; previousStatus?: string }
) {
  void (async () => {
    try {
      const { data: authData } = await supabaseBrowser.auth.getSession();
      const token = authData.session?.access_token;
      if (!token) return;
      await fetch('/api/send-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('[web push]', payload.type, err?.message ?? err);
    }
  })();
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
          // Objet JSONB d'origine conservé tel quel : base du patch de sauvegarde.
          original: photo,
        })).filter((photo: WebPhotoDraft) => !!photo.uri)
      : (reserve.photo_uri ?? reserve.photoUri)
        ? [{
            id: 'legacy',
            uri: assetUrl({ uri: reserve.photo_uri ?? reserve.photoUri }, 'photos'),
            name: 'Photo',
            kind: 'defect' as const,
            existing: true,
            annotations: photoAnnotationsFrom(reserve),
            original: { id: 'legacy', uri: reserve.photo_uri ?? reserve.photoUri, name: 'Photo' },
          }].filter((photo: WebPhotoDraft) => !!photo.uri)
        : [],
  };
}

function createVisitDraft(projectId: string, conducteur: string, lang: SupportedLang = 'fr'): VisitDraft {
  const date = todayISO();
  const visitType: VisitDraft['visitType'] = 'controle';
  return {
    title: autoVisitTitle(visitType, date, lang),
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
    checklistItems: makeVisitChecklist(visitType, lang),
    companyIds: [],
    participants: [],
    tags: [],
    recurrence: 'none',
    coverPhoto: null,
  };
}

const WEB_SUPPORT_ORG_KEY = 'buildtrack-web-support-org-v1';
let webSupportOrgId: string | null = (() => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(WEB_SUPPORT_ORG_KEY);
    return raw ? (JSON.parse(raw) as { id?: string }).id ?? null : null;
  } catch {
    return null;
  }
})();

const SUPABASE_PAGE_SIZE = 1000;

async function fetchScopedTable<T = any>(
  table: string,
  profile: Profile,
  options: {
    order?: string;
    ascending?: boolean;
    limit?: number;
    scoped?: boolean;
    orgId?: string | null;
    onError?: (table: string, message: string) => void;
  } = {},
): Promise<T[]> {
  try {
    // Pagination explicite : sans elle, PostgREST tronque silencieusement à 1000 lignes.
    const rows: T[] = [];
    const pageSize = options.limit ? Math.min(options.limit, SUPABASE_PAGE_SIZE) : SUPABASE_PAGE_SIZE;
    for (let from = 0; ; from += pageSize) {
      let query = supabaseBrowser.from(table).select('*');
      if (options.scoped !== false) {
        if (profile.role === 'super_admin') {
          const orgId = options.orgId ?? webSupportOrgId;
          if (!orgId) return [];
          query = query.eq('organization_id', orgId);
        } else if (profile.organization_id) {
          query = query.eq('organization_id', profile.organization_id);
        }
      }
      if (table === 'chantiers' || table === 'site_plans' || table === 'photos') {
        query = query.is('deleted_at', null);
      }
      if (options.order) query = query.order(options.order, { ascending: options.ascending ?? false });
      query = query.order('id', { ascending: true });
      query = query.range(from, from + pageSize - 1);
      const { data, error } = await query;
      if (error) {
        console.warn(`[web] ${table}`, error.message);
        options.onError?.(table, error.message);
        return rows;
      }
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < pageSize) break;
      if (options.limit && rows.length >= options.limit) break;
    }
    return options.limit ? rows.slice(0, options.limit) : rows;
  } catch (error: any) {
    console.warn(`[web] ${table}`, error);
    options.onError?.(table, error?.message ?? String(error));
    return [];
  }
}

async function fetchOrgUsers(onError?: (table: string, message: string) => void): Promise<Profile[]> {
  try {
    const { data, error } = await supabaseBrowser.rpc('get_org_users');
    if (error) throw error;
    return (Array.isArray(data) ? data : []) as Profile[];
  } catch (error: any) {
    console.warn('[web] get_org_users', error);
    onError?.('profiles', error?.message ?? String(error));
    return [];
  }
}

type WebTextPromptRequest = {
  title: string;
  label?: string;
  defaultValue?: string;
  resolve: (value: string | null) => void;
};

// Boîte de saisie maison remplaçant window.prompt (stylée, traduite par le bridge,
// fermable à Échap). Enregistrée par le composant racine ; fallback prompt natif sinon.
let webAskTextImpl: ((title: string, options?: { label?: string; defaultValue?: string }) => Promise<string | null>) | null = null;

function askTextDialog(title: string, options: { label?: string; defaultValue?: string } = {}) {
  if (webAskTextImpl) return webAskTextImpl(title, options);
  if (typeof window === 'undefined') return Promise.resolve<string | null>(null);
  return Promise.resolve(window.prompt(title, options.defaultValue ?? ''));
}

function TextPromptDialog({ request, onSubmit, onCancel }: {
  request: WebTextPromptRequest;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(request.defaultValue ?? '');
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);
  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" style={{ zIndex: 250 }}>
      <form
        className={styles.modalPanel}
        style={{ maxWidth: 420 }}
        onMouseDown={event => event.stopPropagation()}
        onSubmit={event => {
          event.preventDefault();
          onSubmit(value.trim());
        }}
      >
        <h3>{request.title}</h3>
        <label className={styles.fullSpan}>
          {request.label ? <span>{request.label}</span> : null}
          <input autoFocus value={value} onChange={event => setValue(event.target.value)} />
        </label>
        <div className={styles.modalActions}>
          <button type="button" onClick={onCancel}>Annuler</button>
          <button type="submit">Valider</button>
        </div>
      </form>
    </div>
  );
}

export default function BuildTrackWebPage() {
  const [authLoadGuard] = useState(createAuthScopedLoadGuard);
  const authenticatedWorkspace = useAuthenticatedWorkspaceSession({
    onAuthenticatedUserChange: authLoadGuard.setAuthenticatedUser,
  });
  const session = authenticatedWorkspace.state.status === 'authenticated'
    ? authenticatedWorkspace.state.session
    : null;
  const authUser = authenticatedWorkspace.state.status === 'authenticated'
    ? authenticatedWorkspace.state.user
    : null;
  const authUserIdRef = useRef<string | null>(authUser?.id ?? null);
  authUserIdRef.current = authUser?.id ?? null;
  const pendingWebPlanAnnotationsRef = useRef(new Map<string, PendingPlanAnnotationSnapshot>());
  const [supportOrg, setSupportOrg] = useState<{ id: string; name: string } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(WEB_SUPPORT_ORG_KEY);
      return raw ? JSON.parse(raw) as { id: string; name: string } : null;
    } catch {
      return null;
    }
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<WebState>(EMPTY_DATA);
  const previewCacheOwnerRef = useRef<string | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsageGuardrail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const saved = window.localStorage.getItem(WEB_LAST_TAB_KEY);
    if (saved && TABS.some(tab => tab.id === saved) && saved !== 'inventory') return saved as TabId;
    return 'dashboard';
  });
  const previousActiveTabRef = useRef<TabId>('dashboard');
  const reserveHistoryNavigationRef = useRef(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedReserveId, setSelectedReserveId] = useState<string | null>(null);
  const [reserveDetailRequest, setReserveDetailRequest] = useState<{ id: string; token: number } | null>(null);
  const reserveDetailRequestTokenRef = useRef(0);
  const reserveFilterScopeRef = useRef<string>('all');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  // Réserve (déjà créée, sans épingle) en cours de localisation : depuis sa
  // fiche, l'utilisateur bascule sur l'onglet Plans et le prochain clic sur le
  // plan pose sa pastille (via moveReservePinWeb). null = pas de placement.
  const [placementReserveId, setPlacementReserveId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  // Suivi des messages lus par canal (ISO de la dernière lecture), persisté en
  // localStorage par utilisateur — alimente le badge non-lus de la sidebar et
  // le compteur du titre d'onglet.
  const [lastReadByChannel, setLastReadByChannel] = useState<Record<string, string>>({});
  // Notifie les événements realtime entrants (bannière) sans figer de vieux
  // états dans la closure de l'abonnement Supabase.
  const realtimeEventRef = useRef<((kind: 'message' | 'reserve', row: any) => void) | null>(null);
  const realtimeNoticedIdsRef = useRef<Set<string>>(new Set());
  const baseDocumentTitleRef = useRef<string>('');
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
  const [initialReportLanguage] = useState<SupportedLang | null>(readStoredExportLanguage);
  const [reportLanguage, setReportLanguageState] = useState<SupportedLang>(() => initialReportLanguage ?? getBrowserLang());
  const [hasStoredReportLanguage, setHasStoredReportLanguage] = useState(() => initialReportLanguage !== null);
  const setReportLanguage = useCallback((nextLanguage: SupportedLang) => {
    setReportLanguageState(nextLanguage);
    setHasStoredReportLanguage(true);
    if (typeof window !== 'undefined') window.localStorage.setItem(WEB_EXPORT_LANGUAGE_KEY, nextLanguage);
  }, []);
  const syncReportLanguageWithInterface = useCallback((nextLanguage: SupportedLang) => {
    if (!hasStoredReportLanguage) setReportLanguageState(nextLanguage);
  }, [hasStoredReportLanguage]);
  const [generatingReport, setGeneratingReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [textPrompt, setTextPrompt] = useState<WebTextPromptRequest | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('buildtrack-web-sidebar-collapsed') === '1';
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Keep the first server and client render deterministic. Browser and stored
  // preferences are applied after hydration, then the authenticated profile
  // may refine the choice once its workspace data has loaded.
  const [deviceLanguage, setDeviceLanguage] = useState<SupportedLang>('en');
  const [webLanguagePreference, setWebLanguagePreferenceState] = useState<WebLanguagePreference>('auto');
  const [webLang, setWebLangState] = useState<SupportedLang>('en');

  const handleWebLanguagePreferenceChange = useCallback(async (nextPreference: WebLanguagePreference) => {
    const nextDeviceLanguage = getBrowserLang();
    const nextProfileLanguage = nextPreference === 'auto' ? null : nextPreference;
    const nextLang = resolveWebLanguagePreference(nextPreference, nextProfileLanguage, nextDeviceLanguage);
    setDeviceLanguage(nextDeviceLanguage);
    setWebLanguagePreferenceState(nextPreference);
    setWebLangState(nextLang);
    syncReportLanguageWithInterface(nextLang);
    storeWebLanguagePreference(nextPreference, nextLang);

    const profileId = profile?.id ?? authUser?.id;
    if (!profileId) return;
    const { error: languageError } = await supabaseBrowser
      .from('profiles')
      .update({ preferred_language: nextProfileLanguage })
      .eq('id', profileId);
    if (languageError) {
      setError(translateWebStaticText("La langue a été changée localement, mais n'a pas encore pu être synchronisée.", nextLang));
      return;
    }
    setProfile(previous => previous ? { ...previous, preferred_language: nextProfileLanguage } : previous);
    setData(previous => ({
      ...previous,
      profiles: previous.profiles.map(user => user.id === profileId ? { ...user, preferred_language: nextProfileLanguage } : user),
    }));
  }, [authUser?.id, profile?.id, syncReportLanguageWithInterface]);

  const handleWebLangChange = useCallback(async (nextLang: SupportedLang) => {
    await handleWebLanguagePreferenceChange(nextLang);
  }, [handleWebLanguagePreferenceChange]);

  useEffect(() => {
    const nextDeviceLanguage = getBrowserLang();
    const storedPreference = readStoredWebLanguagePreference().preference;
    const nextLanguage = resolveWebLanguagePreference(storedPreference, null, nextDeviceLanguage);
    setDeviceLanguage(nextDeviceLanguage);
    setWebLanguagePreferenceState(storedPreference);
    setWebLangState(nextLanguage);
    syncReportLanguageWithInterface(nextLanguage);
  }, [syncReportLanguageWithInterface]);

  useEffect(() => {
    const nextOwner = authUser?.id ?? null;
    const previousOwner = previewCacheOwnerRef.current;
    if (previousOwner && nextOwner && previousOwner !== nextOwner) {
      void clearPlanPreviewsForUser(previousOwner);
    }
    if (nextOwner) previewCacheOwnerRef.current = nextOwner;
  }, [authUser?.id]);

  useEffect(() => {
    document.documentElement.lang = webLang;
  }, [webLang]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const updateDeviceLanguage = () => {
        const nextDeviceLanguage = getBrowserLang();
        setDeviceLanguage(nextDeviceLanguage);
        if (webLanguagePreference === 'auto' && !profile?.preferred_language) {
          setWebLangState(nextDeviceLanguage);
          syncReportLanguageWithInterface(nextDeviceLanguage);
          storeWebLanguagePreference('auto', nextDeviceLanguage);
        }
      };
      window.addEventListener('languagechange', updateDeviceLanguage);
      return () => window.removeEventListener('languagechange', updateDeviceLanguage);
    }
    return undefined;
  }, [profile?.preferred_language, syncReportLanguageWithInterface, webLanguagePreference]);

  const i18n = useMemo<WebI18nValue>(() => ({
    lang: webLang,
    languagePreference: webLanguagePreference,
    deviceLanguage,
    locale: localeForLang(webLang),
    t: createWebT(webLang),
    setLang: handleWebLangChange,
    setLanguagePreference: handleWebLanguagePreferenceChange,
  }), [deviceLanguage, handleWebLangChange, handleWebLanguagePreferenceChange, webLang, webLanguagePreference]);
  const { t } = i18n;
  const isWarehouseWebUser = profile?.role === 'magasinier';
  const isOrgAdminWebUser = String(profile?.role ?? '').toLowerCase() === 'admin';
  const isPlatformAdminWebUser = profile?.role === 'super_admin';
  const isConducteurWebUser = String(profile?.role ?? '').toLowerCase() === 'conducteur';
  const visibleNavigationGroups: { label: string; items: TabId[] }[] = isWarehouseWebUser
    ? [{ label: 'Navigation', items: ['inventory', 'settings'] }]
    : isPlatformAdminWebUser && !supportOrg
      ? [{ label: 'Navigation', items: ['admin'] }]
    : isPlatformAdminWebUser || isOrgAdminWebUser
      ? [{ label: 'Navigation', items: ['admin', 'dashboard', 'plans', 'reserves', 'terrain'] }]
    : isConducteurWebUser
      ? [{ label: 'Navigation', items: ['dashboard', 'plans', 'reserves', 'terrain'] }]
      : [{ label: 'Navigation', items: ['dashboard', 'plans', 'reserves', 'messages', 'terrain'] }];

  useEffect(() => {
    if (isWarehouseWebUser && activeTab !== 'inventory' && activeTab !== 'settings') {
      setActiveTab('inventory');
      setMobileNavOpen(false);
    }
  }, [activeTab, isWarehouseWebUser]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isOrgAdminWebUser) return;
    const saved = window.localStorage.getItem(WEB_LAST_TAB_KEY);
    if (!saved) {
      setActiveTab('admin');
      setMobileNavOpen(false);
    }
  }, [isOrgAdminWebUser]);

  useEffect(() => {
    if (!isPlatformAdminWebUser || supportOrg) return;
    setActiveTab('admin');
    setMobileNavOpen(false);
  }, [isPlatformAdminWebUser, supportOrg]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('buildtrack-web-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isWarehouseWebUser) return;
    window.localStorage.setItem(WEB_LAST_TAB_KEY, activeTab);
  }, [activeTab, isWarehouseWebUser]);

  const workspaceUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const nextUserId = authUser?.id ?? null;
    const previousUserId = workspaceUserIdRef.current;
    if (previousUserId === nextUserId) return;
    workspaceUserIdRef.current = nextUserId;

    if (previousUserId !== undefined || !nextUserId) {
      pendingWebPlanAnnotationsRef.current.clear();
      setProfile(null);
      setData(EMPTY_DATA);
      setStorageUsage(null);
      setError('');
      setNotice('');
      setSyncing(false);
      setSaving(false);
      setLastReadByChannel({});
      setMessageDraft('');
    }
    setLoading(Boolean(nextUserId));
  }, [authUser?.id]);

  useEffect(() => {
    if (!session?.user) {
      setLoading(false);
      return;
    }
    loadEverything(session.user);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    webAskTextImpl = (title, options = {}) => new Promise<string | null>(resolve => {
      setTextPrompt({ title, label: options.label, defaultValue: options.defaultValue, resolve });
    });
    return () => {
      webAskTextImpl = null;
    };
  }, []);

  function resolveTextPrompt(value: string | null) {
    if (!textPrompt) return;
    textPrompt.resolve(value);
    setTextPrompt(null);
  }

  // Realtime : les messages et réserves modifiés ailleurs (mobile, autres postes)
  // apparaissent sans devoir cliquer sur Synchroniser.
  // Bannière sur événement realtime entrant. Réassigné à chaque rendu pour
  // capturer l'état courant (onglet actif, canal ouvert, profil) sans figer la
  // closure de l'abonnement. Dédupliqué par id (l'echo realtime de nos propres
  // insertions est écarté en amont : la ligne existe déjà dans le state).
  realtimeEventRef.current = (kind, row) => {
    if (!row?.id) return;
    const noticedKey = `${kind}:${row.id}`;
    if (realtimeNoticedIdsRef.current.has(noticedKey)) return;
    realtimeNoticedIdsRef.current.add(noticedKey);
    if (realtimeNoticedIdsRef.current.size > 500) {
      realtimeNoticedIdsRef.current = new Set(Array.from(realtimeNoticedIdsRef.current).slice(-200));
    }
    const myName = profile?.name || authUser?.email || '';
    if (kind === 'message') {
      if (sameName(row.sender, myName)) return;
      const viewingChannel = activeTab === 'messages'
        && selectedChannelId === row.channel_id
        && typeof document !== 'undefined'
        && !document.hidden;
      if (viewingChannel) return;
      const preview = String(row.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      setNotice(`💬 ${row.sender ?? 'Message'} — ${preview || 'Nouveau message'}`);
    } else {
      const title = String(row.title ?? '').trim().slice(0, 80);
      setNotice(`🔔 Nouvelle réserve — ${title || row.id}`);
    }
  };

  useEffect(() => {
    if (!session?.user?.id || !profile?.organization_id) return;
    const orgFilter = `organization_id=eq.${profile.organization_id}`;
    if (profile.role === 'magasinier') {
      const warehouseChannel = supabaseBrowser
        .channel(`web-live-inventory-${session.user.id}`)
        .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'inventory_products', filter: orgFilter }, (payload: any) => {
          setData(prev => ({ ...prev, inventoryProducts: mergeRealtimeRow(prev.inventoryProducts, payload) }));
        })
        .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'inventory_movements', filter: orgFilter }, (payload: any) => {
          setData(prev => ({ ...prev, inventoryMovements: mergeRealtimeRow(prev.inventoryMovements, payload) }));
        })
        .subscribe();
      return () => { supabaseBrowser.removeChannel(warehouseChannel); };
    }
    const channel = supabaseBrowser
      .channel('web-live')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'messages', filter: orgFilter }, (payload: any) => {
        setData(prev => {
          const incoming = payload?.eventType === 'INSERT' ? payload?.new : null;
          if (incoming?.id && !prev.messages.some((m: any) => m.id === incoming.id)) {
            queueMicrotask(() => realtimeEventRef.current?.('message', incoming));
          }
          return { ...prev, messages: mergeRealtimeRow(prev.messages, payload) };
        });
      })
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'reserves', filter: orgFilter }, (payload: any) => {
        setData(prev => {
          const incoming = payload?.eventType === 'INSERT' ? payload?.new : null;
          if (incoming?.id && ![...prev.reserves, ...prev.deletedReserves].some((r: any) => r.id === incoming.id)) {
            queueMicrotask(() => realtimeEventRef.current?.('reserve', incoming));
          }
          const merged = mergeRealtimeRow([...prev.reserves, ...prev.deletedReserves], payload);
          const visible = visibleReservesForProfile(merged, profile, prev.companies);
          return {
            ...prev,
            reserves: visible.filter((reserve: any) => !isReserveDeleted(reserve)),
            deletedReserves: visible.filter((reserve: any) => isReserveDeleted(reserve)),
          };
        });
      })
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'inventory_products', filter: orgFilter }, (payload: any) => {
        setData(prev => ({ ...prev, inventoryProducts: mergeRealtimeRow(prev.inventoryProducts, payload) }));
      })
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'inventory_movements', filter: orgFilter }, (payload: any) => {
        setData(prev => ({ ...prev, inventoryMovements: mergeRealtimeRow(prev.inventoryMovements, payload) }));
      })
      .subscribe();
    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [session?.user?.id, profile?.organization_id, profile?.role]);

  // Persistance du suivi de lecture des messages (par utilisateur).
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(`buildtrack-web-last-read-v1-${userId}`);
      if (raw) setLastReadByChannel(previous => mergeMessageReadState(previous, JSON.parse(raw)));
    } catch {}
  }, [session?.user?.id]);
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || typeof window === 'undefined') return;
    if (!Object.keys(lastReadByChannel).length) return;
    try {
      window.localStorage.setItem(`buildtrack-web-last-read-v1-${userId}`, JSON.stringify(lastReadByChannel));
    } catch {}
  }, [lastReadByChannel, session?.user?.id]);

  // Première session : tous les canaux partent « lus maintenant » pour ne pas
  // afficher des centaines de non-lus historiques au premier chargement.
  // F5 / fermeture d'onglet pendant une saisie de modale : avertir avant de perdre le brouillon.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (reserveModalMode || visitModalOpen) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [reserveModalMode, visitModalOpen]);

  function applyPendingPlanAnnotationSnapshots(sitePlans: any[], ownerId: string | null) {
    const result = overlayPendingPlanAnnotationSnapshots(
      sitePlans,
      pendingWebPlanAnnotationsRef.current,
      ownerId,
    );
    for (const planId of result.acknowledgedIds) {
      const snapshot = pendingWebPlanAnnotationsRef.current.get(planId);
      if (snapshot && snapshot.ownerId === ownerId && !snapshot.pending) {
        pendingWebPlanAnnotationsRef.current.delete(planId);
      }
    }
    return result.plans;
  }

  async function loadEverything(user: SupabaseUser, opts: { background?: boolean } = {}) {
    const loadLease = authLoadGuard.begin(user.id);
    if (!loadLease.isCurrent()) return;
    if (opts.background) setSyncing(true);
    else setLoading(true);
    setError('');
    let loadT = t;
    const failedTables: string[] = [];
    const onError = (table: string) => {
      if (!failedTables.includes(table)) failedTables.push(table);
    };
    try {
      let { data: profileRows, error: profileError } = await supabaseBrowser
        .rpc('get_profile_for_current_user');
      if (!loadLease.isCurrent()) return;
      if (profileError) throw profileError;
      if (!Array.isArray(profileRows) || profileRows.length === 0) {
        const { error: ensureError } = await supabaseBrowser.rpc('ensure_current_user_profile', {
          p_name: user.user_metadata?.full_name ?? null,
        });
        if (!loadLease.isCurrent()) return;
        if (ensureError) throw ensureError;
        const refreshed = await supabaseBrowser.rpc('get_profile_for_current_user');
        if (!loadLease.isCurrent()) return;
        profileRows = refreshed.data;
        profileError = refreshed.error;
        if (profileError) throw profileError;
      }
      const loadedProfile = ((Array.isArray(profileRows) ? profileRows[0] : null) ?? null) as Profile | null;
      if (!loadedProfile) {
        setError(t('login.missingProfile'));
        return;
      }

      const storedPreference = readStoredWebLanguagePreference();
      const profileLanguage = loadedProfile.preferred_language ? normalizeLang(loadedProfile.preferred_language) : null;
      const nextPreference: WebLanguagePreference = storedPreference.hasStored
        ? storedPreference.preference
        : profileLanguage ?? 'auto';
      const nextDeviceLanguage = getBrowserLang();
      const preferredLang = resolveWebLanguagePreference(nextPreference, profileLanguage, nextDeviceLanguage);
      loadT = createWebT(preferredLang);
      setDeviceLanguage(nextDeviceLanguage);
      setWebLanguagePreferenceState(nextPreference);
      if (preferredLang !== webLang) {
        setWebLangState(preferredLang);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(WEB_LANGUAGE_LEGACY_KEY, preferredLang);
        }
      }
      syncReportLanguageWithInterface(preferredLang);
      setProfile({ ...loadedProfile, preferred_language: profileLanguage });
      setLastReadByChannel(previous => mergeMessageReadState(
        loadedProfile.last_read_by_channel,
        previous,
      ));
      // The authoritative role is now known. Reveal the workspace immediately
      // and keep the wider data refresh visible as a non-blocking sync.
      setLoading(false);
      setSyncing(true);

      if (loadedProfile.role === 'magasinier') {
        setActiveTab('inventory');
        const [chantiers, companies, organizations, notificationPreferences, inventoryProducts, inventoryMovements] = await Promise.all([
          fetchScopedTable('chantiers', loadedProfile, { order: 'created_at', onError }),
          fetchScopedTable('companies', loadedProfile, { order: 'name', ascending: true, onError }),
          fetchScopedTable<Organization>('organizations', loadedProfile, { order: 'name', ascending: true, scoped: false, onError }),
          fetchScopedTable('notification_preferences', loadedProfile, { scoped: false, onError }),
          fetchScopedTable('inventory_products', loadedProfile, { order: 'reference', ascending: true, onError }),
          fetchScopedTable('inventory_movements', loadedProfile, { order: 'created_at', ascending: false, onError }),
        ]);
        if (!loadLease.isCurrent()) return;
        setStorageUsage(null);
        setData({
          ...EMPTY_DATA,
          chantiers,
          companies,
          organizations,
          notificationPreferences,
          inventoryProducts,
          inventoryMovements,
        });
        setSelectedProjectId(prev => prev !== 'all' && chantiers.some((chantier: any) => chantier.id === prev) ? prev : chantiers[0]?.id ?? 'all');
        if (failedTables.length) {
          setError(loadT('sync.partialInventoryLoad', { tables: failedTableList(loadT, failedTables) }));
        }
        return;
      }

      // Storage usage is informational and must never hold the workspace open.
      void Promise.resolve((supabaseBrowser as any).rpc('get_storage_usage_guardrail', {
        p_warning_mb: 850,
        p_critical_mb: 950,
      })).then(({ data: storageGuardrail, error: storageGuardrailError }) => {
        if (!loadLease.isCurrent()) return;
        setStorageUsage(storageGuardrailError ? null : (storageGuardrail as StorageUsageGuardrail));
      }).catch(() => {
        if (loadLease.isCurrent()) setStorageUsage(null);
      });

      // Start every independent request in the same wave. Documents and the
      // project list publish progressively instead of waiting for slow media or
      // secondary modules to finish.
      const chantiersPromise = publishWhenCurrent(
        fetchScopedTable('chantiers', loadedProfile, { order: 'created_at', onError }),
        loadLease,
        chantiers => {
          setData(previous => ({ ...previous, chantiers }));
          setSelectedProjectId(previous => previous !== 'all' && chantiers.some((chantier: any) => chantier.id === previous)
            ? previous
            : chantiers[0]?.id ?? 'all');
        },
      );
      const documentsPromise = publishWhenCurrent(
        loadedProfile.role === 'sous_traitant'
          ? Promise.resolve<any[]>([])
          : fetchScopedTable('documents', loadedProfile, { order: 'uploaded_at', onError }),
        loadLease,
        documents => setData(previous => ({ ...previous, documents })),
      );
      const reservesPromise = fetchScopedTable('reserves', loadedProfile, { order: 'created_at', onError });
      const sitePlansPromise = publishWhenCurrent(
        fetchScopedTable('site_plans', loadedProfile, { order: 'created_at', onError }),
        loadLease,
        sitePlans => {
          const protectedSitePlans = applyPendingPlanAnnotationSnapshots(sitePlans, user.id);
          setData(previous => ({ ...previous, sitePlans: protectedSitePlans }));
          setSelectedPlanId(previous => previous && protectedSitePlans.some((plan: any) => plan.id === previous)
            ? previous
            : protectedSitePlans[0]?.id ?? null);
        },
      );
      const companiesPromise = fetchScopedTable('companies', loadedProfile, { order: 'name', ascending: true, onError });
      const organizationsPromise = fetchScopedTable<Organization>('organizations', loadedProfile, { order: 'name', ascending: true, scoped: false, onError });
      const visitesPromise = fetchScopedTable('visites', loadedProfile, { order: 'created_at', onError });
      const messagesPromise = fetchScopedTable('messages', loadedProfile, { order: 'created_at', ascending: false, limit: 800, onError });
      const channelsPromise = fetchScopedTable('channels', loadedProfile, { order: 'created_at', onError });
      const profilesPromise = fetchOrgUsers(onError);
      const lotsPromise = fetchScopedTable('lots', loadedProfile, { order: 'name', ascending: true, onError });
      const tasksPromise = fetchScopedTable('tasks', loadedProfile, { order: 'created_at', onError });
      const incidentsPromise = fetchScopedTable('incidents', loadedProfile, { order: 'created_at', onError });
      const photosPromise = fetchScopedTable('photos', loadedProfile, { order: 'taken_at', scoped: false, onError });
      const oprsPromise = fetchScopedTable('oprs', loadedProfile, { order: 'created_at', onError });
      const timeEntriesPromise = fetchScopedTable('time_entries', loadedProfile, { order: 'created_at', onError });
      const regulatoryDocsPromise = loadedProfile.role === 'sous_traitant'
        ? Promise.resolve<any[]>([])
        : fetchScopedTable('regulatory_docs', loadedProfile, { order: 'created_at', onError });
      const notificationPreferencesPromise = fetchScopedTable('notification_preferences', loadedProfile, { scoped: false, onError });
      const journalEntriesPromise = fetchScopedTable('journal_entries', loadedProfile, { order: 'entry_date', onError });
      const checklistsPromise = fetchScopedTable('checklists', loadedProfile, { order: 'created_at', onError });
      const inventoryProductsPromise = canViewInventory(loadedProfile)
        ? fetchScopedTable('inventory_products', loadedProfile, { order: 'reference', ascending: true, onError })
        : Promise.resolve<any[]>([]);
      const inventoryMovementsPromise = canViewInventory(loadedProfile)
        ? fetchScopedTable('inventory_movements', loadedProfile, { order: 'created_at', ascending: false, onError })
        : Promise.resolve<any[]>([]);

      const [
        chantiers,
        reserves,
        sitePlans,
        companies,
        organizations,
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
        timeEntries,
        regulatoryDocs,
        notificationPreferences,
        journalEntries,
        checklists,
        inventoryProducts,
        inventoryMovements,
      ] = await Promise.all([
        chantiersPromise,
        reservesPromise,
        sitePlansPromise,
        companiesPromise,
        organizationsPromise,
        visitesPromise,
        messagesPromise,
        channelsPromise,
        profilesPromise,
        lotsPromise,
        tasksPromise,
        incidentsPromise,
        documentsPromise,
        photosPromise,
        oprsPromise,
        timeEntriesPromise,
        regulatoryDocsPromise,
        notificationPreferencesPromise,
        journalEntriesPromise,
        checklistsPromise,
        inventoryProductsPromise,
        inventoryMovementsPromise,
      ]);
      if (!loadLease.isCurrent()) return;

      const visibleScopedReserves = visibleReservesForProfile(reserves, loadedProfile, companies);
      const scopedReserves = visibleScopedReserves.filter((reserve: any) => !isReserveDeleted(reserve));
      const scopedDeletedReserves = visibleScopedReserves.filter((reserve: any) => isReserveDeleted(reserve));
      const scopedReserveIds = new Set(visibleScopedReserves.map((reserve: any) => String(reserve.id)));
      const scopedPhotos = loadedProfile.role === 'sous_traitant'
        ? photos.filter((photo: any) => {
            const reserveId = photo.reserve_id ?? photo.reserveId;
            return reserveId && scopedReserveIds.has(String(reserveId));
          })
        : photos;
      const scopedDocuments = loadedProfile.role === 'sous_traitant' ? [] : documents;
      const protectedSitePlans = applyPendingPlanAnnotationSnapshots(sitePlans, user.id);

      const nextData = {
        chantiers,
        reserves: scopedReserves,
        deletedReserves: scopedDeletedReserves,
        sitePlans: protectedSitePlans,
        companies,
        organizations,
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
        timeEntries,
        regulatoryDocs: loadedProfile.role === 'sous_traitant' ? [] : regulatoryDocs,
        notificationPreferences,
        journalEntries,
        checklists,
        inventoryProducts,
        inventoryMovements,
      };
      setData(nextData);
      setSelectedProjectId(prev => prev !== 'all' && chantiers.some((c: any) => c.id === prev) ? prev : chantiers[0]?.id ?? 'all');
      setSelectedReserveId(prev => prev && scopedReserves.some((r: any) => r.id === prev) ? prev : null);
      setSelectedPlanId(prev => prev && protectedSitePlans.some((p: any) => p.id === prev) ? prev : protectedSitePlans[0]?.id ?? null);
      setSelectedChannelId(prev => prev && channels.some((c: any) => c.id === prev) ? prev : channels[0]?.id ?? null);
      if (failedTables.length) {
        setError(loadT('sync.partialLoad', { tables: failedTableList(loadT, failedTables) }));
      }
    } catch (err: any) {
      if (loadLease.isCurrent()) setError(err?.message ?? loadT('login.loadError'));
    } finally {
      if (loadLease.isCurrent()) {
        setLoading(false);
        setSyncing(false);
      }
    }
  }

  async function handleSignOut() {
    const ownerId = authUser?.id ?? null;
    previewCacheOwnerRef.current = null;
    await authenticatedWorkspace.signOut();
    if (ownerId) await clearPlanPreviewsForUser(ownerId);
  }

  async function patchReserveWeb(reserve: any, patch: Record<string, any>) {
    if (!reserve?.id) return false;
    setSaving(true);
    setError('');
    const { data: updated, error: updateError } = await supabaseBrowser
      .from('reserves')
      .update(patch)
      .eq('id', reserve.id)
      .select()
      .maybeSingle();
    if (updateError) {
      setError(updateError.message);
    } else {
      setData(prev => ({
        ...prev,
        reserves: prev.reserves.map(r => r.id === reserve.id ? (updated ?? { ...r, ...patch }) : r),
        deletedReserves: prev.deletedReserves.map(r => r.id === reserve.id ? (updated ?? { ...r, ...patch }) : r),
      }));
      // Point de passage de tous les changements de statut côté web (tunnel,
      // levée, clôture…) → notifie les entreprises concernées sur mobile.
      const previousStatus = String(reserve.status ?? '');
      const nextStatus = typeof patch.status === 'string' ? patch.status : null;
      if (nextStatus && nextStatus !== previousStatus) {
        triggerWebPush({ type: 'reserve-status-changed', reserveId: String(reserve.id), newStatus: nextStatus, previousStatus });
      }
    }
    setSaving(false);
    return !updateError;
  }

  async function updateReserveStatus(reserveId: string, status: string) {
    const reserve = [...data.reserves, ...data.deletedReserves].find(r => r.id === reserveId);
    if (!reserve || !canUseReserveTunnel(profile)) return;

    const currentStatus = String(reserve.status ?? 'open');
    if (!canEdit(profile)) {
      const allowedForSubcontractor =
        (status === 'in_progress' && currentStatus === 'open') ||
        (status === 'verification' && ['open', 'in_progress', 'waiting'].includes(currentStatus));
      if (!allowedForSubcontractor) {
        setError("Action non autorisée pour un sous-traitant.");
        return;
      }
    }

    const author = userLabel(profile, authUser);
    const history = [
      ...(Array.isArray(reserve.history) ? reserve.history : []),
      makeHistory('Statut modifié depuis le web', author, statusLabel(currentStatus), statusLabel(status)),
    ];
    const patch: Record<string, any> = { status, history };
    if (status === 'closed' && currentStatus !== 'closed') {
      patch.closed_at = todayISO();
      patch.closed_by = author;
    } else if (status !== 'closed' && currentStatus === 'closed') {
      patch.closed_at = null;
      patch.closed_by = null;
    }
    await patchReserveWeb(reserve, patch);
  }

  async function requestReserveLiftWeb(reserve: any, payload: { comment: string; file: File | null }) {
    if (!reserve?.id || !canUseReserveTunnel(profile)) return;
    const currentStatus = String(reserve.status ?? 'open');
    if (!['open', 'in_progress', 'waiting'].includes(currentStatus)) {
      setError('Cette réserve ne peut pas être envoyée en demande de levée depuis son statut actuel.');
      throw new Error('Invalid reserve status for lift request');
    }
    if (!canEdit(profile)) {
      const allowedForSubcontractor = isSubcontractor(profile);
      if (!allowedForSubcontractor) {
        setError("Action non autorisée pour ce profil.");
        throw new Error('Unauthorized lift request');
      }
    }

    setSaving(true);
    setError('');
    try {
      const author = userLabel(profile, authUser);
      const trimmedComment = payload.comment.trim();
      const createdAt = nowISO();
      let uploadedPhoto: any = null;
      let photoRow: any = null;

      if (payload.file) {
        const url = await uploadWebFile('photos', payload.file, `reserve_${reserve.id}_lift`);
        const photoId = crypto.randomUUID();
        uploadedPhoto = {
          id: photoId,
          uri: url,
          kind: 'resolution',
          takenAt: createdAt,
          takenBy: author,
          name: payload.file.name,
          annotations: [],
        };
        photoRow = {
          id: photoId,
          comment: 'Photo de levée',
          location: [reserve.building, reserve.level, reserve.zone].filter(Boolean).join(' · '),
          taken_at: createdAt,
          taken_by: author,
          color_code: '#10b981',
          uri: url,
          reserve_id: reserve.id,
          organization_id: profile?.organization_id ?? null,
        };
        const { error: photoInsertError } = await supabaseBrowser.from('photos').insert(photoRow);
        if (photoInsertError) throw photoInsertError;
      }

      const comments = trimmedComment
        ? [
          ...(Array.isArray(reserve.comments) ? reserve.comments : []),
          { id: crypto.randomUUID(), author, content: `Demande de levée : ${trimmedComment}`, createdAt },
        ]
        : reserve.comments ?? [];
      const photos = uploadedPhoto
        ? [...(Array.isArray(reserve.photos) ? reserve.photos : []), uploadedPhoto]
        : reserve.photos ?? null;
      const history = [
        ...(Array.isArray(reserve.history) ? reserve.history : []),
        makeHistory('Statut modifié depuis le web', author, statusLabel(currentStatus), statusLabel('verification')),
        makeHistory(
          'Demande de levée depuis le web',
          author,
          undefined,
          [
            trimmedComment ? 'Commentaire ajouté' : null,
            uploadedPhoto ? 'Photo ajoutée' : null,
          ].filter(Boolean).join(', ') || 'Sans commentaire/photo',
        ),
      ];
      const patch: Record<string, any> = {
        status: 'verification',
        comments,
        history,
        photos,
        photo_uri: reserve.photo_uri ?? reserve.photoUri ?? (Array.isArray(reserve.photos) ? reserve.photos[0]?.uri : null) ?? uploadedPhoto?.uri ?? null,
        closed_at: null,
        closed_by: null,
      };
      const ok = await patchReserveWeb(reserve, patch);
      if (!ok) throw new Error('Lift request update failed');
      if (photoRow) {
        setData(prev => ({ ...prev, photos: [photoRow, ...prev.photos] }));
      }
    } catch (err: any) {
      setError(err?.message ?? 'Demande de levée impossible.');
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function acknowledgeReserveWeb(reserve: any) {
    if (!canEdit(profile) || !reserve?.id) return;
    const author = userLabel(profile, authUser);
    const acknowledgedAt = reserve.enterprise_acknowledged_at ?? todayISO();
    await patchReserveWeb(reserve, {
      enterprise_acknowledged_at: acknowledgedAt,
      history: [
        ...(Array.isArray(reserve.history) ? reserve.history : []),
        makeHistory('Réception accusée depuis le web', author),
      ],
    });
  }

  async function signReserveWeb(reserve: any, companyName?: string) {
    if (!reserve?.id || !canUseReserveTunnel(profile)) return;
    const acknowledgedAt = reserve.enterprise_acknowledged_at ?? reserve.enterpriseAcknowledgedAt;
    if (!acknowledgedAt) {
      setError("L'accusé de réception doit être enregistré avant la signature.");
      return;
    }
    const defaultName = userLabel(profile, authUser);
    const signataire = (await askTextDialog('Nom du signataire', { defaultValue: defaultName }))?.trim();
    if (!signataire) return;
    const signedAt = todayISO();
    const signature = makeTypedSignatureDataUrl(signataire, signedAt);
    const isMultiCompany = reserveCompanies(reserve).length > 1;
    const historyAction = companyName && isMultiCompany
      ? `Levée signée depuis le web (${companyName})`
      : 'Levée signée depuis le web';

    if (companyName && isMultiCompany) {
      await patchReserveWeb(reserve, {
        company_signatures: {
          ...reserveCompanySignatures(reserve),
          [companyName]: { signature, signataire, signedAt },
        },
        history: [
          ...(Array.isArray(reserve.history) ? reserve.history : []),
          makeHistory(historyAction, signataire),
        ],
      });
      return;
    }

    await patchReserveWeb(reserve, {
      enterprise_signature: signature,
      enterprise_signataire: signataire,
      history: [
        ...(Array.isArray(reserve.history) ? reserve.history : []),
        makeHistory(historyAction, signataire),
      ],
    });
  }

  async function rejectReserveVerificationWeb(reserve: any) {
    if (!canEdit(profile) || !reserve?.id || reserve.status !== 'verification') return;
    const reason = (await askTextDialog('Motif du refus de levée (optionnel)'))?.trim() ?? '';
    const author = userLabel(profile, authUser);
    const comments = reason
      ? [
        ...(Array.isArray(reserve.comments) ? reserve.comments : []),
        { id: crypto.randomUUID(), author, content: `Levée rejetée : ${reason}`, createdAt: nowISO() },
      ]
      : reserve.comments ?? [];
    await patchReserveWeb(reserve, {
      status: 'in_progress',
      comments,
      history: [
        ...(Array.isArray(reserve.history) ? reserve.history : []),
        makeHistory('Levée rejetée depuis le web', author, statusLabel('verification'), statusLabel('in_progress')),
      ],
    });
  }

  async function moveReservePinWeb(reserve: any, plan: any, x: number, y: number) {
    if (!canMovePins(profile) || !reserve?.id || !plan?.id) return false;
    const nextX = normalizePlanPercent(x);
    const nextY = normalizePlanPercent(y);
    const storedX = normalizeStoredPlanPercent(nextX);
    const storedY = normalizeStoredPlanPercent(nextY);
    if (nextX == null || nextY == null || storedX == null || storedY == null) return false;

    const history = [
      ...(Array.isArray(reserve.history) ? reserve.history : []),
      makeHistory('Épingle déplacée depuis le web', userLabel(profile, authUser)),
    ];
    const patch = {
      plan_id: plan.id,
      plan_x: storedX,
      plan_y: storedY,
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

  // Démarre le flux « Placer sur le plan » depuis la fiche d'une réserve sans
  // épingle : on choisit le plan le plus pertinent (même bâtiment/niveau si
  // possible), on bascule sur l'onglet Plans et on arme le mode placement.
  function locateReserveOnPlanWeb(reserve: any) {
    if (!canMovePins(profile) || !reserve?.id) return;
    const reserveChantierId = String(reserve.chantier_id ?? reserve.chantierId ?? '');
    const candidatePlans = data.sitePlans.filter((plan: any) => {
      if (!reserveChantierId) return true;
      const planChantierId = String(plan?.chantier_id ?? plan?.chantierId ?? '');
      return !planChantierId || planChantierId === reserveChantierId;
    });
    if (candidatePlans.length === 0) {
      setError("Aucun plan disponible pour localiser cette réserve. Importez d'abord un plan dans l'onglet Plans.");
      return;
    }
    const score = (plan: any) => {
      let s = 0;
      const rb = String(reserve.building_id ?? reserve.buildingId ?? '');
      const pb = String(plan?.building_id ?? plan?.buildingId ?? '');
      if (rb && pb && rb === pb) s += 2;
      else if (reserve.building && getPlanBuildingName(plan) === reserve.building) s += 1;
      const rl = String(reserve.level_id ?? reserve.levelId ?? '');
      const pl = String(plan?.level_id ?? plan?.levelId ?? '');
      if (rl && pl && rl === pl) s += 4;
      else if (reserve.level && getPlanLevelName(plan) === reserve.level) s += 2;
      return s;
    };
    const best = [...candidatePlans].sort((a, b) => score(b) - score(a))[0];
    setError('');
    setSelectedReserveId(reserve.id);
    setPlacementReserveId(reserve.id);
    setSelectedPlanId(best.id);
    setActiveTab('plans');
  }

  function updatePlanAnnotationsWeb(plan: any, annotations: PlanDrawing[]) {
    if (!canCreate(profile) || !plan?.id) return;
    const ownerId = authUser?.id ?? null;
    const planId = String(plan.id);
    const pendingSnapshot = createPendingPlanAnnotationSnapshot(ownerId, annotations, true);
    pendingWebPlanAnnotationsRef.current.set(planId, pendingSnapshot);
    setData(prev => ({
      ...prev,
      // Preserve this exact array identity for the reader's optimistic echo;
      // the durable queue receives the sanitized canonical snapshot below.
      sitePlans: prev.sitePlans.map(item => item.id === plan.id ? { ...item, annotations } : item),
    }));
    void webPlanAnnotationWriteQueue.enqueue(
      `${ownerId ?? 'anonymous'}:${planId}`,
      [...pendingSnapshot.annotations],
      async latestAnnotations => {
        if (authUserIdRef.current !== ownerId) throw new Error('annotation_owner_changed');
        const { error: annotationError } = await supabaseBrowser
          .from('site_plans')
          .update({ annotations: latestAnnotations })
          .eq('id', plan.id);
        if (authUserIdRef.current !== ownerId) throw new Error('annotation_owner_changed');
        if (annotationError) throw annotationError;

        const current = pendingWebPlanAnnotationsRef.current.get(planId);
        const latestSignature = getCanonicalPlanAnnotationSignature(latestAnnotations);
        if (current?.ownerId === ownerId && current.signature === latestSignature) {
          pendingWebPlanAnnotationsRef.current.set(
            planId,
            createPendingPlanAnnotationSnapshot(ownerId, latestAnnotations, false),
          );
        }
      },
      (annotationError, failedAnnotations) => {
        if (authUserIdRef.current !== ownerId) return;
        const current = pendingWebPlanAnnotationsRef.current.get(planId);
        if (current?.signature === getCanonicalPlanAnnotationSignature(failedAnnotations)) {
          pendingWebPlanAnnotationsRef.current.delete(planId);
        }
        setError(annotationError instanceof Error ? annotationError.message : 'Enregistrement des annotations impossible.');
        if (authUser) void loadEverything(authUser);
      },
    ).catch(() => undefined);
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
    if (!canDelete(profile) || !reserve?.id) return;
    const confirmed = window.confirm(`Mettre la réserve ${reserve.id} en corbeille ? Elle sera masquée mais récupérable depuis Supabase.`);
    if (!confirmed) return;
    setSaving(true);
    setError('');
    const deletedBy = profile?.name ?? profile?.email ?? 'Web';
    const patch = {
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
      history: [
        ...(Array.isArray(reserve.history) ? reserve.history : []),
        makeHistory('Supprimée depuis le web (corbeille)', deletedBy, 'Active', 'Corbeille'),
      ],
    };
    const { error: deleteError } = await supabaseBrowser.from('reserves').update(patch).eq('id', reserve.id);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setData(prev => {
        const reserves = prev.reserves.filter(item => item.id !== reserve.id);
        const deletedReserve = { ...reserve, ...patch };
        setSelectedReserveId(current => current === reserve.id ? null : current);
        return {
          ...prev,
          reserves,
          deletedReserves: [deletedReserve, ...prev.deletedReserves.filter(item => item.id !== reserve.id)],
        };
      });
    }
    setSaving(false);
  }

  async function restoreReserveWeb(reserve: any) {
    if (!canEdit(profile) || !reserve?.id) return;
    const confirmed = window.confirm(`Restaurer la réserve ${reserve.id} dans la liste active ?`);
    if (!confirmed) return;
    setSaving(true);
    setError('');
    const restoredBy = profile?.name ?? profile?.email ?? 'Web';
    const patch = {
      deleted_at: null,
      deleted_by: null,
      history: [
        ...(Array.isArray(reserve.history) ? reserve.history : []),
        makeHistory('Restaurée depuis la corbeille web', restoredBy, 'Corbeille', 'Active'),
      ],
    };
    const { error: restoreError } = await supabaseBrowser.from('reserves').update(patch).eq('id', reserve.id);
    if (restoreError) {
      setError(restoreError.message);
    } else {
      setData(prev => {
        const restoredReserve = { ...reserve, ...patch };
        const deletedReserves = prev.deletedReserves.filter(item => item.id !== reserve.id);
        setSelectedReserveId(current => current === reserve.id ? null : current);
        return {
          ...prev,
          deletedReserves,
          reserves: [restoredReserve, ...prev.reserves.filter(item => item.id !== reserve.id)],
        };
      });
    }
    setSaving(false);
  }

  async function permanentlyDeleteReserveWeb(reserve: any) {
    if (!canPermanentlyDeleteReserve(profile) || !reserve?.id) return;
    const confirmed = window.confirm(
      `Supprimer définitivement la réserve ${reserve.id} ?\n\nCette action est irréversible. La réserve disparaîtra de la corbeille et ne pourra plus être restaurée.`,
    );
    if (!confirmed) return;
    setSaving(true);
    setError('');
    const { data: deletedRows, error: deleteError } = await supabaseBrowser
      .from('reserves')
      .delete()
      .eq('id', reserve.id)
      .select('id');
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setData(prev => {
        const deletedReserves = prev.deletedReserves.filter(item => item.id !== reserve.id);
        setSelectedReserveId(current => current === reserve.id ? null : current);
        return {
          ...prev,
          reserves: prev.reserves.filter(item => item.id !== reserve.id),
          deletedReserves,
        };
      });
      if (!deletedRows?.length) {
        setError('Aucune ligne supprimée côté serveur. La réserve était peut-être déjà absente.');
      }
    }
    setSaving(false);
  }

  async function addReserveComment(reserve: any, content: string) {
    if (!profile || !content.trim()) return;
    const nextComment = {
      id: crypto.randomUUID(),
      author: userLabel(profile, authUser),
      content: content.trim(),
      createdAt: nowISO(),
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
      const updates = await runInBatches(missing, 8, async reserve => {
        const history = [
          ...(reserve.history ?? []),
          makeHistory('Description complétée depuis le web', userLabel(profile, authUser), reserve.description ?? '', reserve.title),
        ];
        const patch = { description: reserve.title, history };
        const { error: updateError } = await supabaseBrowser.from('reserves').update(patch).eq('id', reserve.id);
        if (updateError) throw updateError;
        return { id: reserve.id, ...patch };
      });
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
    const langLabel = translateWebStaticText(TEXT_LANG_OPTIONS.find(option => option.value === language)?.label ?? language.toUpperCase(), webLang);
    if (!candidates.length) {
      setError('Aucune réserve à traduire dans cette sélection.');
      return;
    }
    if (!window.confirm(`Traduire les titres, descriptions et commentaires de ${candidates.length} réserve${candidates.length > 1 ? 's' : ''} en ${langLabel} ?`)) return;
    setSaving(true);
    setError('');
    try {
      const updates = await runInBatches(candidates, 4, async reserve => {
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
        return { id: reserve.id, ...patch };
      });
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
    if (!canCreate(profile)) return;
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
    if (!canEdit(profile)) return;
    setError('');
    setEditingReserveId(reserve.id);
    setReserveDraft(reserveToDraft(reserve));
    setReserveModalMode('edit');
  }

  function closeReserveModal() {
    setReserveModalMode(null);
    setEditingReserveId(null);
  }

  // Fermeture demandée par l'utilisateur (Annuler, Fermer, Échap) :
  // confirmation si le brouillon contient une saisie qui serait perdue.
  function requestCloseReserveModal() {
    const hasDraftContent = reserveModalMode === 'create' && (
      reserveDraft.title.trim() ||
      reserveDraft.description.trim() ||
      reserveDraft.photos.length > 0 ||
      reserveDraft.companies.length > 0
    );
    if (hasDraftContent && !window.confirm('Fermer sans enregistrer ? La saisie en cours sera perdue.')) return;
    closeReserveModal();
  }

  function openVisitCreate() {
    if (!canCreate(profile)) return;
    setError('');
    setVisitDraft(createVisitDraft(currentProjectId(), userLabel(profile, authUser), webLang));
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
      const results = await Promise.all(updates);
      const updateError = results.map((result: any) => result?.error).find(Boolean);
      if (updateError) {
        setError(updateError.message ?? 'Impossible de mettre à jour le lien visite/réserve.');
        return;
      }
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

  async function buildReservePhotoPatch(
    reserveId: string,
    draft: ReserveDraft,
    options: { insertPhotoRows?: boolean } = {},
  ) {
    const existingPhotos = draft.photos
      .filter(photo => photo.existing && photo.uri)
      .map(photo => ({
        // Photo existante : on repart de l'objet JSONB d'origine (takenAt,
        // takenBy, label, gpsLat/gpsLon... préservés) et on ne surcharge que
        // les champs réellement éditables côté web (kind, annotations).
        ...(photo.original ?? {}),
        id: photo.id,
        uri: photo.original?.uri ?? photo.uri,
        kind: photo.kind ?? 'defect',
        name: photo.original?.name ?? photo.name ?? 'Photo',
        annotations: normalizePhotoAnnotations(photo.annotations),
      }));
    const newPhotos = draft.photos.filter(photo => photo.file);
    // Uploads en parallèle : 6 photos = 1 aller-retour au lieu de 6 en série.
    const uploaded = await Promise.all(newPhotos.map(async photo => {
      if (!photo.file) return null;
      const url = await uploadWebFile('photos', photo.file, `reserve_${reserveId}_${photo.kind ?? 'defect'}`);
      return { photo, url, takenAt: new Date().toISOString(), photoId: crypto.randomUUID() };
    }));
    const uploadedPhotos: any[] = [];
    const photoRows: any[] = [];
    for (const item of uploaded) {
      if (!item) continue;
      const { photo, url, takenAt, photoId } = item;
      uploadedPhotos.push({
        id: photoId,
        uri: url,
        kind: photo.kind ?? 'defect',
        takenAt,
        takenBy: userLabel(profile, authUser),
        name: photo.name ?? photo.file?.name,
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
    if (photoRows.length && options.insertPhotoRows !== false) {
      const { error: photoInsertError } = await supabaseBrowser.from('photos').insert(photoRows);
      if (photoInsertError) throw photoInsertError;
      setData(prev => ({ ...prev, photos: [...photoRows, ...prev.photos] }));
    }
    const photos = [...existingPhotos, ...uploadedPhotos];
    return {
      photos: photos.length ? photos : null,
      photo_uri: photos[0]?.uri ?? null,
      photoRows,
    };
  }

  async function submitReserve(event: React.FormEvent) {
    event.preventDefault();
    const isEditingReserve = reserveModalMode === 'edit' && Boolean(editingReserveId);
    if (!profile || (isEditingReserve ? !canEdit(profile) : !canCreate(profile))) return;
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
      plan_x: reserveDraft.planId ? normalizeStoredPlanPercent(reserveDraft.planX) : null,
      plan_y: reserveDraft.planId ? normalizeStoredPlanPercent(reserveDraft.planY) : null,
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
        const previousStatus = String(existing?.status ?? '');
        if (basePayload.status && basePayload.status !== previousStatus) {
          triggerWebPush({ type: 'reserve-status-changed', reserveId: String(editingReserveId), newStatus: basePayload.status, previousStatus });
        }
        closeReserveModal();
        setNotice('Réserve mise à jour.');
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
      try {
        const photoPatch = await buildReservePhotoPatch(id, reserveDraft, { insertPhotoRows: false });
        const reservePayload = { ...insertPayload, photos: photoPatch.photos, photo_uri: photoPatch.photo_uri };
        const { data: inserted, error: insertError } = await (supabaseBrowser as any).rpc('create_reserve_with_photos', {
          p_reserve: reservePayload,
          p_photo_rows: photoPatch.photoRows ?? [],
        });
        if (insertError) throw insertError;
        const finalReserve = Array.isArray(inserted) ? (inserted[0] ?? reservePayload) : (inserted ?? reservePayload);
        setData(prev => ({ ...prev, reserves: [finalReserve, ...prev.reserves] }));
        await syncVisitReserveLink(id, reserveDraft.visiteId || null, null);
        triggerWebPush({ type: 'reserve-created', reserveId: String(id) });
        const createdWithPin = basePayload.plan_x != null && basePayload.plan_y != null;
        if (reserveDraft.planId && createdWithPin) {
          setSelectedReserveId(id);
          setSelectedPlanId(reserveDraft.planId);
          setActiveTab('plans');
        } else {
          openReserveDetailTab(id, finalReserve);
        }
        closeReserveModal();
        setNotice('Réserve créée.');
      } catch (insertError: any) {
        setError(insertError?.message ?? 'Création de la réserve impossible.');
      }
    }
    setSaving(false);
  }

  async function submitVisit(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !canCreate(profile)) return;
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
      title: recurrenceOffsets.length > 1 ? `${title} — ${visitWeekPrefix(webLang)}${index + 1}` : title,
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
      setNotice(payloads.length > 1 ? `${payloads.length} visites créées.` : 'Visite créée.');
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
    if (!profile || !canCreate(profile) || !visit?.id || reserveIds.length === 0) return;
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
    if (!profile || !canDelete(profile) || !visit?.id) return;
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
    if (!canUpdateAttendance(profile)) return;
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

  async function createCompanyWeb(payload: { name: string; email?: string; contact?: string; siret?: string; short_name?: string; insurance?: string; lots?: string[] }) {
    if (!isAdmin(profile) || !payload.name.trim()) return null;
    const row = {
      id: crypto.randomUUID(),
      organization_id: profile?.organization_id ?? null,
      name: payload.name.trim(),
      short_name: payload.short_name?.trim() || payload.name.trim().slice(0, 4).toUpperCase(),
      email: payload.email?.trim() || null,
      contact: payload.contact?.trim() || '',
      siret: payload.siret?.trim() || null,
      insurance: payload.insurance?.trim() || null,
      lots: payload.lots ?? [],
      color: '#3B82F6',
      planned_workers: 0,
      actual_workers: 0,
      hours_worked: 0,
    };
    const { data: inserted, error } = await supabaseBrowser.from('companies').insert(row).select().single();
    if (error) {
      setError(error.message);
      return null;
    }
    const saved = inserted ?? row;
    setData(prev => ({ ...prev, companies: [...prev.companies, saved] }));
    setNotice('Entreprise créée.');
    return saved;
  }

  async function updateCompanyWeb(companyId: string, payload: Record<string, any>) {
    if (!isAdmin(profile)) return;
    setData(prev => ({ ...prev, companies: prev.companies.map(item => item.id === companyId ? { ...item, ...payload } : item) }));
    const { error } = await supabaseBrowser.from('companies').update(payload).eq('id', companyId);
    if (error) setError(error.message);
  }

  async function deleteCompanyWeb(companyId: string) {
    if (!isAdmin(profile)) return;
    const previous = data.companies.find(item => item.id === companyId);
    setData(prev => ({ ...prev, companies: prev.companies.filter(item => item.id !== companyId) }));
    const { error } = await supabaseBrowser.from('companies').delete().eq('id', companyId);
    if (error) {
      setError(error.message);
      if (previous) setData(prev => ({ ...prev, companies: [...prev.companies, previous] }));
    }
  }

  async function removeUserWeb(userId: string) {
    if (!isAdmin(profile) || userId === profile?.id) return;
    const { data: revoked, error } = await supabaseBrowser.rpc('admin_revoke_membership', { p_user_id: userId });
    if (error || !revoked?.user_id) {
      setError(error?.message ?? 'Impossible de retirer ce membre.');
      return;
    }
    setData(prev => ({ ...prev, profiles: prev.profiles.filter(item => item.id !== userId) }));
    setNotice('Membre retiré.');
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

  async function createTaskWeb(payload: Record<string, any>) {
    if (!canCreate(profile)) return null;
    const row = {
      id: `TSK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      organization_id: profile?.organization_id ?? null,
      chantier_id: selectedProjectId !== 'all' ? selectedProjectId : null,
      title: String(payload.title ?? '').trim(),
      description: String(payload.description ?? ''),
      company: payload.company || null,
      assignee: String(payload.assignee ?? ''),
      status: payload.status || 'todo',
      priority: payload.priority || 'medium',
      progress: Number(payload.progress ?? 0),
      deadline: payload.deadline || null,
    };
    if (!row.title) return null;
    const { data: inserted, error } = await supabaseBrowser.from('tasks').insert(row).select().single();
    if (error) {
      setError(error.message);
      return null;
    }
    const saved = inserted ?? row;
    setData(prev => ({ ...prev, tasks: [saved, ...prev.tasks] }));
    setNotice('Tâche créée.');
    return saved;
  }

  async function updateProfileField(userId: string, patch: Partial<Profile>) {
    if (!isAdmin(profile)) return;
    const target = data.profiles.find(user => user.id === userId);
    if (!target) return;
    const { error: profileError } = await supabaseBrowser.rpc('admin_update_membership', {
      p_user_id: userId,
      p_role: patch.role ?? target.role,
      p_company_id: patch.company_id !== undefined ? patch.company_id : target.company_id ?? null,
      p_permissions_override: patch.permissions_override ?? target.permissions_override ?? {},
    });
    if (profileError) {
      setError(profileError.message);
      return;
    }
    setData(prev => ({
      ...prev,
      profiles: prev.profiles.map(user => user.id === userId ? { ...user, ...patch } : user),
    }));
    if (userId === profile?.id || userId === authUser?.id) {
      setProfile(previous => previous ? { ...previous, ...patch } : previous);
      if (patch.preferred_language !== undefined) {
        const nextPreference: WebLanguagePreference = patch.preferred_language ?? 'auto';
        const nextLang = resolveWebLanguagePreference(nextPreference, patch.preferred_language ?? null, deviceLanguage);
        setWebLanguagePreferenceState(nextPreference);
        setWebLangState(nextLang);
        syncReportLanguageWithInterface(nextLang);
        storeWebLanguagePreference(nextPreference, nextLang);
      }
    }
  }

  async function updateOwnProfile(patch: Partial<Profile>) {
    const profileId = profile?.id ?? authUser?.id;
    if (!profileId) throw new Error('Utilisateur introuvable.');
    setProfile(previous => previous ? { ...previous, ...patch } : previous);
    setData(prev => ({
      ...prev,
      profiles: prev.profiles.map(user => user.id === profileId ? { ...user, ...patch } : user),
    }));
    const { error: profileError } = await supabaseBrowser
      .from('profiles')
      .update(patch)
      .eq('id', profileId);
    if (profileError) {
      setError(profileError.message);
      throw profileError;
    }
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

  async function updateProjectSettings(projectId: string, patch: Record<string, any>) {
    if (!canEditChantier(profile)) return;
    setData(prev => ({
      ...prev,
      chantiers: prev.chantiers.map(project => project.id === projectId ? { ...project, ...patch } : project),
    }));
    const { error: projectError } = await supabaseBrowser
      .from('chantiers')
      .update(patch)
      .eq('id', projectId);
    if (projectError) {
      setError(projectError.message);
      throw projectError;
    }
  }

  async function saveChantierWeb(draft: any) {
    const isCreate = !draft.id;
    if (!profile || (isCreate ? !canCreate(profile) : !canEditChantier(profile))) return null;
    const name = String(draft.name ?? '').trim();
    if (!name) {
      setError('Le nom du chantier est obligatoire.');
      return null;
    }
    const buildings = projectBuildings({ buildings: draft.buildings });
    const projectId = draft.id || `CH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const payload = {
      name,
      address: String(draft.address ?? '').trim() || null,
      description: String(draft.description ?? '').trim() || null,
      start_date: draft.start_date || null,
      end_date: draft.end_date || null,
      status: draft.status || 'active',
      company_ids: Array.isArray(draft.company_ids) ? draft.company_ids : [],
      buildings: buildings.length ? JSON.stringify(buildings) : null,
    };
    setSaving(true);
    setError('');
    const query = isCreate
      ? supabaseBrowser
          .from('chantiers')
          .insert({
            id: projectId,
            ...payload,
            created_by: userLabel(profile, authUser),
            organization_id: profile.organization_id ?? null,
          })
          .select()
          .single()
      : supabaseBrowser
          .from('chantiers')
          .update(payload)
          .eq('id', projectId)
          .select()
          .single();
    const { data: saved, error: projectError } = await query;
    if (projectError) {
      setError(projectError.message);
      setSaving(false);
      return null;
    }
    const savedProject = saved ?? { id: projectId, ...payload };
    if (isCreate) {
      try {
        await supabaseBrowser.from('channels').upsert({
          id: `building-${projectId}`,
          name,
          description: payload.description ?? '',
          icon: 'business',
          color: '#3B82F6',
          type: 'building',
          members: profile.name ? [profile.name] : [],
          created_by: profile.name ?? null,
          organization_id: profile.organization_id ?? null,
        });
      } catch {
        // Non bloquant : le chantier existe même si le salon bâtiment sera recréé par synchronisation mobile.
      }
    }
    setData(prev => ({
      ...prev,
      chantiers: isCreate
        ? [savedProject, ...prev.chantiers]
        : prev.chantiers.map(project => project.id === projectId ? savedProject : project),
    }));
    setSelectedProjectId(projectId);
    setSaving(false);
    return savedProject;
  }

  async function deleteChantierWeb(project: any) {
    if (!profile || !canDelete(profile) || !project?.id) return false;
    setSaving(true);
    setError('');
    const projectId = String(project.id);
    const reserveIds = [...data.reserves, ...data.deletedReserves]
      .filter(reserve => getChantierId(reserve) === projectId)
      .map(reserve => reserve.id);
    if (reserveIds.length > 0) {
      setError(`Suppression chantier bloquée : ${reserveIds.length} réserve(s) sont encore rattachées à ce chantier.`);
      setSaving(false);
      return false;
    }
    const { data: serverReserves, error: reserveCheckError } = await supabaseBrowser
      .from('reserves')
      .select('id')
      .eq('chantier_id', projectId)
      .limit(1);
    if (reserveCheckError) {
      setError(`Suppression chantier bloquée : vérification des réserves impossible (${reserveCheckError.message}).`);
      setSaving(false);
      return false;
    }
    if (serverReserves?.length) {
      setError('Suppression chantier bloquée : des réserves sont encore rattachées à ce chantier côté serveur.');
      setSaving(false);
      return false;
    }
    const confirmed = window.confirm(`Mettre le chantier vide "${project.name}" dans la corbeille ?`);
    if (!confirmed) {
      setSaving(false);
      return false;
    }
    const { error: projectError } = await (supabaseBrowser as any).rpc('soft_delete_chantier', {
      p_chantier_id: projectId,
      p_reason: 'web_delete_chantier',
    });
    if (projectError) {
      setError(projectError.message);
      setSaving(false);
      return false;
    }
    setData(prev => ({
      ...prev,
      chantiers: prev.chantiers.filter(item => item.id !== projectId),
      sitePlans: prev.sitePlans.filter(item => getChantierId(item) !== projectId),
    }));
    setSelectedProjectId(prev => prev === projectId ? (data.chantiers.find(item => item.id !== projectId)?.id ?? 'all') : prev);
    setSaving(false);
    return true;
  }

  async function createSitePlanWeb(draft: any, file: File | null) {
    if (!profile || !canCreate(profile)) return null;
    const name = String(draft.name ?? '').trim();
    const chantierId = String(draft.chantier_id || (selectedProjectId !== 'all' ? selectedProjectId : '')).trim();
    if (!name || !chantierId) {
      setError('Le nom du plan et le chantier sont obligatoires.');
      return null;
    }
    setSaving(true);
    setError('');
    let uri: string | null = null;
    let fileType: string | null = null;
    let dxfName: string | null = null;
    if (file) {
      const detected = detectWebPlanFileType(file);
      if (!detected) {
        setError('Format plan non supporté. Utilisez PDF, image ou DXF.');
        setSaving(false);
        return null;
      }
      try {
        uri = await uploadWebFile('documents', file, `plan_${name}`);
      } catch (uploadError: any) {
        setError(uploadError?.message ?? "Échec de l'upload du fichier plan.");
        setSaving(false);
        return null;
      }
      fileType = detected;
      dxfName = detected === 'dxf' ? file.name : null;
    }
    const payload = {
      id: `PLAN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      chantier_id: chantierId,
      name,
      building: String(draft.building ?? '').trim() || null,
      level: String(draft.level ?? '').trim() || null,
      building_id: draft.building_id || null,
      level_id: draft.level_id || null,
      uri,
      file_type: fileType,
      dxf_name: dxfName,
      uploaded_at: todayISO(),
      size: file ? formatWebFileSize(file.size) : null,
      revision_code: String(draft.revision_code ?? '').trim() || null,
      revision_number: draft.revision_code ? 1 : null,
      parent_plan_id: null,
      is_latest_revision: true,
      revision_note: String(draft.revision_note ?? '').trim() || null,
      annotations: [],
      organization_id: profile.organization_id ?? null,
    };
    const { data: inserted, error: insertError } = await supabaseBrowser.from('site_plans').insert(payload).select().single();
    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return null;
    }
    const plan = inserted ?? payload;
    setData(prev => ({ ...prev, sitePlans: [plan, ...prev.sitePlans] }));
    setSelectedPlanId(plan.id);
    setActiveTab('plans');
    setSaving(false);
    setNotice('Plan enregistré.');
    return plan;
  }

  async function updateSitePlanWeb(plan: any, patch: Record<string, any>, file?: File | null) {
    if (!profile || !canCreate(profile) || !plan?.id) return null;
    setSaving(true);
    setError('');
    const payload = { ...patch };
    if (file) {
      const detected = detectWebPlanFileType(file);
      if (!detected) {
        setError('Format plan non supporté. Utilisez PDF, image ou DXF.');
        setSaving(false);
        return null;
      }
      try {
        payload.uri = await uploadWebFile('documents', file, `plan_${patch.name ?? plan.name ?? plan.id}`);
      } catch (uploadError: any) {
        setError(uploadError?.message ?? "Échec de l'upload du fichier plan.");
        setSaving(false);
        return null;
      }
      payload.file_type = detected;
      payload.dxf_name = detected === 'dxf' ? file.name : null;
      payload.size = formatWebFileSize(file.size);
      payload.uploaded_at = todayISO();
    }
    const result = file
      ? await (supabaseBrowser as any).rpc('replace_site_plan_file_safely', {
          p_plan_id: String(plan.id),
          p_patch: payload,
          p_reason: 'web_update_site_plan_file',
        })
      : await supabaseBrowser
          .from('site_plans')
          .update(payload)
          .eq('id', plan.id)
          .select()
          .single();
    const updated = (result as any).data;
    const updateError = (result as any).error;
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return null;
    }
    const nextPlan = updated ?? { ...plan, ...payload };
    setData(prev => ({
      ...prev,
      sitePlans: prev.sitePlans.map(item => item.id === plan.id ? nextPlan : item),
    }));
    setSaving(false);
    return nextPlan;
  }

  async function deleteSitePlanFileWeb(plan: any) {
    if (!profile || !canDelete(profile) || !plan?.id) return null;
    setSaving(true);
    setError('');
    const payload = {
      uri: null,
      file_type: null,
      dxf_name: null,
      size: null,
    };
    const { data: updated, error: updateError } = await (supabaseBrowser as any).rpc('replace_site_plan_file_safely', {
      p_plan_id: String(plan.id),
      p_patch: payload,
      p_reason: 'web_delete_site_plan_file',
    });
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return null;
    }
    const nextPlan = updated ?? { ...plan, ...payload };
    setData(prev => ({
      ...prev,
      sitePlans: prev.sitePlans.map(item => item.id === plan.id ? nextPlan : item),
    }));
    setSaving(false);
    return nextPlan;
  }

  async function deleteSitePlanWeb(plan: any) {
    if (!profile || !canDelete(profile) || !plan?.id) return false;
    const confirmed = window.confirm(`Mettre le plan "${plan.name}" dans la corbeille ? Les réserves attachées bloqueront l'action tant qu'elles n'ont pas été migrées.`);
    if (!confirmed) return false;
    setSaving(true);
    setError('');
    const planId = String(plan.id);
    const linkedReserveIds = data.reserves.filter(reserve => getReservePlanId(reserve) === planId).map(reserve => reserve.id);
    if (linkedReserveIds.length) {
      setError(`Suppression du plan bloquée : ${linkedReserveIds.length} réserve(s) sont encore épinglées. Créez une révision ou migrez-les avant suppression.`);
      setSaving(false);
      return false;
    }
    const { error: deleteError } = await (supabaseBrowser as any).rpc('soft_delete_site_plan', {
      p_plan_id: planId,
      p_reason: 'web_delete_site_plan',
    });
    if (deleteError) {
      setError(deleteError.message ?? 'Suppression du plan impossible.');
      setSaving(false);
      return false;
    }
    setData(prev => ({
      ...prev,
      sitePlans: prev.sitePlans.filter(item => item.id !== planId),
    }));
    setSelectedPlanId(prev => prev === planId ? (data.sitePlans.find(item => item.id !== planId)?.id ?? null) : prev);
    setSaving(false);
    return true;
  }

  async function createSitePlanRevisionWeb(parentPlan: any, draft: any, file: File | null, migrateReserves: boolean) {
    if (!profile || !canCreate(profile) || !parentPlan?.id) return null;
    const parentRevisionNumber = Number(parentPlan.revision_number ?? parentPlan.revisionNumber ?? 1) || 1;
    const revisionNumber = parentRevisionNumber + 1;
    const revisionCode = String(draft.revision_code ?? '').trim() || `R${String(revisionNumber).padStart(2, '0')}`;
    setSaving(true);
    setError('');
    let uri: string | null = null;
    let fileType: string | null = null;
    let dxfName: string | null = null;
    if (file) {
      const detected = detectWebPlanFileType(file);
      if (!detected) {
        setError('Format plan non supporté. Utilisez PDF, image ou DXF.');
        setSaving(false);
        return null;
      }
      uri = await uploadWebFile('documents', file, `revision_${parentPlan.name}_${revisionCode}`);
      fileType = detected;
      dxfName = detected === 'dxf' ? file.name : null;
    }
    const newPlan = {
      id: `PLAN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      chantier_id: parentPlan.chantier_id ?? parentPlan.chantierId,
      name: String(draft.name ?? '').trim() || parentPlan.name,
      building: String(draft.building ?? parentPlan.building ?? '').trim() || null,
      level: String(draft.level ?? parentPlan.level ?? '').trim() || null,
      building_id: draft.building_id ?? parentPlan.building_id ?? null,
      level_id: draft.level_id ?? parentPlan.level_id ?? null,
      uri,
      file_type: fileType,
      dxf_name: dxfName,
      uploaded_at: todayISO(),
      size: file ? formatWebFileSize(file.size) : null,
      revision_code: revisionCode,
      revision_number: revisionNumber,
      parent_plan_id: parentPlan.id,
      is_latest_revision: true,
      revision_note: String(draft.revision_note ?? '').trim() || null,
      annotations: [],
      organization_id: profile.organization_id ?? null,
    };
    const { data: revisionResult, error: revisionError } = await (supabaseBrowser as any).rpc('create_site_plan_revision_with_reserve_migration', {
      p_parent_plan_id: String(parentPlan.id),
      p_new_plan: newPlan,
      p_migrate_reserves: migrateReserves,
    });
    if (revisionError) {
      setError(revisionError.message ?? 'Création de la révision impossible.');
      setSaving(false);
      return null;
    }
    const rpcPayload = Array.isArray(revisionResult) ? revisionResult[0] : revisionResult;
    const insertedPlan = rpcPayload?.plan ?? newPlan;
    const migratable = data.reserves.filter(reserve => getReservePlanId(reserve) === String(parentPlan.id) && reserve.status !== 'closed');
    const migratedCount = Number(rpcPayload?.migrated_count ?? 0);
    setData(prev => ({
      ...prev,
      sitePlans: [
        insertedPlan,
        ...prev.sitePlans.map(item => item.id === parentPlan.id ? { ...item, is_latest_revision: false, revision_number: parentRevisionNumber } : item),
      ],
      reserves: prev.reserves.map(item => migrateReserves && migratable.some(reserve => reserve.id === item.id) ? { ...item, plan_id: insertedPlan.id } : item),
    }));
    setSelectedPlanId(insertedPlan.id);
    setSaving(false);
    return { plan: insertedPlan, migratedCount };
  }

  async function createDocumentWeb(payload: Record<string, any>, file: File | null) {
    if (!profile || !canCreate(profile) || !file) return null;
    setSaving(true);
    setError('');
    const uri = await uploadWebFile('documents', file, `document_${payload.name ?? file.name}`);
    const docType = payload.type || detectWebDocumentType(file);
    const documentPayload = {
      id: `DOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      name: String(payload.name ?? file.name).trim() || file.name,
      type: docType,
      category: String(payload.category ?? '').trim() || (docType === 'technical' ? 'Technique' : docType === 'plan' ? 'Plans' : 'Documents'),
      uploaded_at: todayISO(),
      size: formatWebFileSize(file.size),
      version: Number(payload.version ?? 1) || 1,
      uri,
      chantier_id: payload.chantier_id || (selectedProjectId !== 'all' ? selectedProjectId : null),
      organization_id: profile.organization_id ?? null,
    };
    const { data: inserted, error: insertError } = await supabaseBrowser.from('documents').insert(documentPayload).select().single();
    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return null;
    }
    const saved = inserted ?? documentPayload;
    setData(prev => ({ ...prev, documents: [saved, ...prev.documents] }));
    setSaving(false);
    return saved;
  }

  async function deleteDocumentWeb(document: any) {
    if (!profile || !canDelete(profile) || !document?.id) return false;
    const confirmed = window.confirm(`Supprimer le document "${document.name ?? document.title ?? document.id}" ?`);
    if (!confirmed) return false;
    setSaving(true);
    setError('');
    const { error: deleteError } = await supabaseBrowser.from('documents').delete().eq('id', document.id);
    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      return false;
    }
    setData(prev => ({ ...prev, documents: prev.documents.filter(item => item.id !== document.id) }));
    setSaving(false);
    return true;
  }

  async function createTimeEntryWeb(payload: Record<string, any>) {
    if (!profile || !(canUpdateAttendance(profile) || canCreate(profile))) return null;
    const workerName = String(payload.worker_name ?? '').trim();
    if (!workerName) {
      setError('Le nom du compagnon est obligatoire.');
      return null;
    }
    const entry = {
      id: `TIME-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      date: payload.date || todayISO(),
      company_id: payload.company_id || null,
      company_name: payload.company_name || null,
      company_color: payload.company_color || '#10B981',
      worker_name: workerName,
      arrival_time: payload.arrival_time || '08:00',
      departure_time: payload.departure_time || null,
      notes: String(payload.notes ?? '').trim() || null,
      recorded_by: userLabel(profile, authUser),
      organization_id: profile.organization_id ?? null,
    };
    const { data: inserted, error: insertError } = await supabaseBrowser.from('time_entries').insert(entry).select().single();
    if (insertError) {
      setError(insertError.message);
      return null;
    }
    const saved = inserted ?? entry;
    setData(prev => ({ ...prev, timeEntries: [saved, ...prev.timeEntries] }));
    return saved;
  }

  async function updateTimeEntryWeb(entry: any, patch: Record<string, any>) {
    if (!profile || !(canUpdateAttendance(profile) || canCreate(profile)) || !entry?.id) return null;
    const payload = { ...patch, updated_by: userLabel(profile, authUser), updated_at: new Date().toISOString() };
    const { data: updated, error: updateError } = await supabaseBrowser.from('time_entries').update(payload).eq('id', entry.id).select().single();
    if (updateError) {
      setError(updateError.message);
      return null;
    }
    const saved = updated ?? { ...entry, ...payload };
    setData(prev => ({ ...prev, timeEntries: prev.timeEntries.map(item => item.id === entry.id ? saved : item) }));
    return saved;
  }

  async function deleteTimeEntryWeb(entry: any) {
    if (!profile || !canDelete(profile) || !entry?.id) return false;
    const confirmed = window.confirm(`Supprimer définitivement le pointage de ${entry.worker_name ?? 'ce compagnon'} ?`);
    if (!confirmed) return false;
    const { error: deleteError } = await supabaseBrowser.from('time_entries').delete().eq('id', entry.id);
    if (deleteError) {
      setError(deleteError.message);
      return false;
    }
    setData(prev => ({ ...prev, timeEntries: prev.timeEntries.filter(item => item.id !== entry.id) }));
    setNotice('Pointage supprimé.');
    return true;
  }

  async function createJournalEntryWeb(payload: Record<string, any>) {
    if (!profile || !canCreate(profile)) return null;
    const row = {
      id: `JRN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      organization_id: profile.organization_id ?? null,
      chantier_id: payload.chantier_id ?? null,
      entry_date: payload.date || todayISO(),
      weather: String(payload.weather ?? ''),
      weather_temp: payload.weatherTemp ?? null,
      weather_wind: payload.weatherWind ?? null,
      weather_code: payload.weatherCode ?? null,
      worker_count: Number(payload.workerCount ?? 0),
      work_done: String(payload.workDone ?? ''),
      materials: String(payload.materials ?? ''),
      incidents: String(payload.incidents ?? ''),
      observations: String(payload.observations ?? ''),
      visitors: String(payload.visitors ?? ''),
      author: userLabel(profile, authUser),
      author_id: profile.id ?? null,
    };
    const { data: inserted, error: insertError } = await supabaseBrowser.from('journal_entries').insert(row).select().single();
    if (insertError) {
      setError(insertError.message);
      return null;
    }
    const saved = inserted ?? row;
    setData(prev => ({ ...prev, journalEntries: [saved, ...prev.journalEntries] }));
    setNotice('Entrée de journal enregistrée.');
    return saved;
  }

  async function createIncidentWeb(payload: Record<string, any>) {
    if (!profile || !canCreate(profile)) return null;
    const row = {
      id: `INC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      organization_id: profile.organization_id ?? null,
      chantier_id: selectedProjectId !== 'all' ? selectedProjectId : null,
      title: String(payload.title ?? '').trim(),
      description: String(payload.description ?? ''),
      severity: payload.severity || 'moderate',
      status: payload.status || 'open',
      location: String(payload.location ?? ''),
      building: String(payload.building ?? ''),
      reported_at: payload.reported_at || todayISO(),
      reported_by: userLabel(profile, authUser),
      actions: String(payload.actions ?? ''),
    };
    if (!row.title) return null;
    const { data: inserted, error } = await supabaseBrowser.from('incidents').insert(row).select().single();
    if (error) {
      setError(error.message);
      return null;
    }
    const saved = inserted ?? row;
    setData(prev => ({ ...prev, incidents: [saved, ...prev.incidents] }));
    setNotice('Incident signalé.');
    return saved;
  }

  async function updateIncidentWeb(incident: any, patch: Record<string, any>) {
    if (!profile || !canEdit(profile) || !incident?.id) return null;
    const next = {
      ...patch,
      ...(patch.status === 'resolved' && incident.status !== 'resolved' ? { closed_at: todayISO(), closed_by: userLabel(profile, authUser) } : {}),
    };
    const { data: updated, error } = await supabaseBrowser.from('incidents').update(next).eq('id', incident.id).select().single();
    if (error) {
      setError(error.message);
      return null;
    }
    setData(prev => ({ ...prev, incidents: prev.incidents.map((item: any) => item.id === incident.id ? (updated ?? { ...item, ...next }) : item) }));
    return updated;
  }

  async function updateJournalEntryWeb(entry: any, payload: Record<string, any>) {
    if (!profile || !canCreate(profile) || !entry?.id) return null;
    const patch = {
      entry_date: payload.date || entry.entry_date,
      weather: String(payload.weather ?? entry.weather ?? ''),
      weather_temp: payload.weatherTemp ?? entry.weather_temp ?? null,
      weather_wind: payload.weatherWind ?? entry.weather_wind ?? null,
      worker_count: Number(payload.workerCount ?? entry.worker_count ?? 0),
      work_done: String(payload.workDone ?? entry.work_done ?? ''),
      materials: String(payload.materials ?? entry.materials ?? ''),
      incidents: String(payload.incidents ?? entry.incidents ?? ''),
      observations: String(payload.observations ?? entry.observations ?? ''),
      visitors: String(payload.visitors ?? entry.visitors ?? ''),
    };
    const { data: updated, error } = await supabaseBrowser.from('journal_entries').update(patch).eq('id', entry.id).select().single();
    if (error) {
      setError(error.message);
      return null;
    }
    setData(prev => ({ ...prev, journalEntries: prev.journalEntries.map((item: any) => item.id === entry.id ? (updated ?? { ...item, ...patch }) : item) }));
    setNotice('Entrée de journal mise à jour.');
    return updated;
  }

  async function deleteJournalEntryWeb(entry: any) {
    if (!profile || !canDelete(profile) || !entry?.id) return false;
    if (!window.confirm('Supprimer cette entrée de journal ?')) return false;
    const { error: deleteError } = await supabaseBrowser.from('journal_entries').delete().eq('id', entry.id);
    if (deleteError) {
      setError(deleteError.message);
      return false;
    }
    setData(prev => ({ ...prev, journalEntries: prev.journalEntries.filter(item => item.id !== entry.id) }));
    setNotice('Entrée de journal supprimée.');
    return true;
  }

  async function migrateLocalJournalWeb(localEntries: any[], chantierId: string) {
    if (!profile || !localEntries.length) return true;
    const rows = localEntries.map(entry => ({
      id: String(entry.id ?? `JRN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`),
      organization_id: profile.organization_id ?? null,
      chantier_id: chantierId !== 'all' ? chantierId : null,
      entry_date: String(entry.date ?? ''),
      weather: String(entry.weather ?? ''),
      worker_count: Number(entry.workerCount ?? 0),
      work_done: String(entry.workDone ?? ''),
      materials: String(entry.materials ?? ''),
      incidents: String(entry.incidents ?? ''),
      observations: String(entry.observations ?? ''),
      visitors: String(entry.visitors ?? ''),
      author: String(entry.author ?? userLabel(profile, authUser)),
      author_id: profile.id ?? null,
    }));
    const { error: upsertError } = await supabaseBrowser
      .from('journal_entries')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (upsertError) {
      console.warn('[web] migration journal local', upsertError.message);
      return false;
    }
    setData(prev => {
      const known = new Set(prev.journalEntries.map((item: any) => String(item.id)));
      return { ...prev, journalEntries: [...rows.filter(row => !known.has(String(row.id))), ...prev.journalEntries] };
    });
    return true;
  }

  async function saveChecklistWeb(payload: Record<string, any>) {
    const isCreate = !payload.id;
    if (!profile || (isCreate ? !canCreate(profile) : !canEdit(profile))) return null;
    const row = {
      id: String(payload.id ?? `CHK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`),
      organization_id: profile.organization_id ?? null,
      chantier_id: payload.chantier_id ?? null,
      title: String(payload.title ?? ''),
      items: checklistItemsToRows(payload.items ?? []),
      author: String(payload.author ?? userLabel(profile, authUser)),
      author_id: profile.id ?? null,
    };
    const { data: saved, error: saveError } = await supabaseBrowser
      .from('checklists')
      .upsert(row, { onConflict: 'id' })
      .select()
      .single();
    if (saveError) {
      setError(saveError.message);
      return null;
    }
    const next = saved ?? row;
    setData(prev => {
      const exists = prev.checklists.some((item: any) => item.id === next.id);
      return {
        ...prev,
        checklists: exists ? prev.checklists.map((item: any) => item.id === next.id ? next : item) : [next, ...prev.checklists],
      };
    });
    return next;
  }

  async function updateChecklistItemsWeb(checklistId: string, items: any[]) {
    if (!profile || !canEdit(profile) || !checklistId) return false;
    const rows = checklistItemsToRows(items);
    const previous = data.checklists;
    setData(prev => ({
      ...prev,
      checklists: prev.checklists.map((item: any) => item.id === checklistId ? { ...item, items: rows, updated_at: nowISO() } : item),
    }));
    const { error: updateError } = await supabaseBrowser
      .from('checklists')
      .update({ items: rows, updated_at: nowISO() })
      .eq('id', checklistId);
    if (updateError) {
      setData(prev => ({ ...prev, checklists: previous }));
      setError(updateError.message);
      return false;
    }
    return true;
  }

  async function deleteChecklistWeb(checklist: any) {
    if (!profile || !canDelete(profile) || !checklist?.id) return false;
    if (!window.confirm(`Supprimer la checklist « ${checklist.title ?? ''} » ?`)) return false;
    const { error: deleteError } = await supabaseBrowser.from('checklists').delete().eq('id', checklist.id);
    if (deleteError) {
      setError(deleteError.message);
      return false;
    }
    setData(prev => ({ ...prev, checklists: prev.checklists.filter((item: any) => item.id !== checklist.id) }));
    setNotice('Checklist supprimée.');
    return true;
  }

  async function migrateLocalChecklistsWeb(localChecklists: any[], chantierId: string) {
    if (!profile || !localChecklists.length) return true;
    const rows = localChecklists.map(checklist => ({
      id: String(checklist.id ?? `CHK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`),
      organization_id: profile.organization_id ?? null,
      chantier_id: chantierId !== 'all' ? chantierId : null,
      title: String(checklist.title ?? ''),
      items: checklistItemsToRows(checklist.items ?? []),
      author: String(checklist.createdBy ?? userLabel(profile, authUser)),
      author_id: profile.id ?? null,
    }));
    const { error: upsertError } = await supabaseBrowser
      .from('checklists')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (upsertError) {
      console.warn('[web] migration checklists locales', upsertError.message);
      return false;
    }
    setData(prev => {
      const known = new Set(prev.checklists.map((item: any) => String(item.id)));
      return { ...prev, checklists: [...rows.filter(row => !known.has(String(row.id))), ...prev.checklists] };
    });
    return true;
  }

  async function saveRegulatoryDocWeb(draft: any, file: File | null) {
    if (!profile || (draft.id ? !canEdit(profile) : !canCreate(profile))) return null;
    const title = String(draft.title ?? '').trim();
    if (!title) {
      setError('Le titre du document réglementaire est obligatoire.');
      return null;
    }
    setSaving(true);
    setError('');
    let uri = draft.uri ?? null;
    if (file) {
      try {
        uri = await uploadWebFile('documents', file, `reglementaire_${title}`);
      } catch (uploadError: any) {
        setError(uploadError?.message ?? "Échec de l'upload du document.");
        setSaving(false);
        return null;
      }
    }
    const payload = {
      type: draft.type || 'autre',
      title,
      company: String(draft.company ?? '').trim() || null,
      reference: String(draft.reference ?? '').trim() || null,
      issue_date: draft.issue_date || null,
      expiry_date: draft.expiry_date || null,
      status: draft.status || 'missing',
      notes: String(draft.notes ?? '').trim() || null,
      uri,
      created_by: draft.created_by ?? userLabel(profile, authUser),
      organization_id: profile.organization_id ?? null,
    };
    const query = draft.id
      ? supabaseBrowser.from('regulatory_docs').update(payload).eq('id', draft.id).select().single()
      : supabaseBrowser.from('regulatory_docs').insert({
          id: `REG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          ...payload,
          created_at: nowISO(),
        }).select().single();
    const { data: saved, error: saveError } = await query;
    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return null;
    }
    const row = saved ?? { id: draft.id, ...payload };
    setData(prev => ({
      ...prev,
      regulatoryDocs: draft.id
        ? prev.regulatoryDocs.map(item => item.id === draft.id ? row : item)
        : [row, ...prev.regulatoryDocs],
    }));
    setSaving(false);
    return row;
  }

  async function deleteRegulatoryDocWeb(doc: any) {
    if (!profile || !canDelete(profile) || !doc?.id) return false;
    const confirmed = window.confirm(`Supprimer le document réglementaire "${doc.title}" ?`);
    if (!confirmed) return false;
    setSaving(true);
    setError('');
    const { error: deleteError } = await supabaseBrowser.from('regulatory_docs').delete().eq('id', doc.id);
    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      return false;
    }
    setData(prev => ({ ...prev, regulatoryDocs: prev.regulatoryDocs.filter(item => item.id !== doc.id) }));
    setSaving(false);
    return true;
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
    if (!canExport(profile)) {
      setError('Export PDF non autorisé pour ce profil.');
      return;
    }
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
          ? await withPdfRemoteReservePhotoList(targetReserves, REPORT_MAX_PHOTOS_PER_RESERVE)
          : targetReserves;
      const reportReserve = type === 'individual_reserve' && targetReserve
        ? await withPdfRemoteReservePhotos(targetReserve, INDIVIDUAL_RESERVE_MAX_PHOTOS)
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
      const { data: pdfAuthData } = await supabaseBrowser.auth.getSession();
      const response = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(pdfAuthData.session?.access_token ? { Authorization: `Bearer ${pdfAuthData.session.access_token}` } : {}),
        },
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
      setNotice('PDF généré.');
    } catch (err: any) {
      setError(err?.message ?? 'Génération PDF impossible.');
    } finally {
      setGeneratingReport(null);
    }
  }

  async function uploadMessagePhoto(file: File, channelId: string) {
    return uploadRegisteredWebFile('photos', file, safeStorageName(`message_${channelId}_${crypto.randomUUID()}`));
  }

  async function sendMessage(input: MessageSendInput) {
    if (!input.channelId || (!input.content.trim() && !input.attachmentRef) || !profile) return false;
    setSaving(true);
    setError('');
    const payload = {
      id: crypto.randomUUID(),
      channel_id: input.channelId,
      content: input.content.trim(),
      timestamp: new Date().toISOString(),
      type: 'message',
      read: true,
      read_by: [profile.name || profile.email].filter(Boolean),
      reactions: {},
      is_pinned: false,
      mentions: [],
      attachment_uri: input.attachmentRef ?? null,
      reply_to_id: input.replyTo?.id ?? null,
      reply_to_content: input.replyTo?.content ?? null,
      reply_to_sender: input.replyTo?.sender ?? null,
    };
    const { data: inserted, error: messageError } = await supabaseBrowser
      .from('messages')
      .insert(payload)
      .select()
      .single();
    if (messageError) {
      setError(messageError.message);
      setSaving(false);
      return false;
    }
    else {
      setMessageDraft('');
      setData(prev => ({ ...prev, messages: [inserted, ...prev.messages] }));
      triggerWebPush({ type: 'message-created', messageId: String(inserted?.id ?? payload.id) });
    }
    setSaving(false);
    return true;
  }

  const openReserveDetailTab = useCallback((reserveId: string, targetOverride?: any) => {
    const target = targetOverride ?? [...data.reserves, ...data.deletedReserves]
      .find((reserve: any) => String(reserve.id) === String(reserveId));
    if (!target) return false;
    const targetProjectId = String(getChantierId(target) || selectedProjectId);
    const nextStatusFilter = isReserveDeleted(target)
      ? (canEdit(profile) ? 'deleted' : 'all')
      : isReserveArchived(target)
        ? 'archived'
        : 'all';
    reserveDetailRequestTokenRef.current += 1;
    reserveFilterScopeRef.current = targetProjectId;
    if (targetProjectId && targetProjectId !== selectedProjectId) {
      setSelectedProjectId(targetProjectId);
    }
    setSearch('');
    setStatusFilter(nextStatusFilter);
    setPriorityFilter('all');
    setCompanyFilter('all');
    setBuildingFilter('all');
    setPinFilter('all');
    setSelectedReserveId(reserveId);
    setReserveDetailRequest({ id: reserveId, token: reserveDetailRequestTokenRef.current });
    setActiveTab('reserves');
    return true;
  }, [data.deletedReserves, data.reserves, profile, selectedProjectId]);
  const handleReserveDetailRequestHandled = useCallback((token: number) => {
    setReserveDetailRequest(current => current?.token === token ? null : current);
  }, []);

  const closeRootReserveHistory = useCallback(() => {
    if (
      typeof window !== 'undefined'
      && !reserveHistoryNavigationRef.current
      && window.history.state?.[WEB_RESERVE_HISTORY_STATE]
    ) {
      reserveHistoryNavigationRef.current = true;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function handleReserveHistoryOutsideCompactView(event: PopStateEvent) {
      reserveHistoryNavigationRef.current = false;
      const state = event.state ?? {};
      const reserveId = state[WEB_RESERVE_HISTORY_STATE] ? String(state.reserveId ?? '') : '';
      if (!reserveId) return;
      const compactReservesOwnEvent = activeTab === 'reserves'
        && window.matchMedia('(max-width: 1180px)').matches;
      if (compactReservesOwnEvent) return;
      const target = [...data.reserves, ...data.deletedReserves]
        .find((reserve: any) => String(reserve.id) === reserveId);
      if (target) openReserveDetailTab(reserveId);
    }
    window.addEventListener('popstate', handleReserveHistoryOutsideCompactView);
    return () => window.removeEventListener('popstate', handleReserveHistoryOutsideCompactView);
  }, [activeTab, data.deletedReserves, data.reserves, openReserveDetailTab]);

  useEffect(() => {
    const previousActiveTab = previousActiveTabRef.current;
    previousActiveTabRef.current = activeTab;
    if (
      previousActiveTab === 'reserves'
      && activeTab !== 'reserves'
      && typeof window !== 'undefined'
      && window.history.state?.[WEB_RESERVE_HISTORY_STATE]
    ) {
      closeRootReserveHistory();
    }
  }, [activeTab, closeRootReserveHistory]);

  const canViewReserveTrash = canEdit(profile);
  const effectiveStatusFilter = statusFilter === 'deleted' && !canViewReserveTrash ? 'all' : statusFilter;

  useEffect(() => {
    if (activeTab !== 'reserves' || reserveFilterScopeRef.current === selectedProjectId) return;
    reserveFilterScopeRef.current = selectedProjectId;
    setSearch('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setCompanyFilter('all');
    setBuildingFilter('all');
    setPinFilter('all');
  }, [activeTab, selectedProjectId]);

  const projectScoped = useMemo(() => {
    const byProject = (item: any) => selectedProjectId === 'all' || item.chantier_id === selectedProjectId || item.chantierId === selectedProjectId;
    const visibleReserves = visibleReservesForProfile(data.reserves, profile, data.companies);
    const visibleDeletedReserves = canViewReserveTrash ? visibleReservesForProfile(data.deletedReserves, profile, data.companies) : [];
    const visibleReserveIds = new Set([...visibleReserves, ...visibleDeletedReserves].map((reserve: any) => String(reserve.id)));
    const reserves = visibleReserves.filter(byProject);
    const deletedReserves = visibleDeletedReserves.filter(byProject);
    const reserveIds = new Set([...reserves, ...deletedReserves].map((reserve: any) => String(reserve.id)));
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
      deletedReserves: deletedReserves.map((reserve: any) => {
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
      timeEntries: profile?.role === 'sous_traitant' ? [] : data.timeEntries,
      regulatoryDocs: profile?.role === 'sous_traitant' ? [] : data.regulatoryDocs,
      journalEntries: (data.journalEntries ?? []).filter((item: any) => selectedProjectId === 'all' || item.chantier_id === selectedProjectId || item.chantierId === selectedProjectId),
    };
  }, [data, selectedProjectId, profile, canViewReserveTrash]);

  const dashboardSource = useMemo<DashboardSource>(() => ({
    projects: data.chantiers,
    plans: projectScoped.plans,
    companies: data.companies,
    messageCount: data.messages.length,
    current: {
      reserves: projectScoped.reserves,
      tasks: projectScoped.tasks,
      incidents: projectScoped.incidents,
      plansCount: projectScoped.plans.length,
      visitsCount: projectScoped.visites.length,
      documentsCount: projectScoped.documents.length,
    },
  }), [
    data.chantiers,
    data.companies,
    data.messages.length,
    projectScoped.documents.length,
    projectScoped.incidents,
    projectScoped.plans,
    projectScoped.reserves,
    projectScoped.tasks,
    projectScoped.visites.length,
  ]);

  const handleDashboardIntent = useCallback((intent: DashboardIntent) => {
    if (intent.type === 'navigate') {
      setActiveTab(intent.target);
      return;
    }
    if (intent.type === 'select-project') {
      setSelectedProjectId(intent.projectId);
      setBuildingFilter('all');
      return;
    }
    if (intent.type === 'open-reserve') {
      setActiveTab('reserves');
      openReserveDetailTab(intent.reserveId);
      return;
    }
    if (intent.type === 'approve-lift') {
      void updateReserveStatus(intent.reserveId, 'closed');
      return;
    }
    if (intent.type === 'reject-lift') {
      const reserve = data.reserves.find((item: any) => String(item.id) === String(intent.reserveId));
      if (reserve) void rejectReserveVerificationWeb(reserve);
      return;
    }
    if (intent.projectId) setSelectedProjectId(intent.projectId);
    reserveFilterScopeRef.current = intent.projectId ?? selectedProjectId;
    setBuildingFilter(intent.buildingName);
    setActiveTab('reserves');
  }, [openReserveDetailTab, selectedProjectId]);

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

  const deferredReserveSearch = useDeferredValue(search);
  const filteredReserves = useMemo(() => {
    const q = (search === '' && deferredReserveSearch !== '') || reserveDetailRequest
      ? ''
      : normalizeSearchText(deferredReserveSearch);
    const sourceReserves = effectiveStatusFilter === 'deleted' ? projectScoped.deletedReserves : projectScoped.reserves;
    return sourceReserves.filter(r => {
      if (effectiveStatusFilter === 'deleted') {
        if (!isReserveDeleted(r)) return false;
      } else if (effectiveStatusFilter === 'archived') {
        if (!isReserveArchived(r)) return false;
      } else {
        if (isReserveArchived(r)) return false;
        if (effectiveStatusFilter === 'overdue') {
          if (!isReserveOverdue(r)) return false;
        } else if (effectiveStatusFilter === 'due_soon') {
          if (!isReserveDueSoon(r)) return false;
        } else if (effectiveStatusFilter === 'ack_missing') {
          if (!needsEnterpriseAck(r)) return false;
        } else if (effectiveStatusFilter === 'ack_received') {
          if (!hasEnterpriseAck(r)) return false;
        } else if (effectiveStatusFilter !== 'all' && r.status !== effectiveStatusFilter) {
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
      const haystack = normalizeSearchText([
        r.id,
        r.title,
        r.description,
        getReserveBuildingInfo(r, reserveFilterPlansById, activeProjectForReserveFilters).name,
        r.level,
        r.zone,
        STATUS_LABELS[r.status] ?? r.status,
        PRIORITY_LABELS[r.priority] ?? r.priority,
        ...(reserveCompanies(r)),
      ].join(' '));
      return haystack.includes(q);
    });
  }, [projectScoped.reserves, projectScoped.deletedReserves, deferredReserveSearch, search, reserveDetailRequest, effectiveStatusFilter, priorityFilter, companyFilter, buildingFilter, pinFilter, reserveFilterPlansById, activeProjectForReserveFilters]);

  const reserveSelectionPool = effectiveStatusFilter === 'deleted' ? projectScoped.deletedReserves : projectScoped.reserves;
  const scopedAllReserves = useMemo(
    () => [...projectScoped.reserves, ...projectScoped.deletedReserves],
    [projectScoped.deletedReserves, projectScoped.reserves],
  );
  const selectedReserve = reserveSelectionPool.find(r => r.id === selectedReserveId) ?? filteredReserves[0] ?? null;
  const selectedFilteredReserve = filteredReserves.find(r => r.id === selectedReserveId) ?? filteredReserves[0] ?? null;
  useEffect(() => {
    setSelectedReserveId(previous => previous && reserveSelectionPool.some((reserve: any) => reserve.id === previous)
      ? previous
      : null);
    setReserveDetailRequest(request => request && reserveSelectionPool.some((reserve: any) => reserve.id === request.id)
      ? request
      : null);
  }, [reserveSelectionPool]);
  const selectedPlan = projectScoped.plans.find(p => p.id === selectedPlanId) ?? projectScoped.plans[0] ?? null;
  useEffect(() => {
    setSelectedPlanId(previous => previous && projectScoped.plans.some((plan: any) => plan.id === previous)
      ? previous
      : projectScoped.plans[0]?.id ?? null);
  }, [projectScoped.plans]);
  // Le mode « placement de pastille » ne vit que dans l'onglet Plans : dès que
  // l'utilisateur en sort, on l'annule pour éviter un placement fantôme au retour.
  useEffect(() => {
    if (activeTab !== 'plans' && placementReserveId) setPlacementReserveId(null);
  }, [activeTab, placementReserveId]);
  const selectedChannel = data.channels.find(c => c.id === selectedChannelId) ?? data.channels[0] ?? null;
  const selectedChannelMessages = useMemo(() => selectedChannel
    ? data.messages
        .filter(m => m.channel_id === selectedChannel.id)
        .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
    : [], [selectedChannel, data.messages]);

  // Canal affiché et onglet visible : le marqueur est partagé avec l'app mobile
  // via le profil serveur, puis les lignes visibles sont marquées par le RPC borné.
  useEffect(() => {
    const channelId = selectedChannel?.id;
    const userId = session?.user?.id;
    const latest = selectedChannelMessages.at(-1);
    if (activeTab !== 'messages' || !channelId || !userId || !latest) return;
    const latestDate = new Date(latest.created_at ?? latest.timestamp ?? 0);
    if (Number.isNaN(latestDate.getTime())) return;
    const stamp = latestDate.toISOString();
    const current = lastReadByChannel[channelId];
    if (current && Date.parse(current) >= latestDate.getTime()) return;

    const next = mergeMessageReadState(lastReadByChannel, { [channelId]: stamp });
    setLastReadByChannel(next);
    setProfile(previous => previous ? { ...previous, last_read_by_channel: next } : previous);

    const unreadIds = selectedChannelMessages
      .filter(message => {
        const own = message.sender_id
          ? String(message.sender_id) === userId
          : sameName(message.sender, profile?.name || authUser?.email || '');
        const created = Date.parse(message.created_at ?? message.timestamp ?? '');
        return !own && Number.isFinite(created) && (!current || created > Date.parse(current));
      })
      .map(message => String(message.id))
      .filter(Boolean);

    void (async () => {
      const profileUpdate = await supabaseBrowser
        .from('profiles')
        .update({ last_read_by_channel: next })
        .eq('id', userId);
      if (profileUpdate.error) console.warn('[web] last_read_by_channel', profileUpdate.error.message);
      for (let offset = 0; offset < unreadIds.length; offset += 100) {
        const { error: readError } = await (supabaseBrowser as any).rpc('mark_messages_read_by', {
          p_message_ids: unreadIds.slice(offset, offset + 100),
          p_user_name: profile?.name || authUser?.email || '',
        });
        if (readError) console.warn('[web] mark_messages_read_by', readError.message);
      }
    })();
  }, [
    activeTab,
    authUser?.email,
    lastReadByChannel,
    profile?.name,
    selectedChannel?.id,
    selectedChannelMessages,
    session?.user?.id,
  ]);

  // Compteur de messages non lus (tous canaux sauf celui affiché), pour le
  // badge de la sidebar et le titre de l'onglet navigateur.
  const unreadMessagesCount = useMemo(() => {
    if (!data.messages.length) return 0;
    const myName = profile?.name || authUser?.email || '';
    let count = 0;
    for (const message of data.messages) {
      if (!message?.channel_id || typeof message?.created_at !== 'string') continue;
      if (activeTab === 'messages' && selectedChannel?.id === message.channel_id) continue;
      const own = message.sender_id
        ? String(message.sender_id) === session?.user?.id
        : sameName(message.sender, myName);
      if (own) continue;
      const lastRead = lastReadByChannel[message.channel_id];
      if (!lastRead || message.created_at > lastRead) count += 1;
    }
    return count;
  }, [data.messages, lastReadByChannel, activeTab, selectedChannel?.id, profile?.name, authUser?.email, session?.user?.id]);

  // Titre de l'onglet : « (3) BuildTrack » quand des messages attendent — le
  // seul signal visible quand l'utilisateur est sur un autre onglet navigateur.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!baseDocumentTitleRef.current) baseDocumentTitleRef.current = document.title || 'BuildTrack';
    const base = baseDocumentTitleRef.current;
    document.title = unreadMessagesCount > 0 ? `(${unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}) ${base}` : base;
    return () => { document.title = base; };
  }, [unreadMessagesCount]);

  const stats = useMemo(() => {
    const reserves = projectScoped.reserves;
    const active = reserves.filter(r => !r.archived_at);
    const overdue = active.filter(isReserveOverdue);
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

  const storageAlert = useMemo(() => {
    if (!storageUsage || storageUsage.status === 'ok') return null;
    const used = Number(storageUsage.total_mb ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    const limit = Number(storageUsage.critical_mb ?? 950).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
    return `Stockage Supabase ${storageUsage.status === 'critical' ? 'critique' : 'proche de la limite'} : ${used} Mo utilisés / seuil ${limit} Mo. Réduisez les fichiers ou augmentez le plan avant les prochains uploads.`;
  }, [storageUsage]);

  if (authenticatedWorkspace.state.status === 'checking') {
    return (
      <WebI18nContext.Provider value={i18n}>
        <WebStaticI18nBridge />
        <BuildTrackAccessLoading language={webLang} />
      </WebI18nContext.Provider>
    );
  }

  if (authenticatedWorkspace.state.status === 'anonymous' || !session || !authUser) {
    return (
      <WebI18nContext.Provider value={i18n}>
        <WebStaticI18nBridge />
        <BuildTrackAccess
          language={webLang}
          onLanguageChange={handleWebLangChange}
          sessionExpired={authenticatedWorkspace.state.status === 'anonymous' && authenticatedWorkspace.state.reason === 'expired'}
        />
      </WebI18nContext.Provider>
    );
  }

  function enterWebSupport(org: { id: string; name: string }) {
    webSupportOrgId = org.id;
    setSupportOrg(org);
    if (typeof window !== 'undefined') window.localStorage.setItem(WEB_SUPPORT_ORG_KEY, JSON.stringify(org));
    setActiveTab('dashboard');
    if (authUser) void loadEverything(authUser);
  }

  function exitWebSupport() {
    webSupportOrgId = null;
    setSupportOrg(null);
    if (typeof window !== 'undefined') window.localStorage.removeItem(WEB_SUPPORT_ORG_KEY);
    setActiveTab('admin');
    if (authUser) void loadEverything(authUser);
  }

  return (
    <WebI18nContext.Provider value={i18n}>
      <WebStaticI18nBridge />
      {isPlatformAdminWebUser && supportOrg ? (
        <div className={styles.supportBanner}>
          <strong>Support · {supportOrg.name}</strong>
          <button type="button" onClick={exitWebSupport}>Sortir</button>
        </div>
      ) : null}
      <WorkspaceChrome
        title={tabLabel(activeTab, t, profile?.role)}
        eyebrow={t('shell.cockpitWeb')}
        navigationLabel={t('common.mainMenu')}
        navigationGroups={visibleNavigationGroups.map(group => ({
          id: group.label.toLowerCase(),
          label: t(`nav.group.${group.label.toLowerCase()}`),
          items: group.items.map(tabId => {
            const tab = TABS.find(item => item.id === tabId)!;
            const label = tabLabel(tab.id, t, profile?.role);
            const navIsActive = activeTab === tab.id || (tab.id === 'terrain' && TERRAIN_CHILD_TABS.has(activeTab));
            const messageBadge = tab.id === 'messages' && unreadMessagesCount > 0
              ? (unreadMessagesCount > 9 ? '9+' : unreadMessagesCount)
              : undefined;
            return {
              id: tab.id,
              label,
              icon: <SidebarNavIcon name={tab.icon} active={navIsActive} />,
              active: navIsActive,
              badge: messageBadge,
              badgeLabel: messageBadge === undefined ? undefined : `${unreadMessagesCount} ${label}`,
              onSelect: () => {
                if (tab.id === 'reserves') {
                  setReserveDetailRequest(null);
                  setSelectedReserveId(null);
                }
                setActiveTab(tab.id);
                setMobileNavOpen(false);
              },
            };
          }),
        }))}
        projects={data.chantiers}
        selectedProjectId={selectedProjectId}
        projectLabels={{
          allProjects: t('common.allProjects'),
          activeProject: t('projectDropdown.activeProject'),
          projectCount: t('projectDropdown.projectCount', { count: data.chantiers.length }),
        }}
        userName={profile?.name ?? authUser.email ?? t('common.user')}
        userRole={workspaceRoleLabel(profile, t)}
        logoutLabel={t('common.logout')}
        openMenuLabel={t('common.openMenu')}
        closeMenuLabel={t('common.closeMenu')}
        expandSidebarLabel={t('shell.expandSidebar')}
        collapseSidebarLabel={t('shell.collapseSidebar')}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        actions={[
          ...(canCreate(profile) && activeTab !== 'admin' ? [
            {
              id: 'new-reserve',
              label: t('common.newReserve'),
              icon: 'reserve' as const,
              variant: 'primary' as const,
              onClick: () => openReserveCreate(),
            },
            {
              id: 'new-visit',
              label: t('common.newVisit'),
              icon: 'visit' as const,
              variant: 'secondary' as const,
              onClick: openVisitCreate,
            },
          ] : []),
          {
            id: 'sync',
            label: loading || syncing ? t('common.syncing') : t('common.sync'),
            icon: 'sync',
            variant: 'quiet',
            disabled: loading || syncing,
            busy: loading || syncing,
            onClick: () => {
              if (session.user) void loadEverything(session.user, { background: true });
            },
          },
        ]}
        containedWorkspace={activeTab === 'plans' || activeTab === 'reserves' || activeTab === 'visites' || activeTab === 'chantiers'}
        operationalMobile={activeTab === 'plans' || activeTab === 'reserves'}
        workspaceClassName={`${activeTab === 'plans' ? styles.workspacePlans : ''} ${activeTab === 'reserves' ? styles.workspaceReserves : ''} ${activeTab === 'visites' ? styles.workspaceVisites : ''} ${activeTab === 'chantiers' ? styles.workspaceChantiers : ''}`}
        onProjectSelect={projectId => {
          setSelectedProjectId(projectId);
        }}
        onCollapsedChange={setSidebarCollapsed}
        onMobileOpenChange={setMobileNavOpen}
        onLogout={handleSignOut}
      >

        {error ? (
          <div className={styles.floatingAlert} role="alert">
            <span>{error}</span>
            <button type="button" aria-label="Fermer" onClick={() => setError('')}>×</button>
          </div>
        ) : null}
        {notice ? (
          <div className={styles.floatingNotice} role="status">
            <span>{notice}</span>
            <button type="button" aria-label="Fermer" onClick={() => setNotice('')}>×</button>
          </div>
        ) : null}
        {textPrompt ? (
          <TextPromptDialog
            request={textPrompt}
            onSubmit={value => resolveTextPrompt(value)}
            onCancel={() => resolveTextPrompt(null)}
          />
        ) : null}
        {storageAlert ? <div className={styles.storageAlert}>{storageAlert}</div> : null}

        {loading ? (
          <div className={styles.loadingBlock}>{t('common.loadingData')}</div>
        ) : (
          <>
            {activeTab === 'inventory' && (
              canViewInventory(profile) ? (
                <InventoryWorkspace
                  snapshot={{
                    products: data.inventoryProducts,
                    movements: data.inventoryMovements,
                    projects: data.chantiers,
                    companies: data.companies,
                  }}
                  selectedProjectId={selectedProjectId}
                  capabilities={{
                    canRecord: canRecordInventory(profile),
                    canManage: canManageInventoryProducts(profile),
                    canAdjust: canAdjustInventory(profile),
                    canExport: canExportInventory(profile),
                  }}
                  language={webLang}
                  reportLanguage={reportLanguage}
                  onReportLanguageChange={setReportLanguage}
                  onReload={async () => {
                    if (session.user) await loadEverything(session.user, { background: true });
                  }}
                />
              ) : (
                <RestrictedTool title="Stock chantier" />
              )
            )}
            {activeTab === 'dashboard' && (
              <DashboardWebView
                source={dashboardSource}
                selectedProjectId={selectedProjectId}
                viewerName={profile?.name ?? authUser?.email ?? 'BuildTrack'}
                language={webLang}
                onIntent={handleDashboardIntent}
              />
            )}
            {activeTab === 'reserves' && (
              <ReservesView
                allReserves={scopedAllReserves}
                reserves={filteredReserves}
                photos={projectScoped.photos}
                profile={profile}
                companies={data.companies}
                scopeKey={selectedProjectId}
                selectedReserveId={selectedReserveId}
                selectedReserve={selectedFilteredReserve}
                setSelectedReserveId={setSelectedReserveId}
                detailRequest={reserveDetailRequest}
                onDetailRequestHandled={handleReserveDetailRequestHandled}
                onOpenReserveDetail={reserveId => openReserveDetailTab(reserveId)}
                search={search}
                setSearch={setSearch}
                statusFilter={effectiveStatusFilter}
                setStatusFilter={value => setStatusFilter(value === 'deleted' && !canViewReserveTrash ? 'all' : value)}
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
                onRequestLift={requestReserveLiftWeb}
                onAcknowledge={acknowledgeReserveWeb}
                onSign={signReserveWeb}
                onRejectVerification={rejectReserveVerificationWeb}
                onArchive={toggleArchive}
                onDelete={deleteReserveWeb}
                onRestore={restoreReserveWeb}
                onPermanentDelete={permanentlyDeleteReserveWeb}
                onComment={addReserveComment}
                onCreate={() => openReserveCreate()}
                onEdit={openReserveEdit}
                onFillDescriptions={fillMissingReserveDescriptions}
                onTranslateReserves={translateReserveTexts}
                onGenerateReservesPdf={(reserves: any[], language: TextLang, companyFilter?: string | null) => generateWebReport('global_reserves', { reserves, language, companyFilter })}
                onGenerateReservePdf={(reserve: any, language: TextLang) => generateWebReport('individual_reserve', { reserve, language })}
                generatingReport={generatingReport}
                defaultReportLanguage={reportLanguage}
                onReportLanguageChange={setReportLanguage}
                 canUseAssistant={isAdmin(profile) || isConducteur(profile)}
                editable={canEdit(profile)}
                canCreateReserve={canCreate(profile)}
                canDeleteReserve={canDelete(profile)}
                canPermanentlyDeleteReserve={canPermanentlyDeleteReserve(profile)}
                canExport={canExport(profile)}
                canMovePins={canMovePins(profile)}
                onLocateOnPlan={locateReserveOnPlanWeb}
                canViewTrash={canViewReserveTrash}
                saving={saving}
              />
            )}
            {activeTab === 'plans' && (
              <PlansView
                authUserId={authUser?.id ?? ''}
                plans={projectScoped.plans}
                reserves={projectScoped.reserves}
                companies={data.companies}
                projects={data.chantiers}
                selectedProject={selectedProjectId === 'all' ? (data.chantiers[0] ?? null) : (data.chantiers.find(project => project.id === selectedProjectId) ?? null)}
                selectedProjectId={selectedProjectId}
                selectedPlan={selectedPlan}
                setSelectedPlanId={setSelectedPlanId}
                onOpenReserve={openReserveDetailTab}
                placementReserve={placementReserveId ? (projectScoped.reserves.find((r: any) => r.id === placementReserveId) ?? null) : null}
                onPlacementDone={() => setPlacementReserveId(null)}
                onCreateReserve={(plan: any) => openReserveCreate({ plan })}
                onCreateReserveAtPin={(plan: any, pin: ReservePinDraft) => openReserveCreate({ plan, pin })}
                onMoveReservePin={moveReservePinWeb}
                onUpdatePlanAnnotations={updatePlanAnnotationsWeb}
                onCreatePlan={createSitePlanWeb}
                onUpdatePlan={updateSitePlanWeb}
                onDeletePlanFile={deleteSitePlanFileWeb}
                onDeletePlan={deleteSitePlanWeb}
                onCreateRevision={createSitePlanRevisionWeb}
                onGeneratePlansPdf={(plans: any[], reserves: any[], language: TextLang, companyFilter?: string | null, statusFilter?: string | null) =>
                  generateWebReport('plans', { plans, reserves, language, companyFilter, statusFilter })
                }
                generatingReport={generatingReport}
                defaultReportLanguage={reportLanguage}
                onReportLanguageChange={setReportLanguage}
                editable={canEdit(profile)}
                canCreatePlan={canCreate(profile)}
                canDeletePlan={canDelete(profile)}
                canMovePlanPins={canMovePins(profile)}
                canExportReports={canExport(profile)}
                saving={saving}
              />
            )}
            {activeTab === 'chantiers' && (
              <ChantiersView
                projects={data.chantiers}
                companies={data.companies}
                selectedProjectId={selectedProjectId}
                setSelectedProjectId={setSelectedProjectId}
                canCreateProject={canCreate(profile)}
                canEditProject={canEditChantier(profile)}
                canDeleteProject={canDelete(profile)}
                saving={saving}
                onSave={saveChantierWeb}
                onDelete={deleteChantierWeb}
              />
            )}
            {activeTab === 'journal' && (
              <JournalView
                profile={profile}
                projectName={projectName()}
                selectedProjectId={selectedProjectId}
                timeEntries={projectScoped.timeEntries}
                canCreate={canCreate(profile)}
                canDelete={canDelete(profile)}
                canExport={canExport(profile)}
                rows={projectScoped.journalEntries}
                onCreate={createJournalEntryWeb}
                onUpdate={updateJournalEntryWeb}
                onDelete={deleteJournalEntryWeb}
                onMigrate={migrateLocalJournalWeb}
              />
            )}
            {activeTab === 'pointage' && (
              <PointageView
                entries={projectScoped.timeEntries}
                companies={data.companies}
                profile={profile}
                editable={canUpdateAttendance(profile) || canCreate(profile)}
                canDelete={canDelete(profile)}
                onCreate={createTimeEntryWeb}
                onUpdate={updateTimeEntryWeb}
                onDelete={deleteTimeEntryWeb}
              />
            )}
            {activeTab === 'analytics' && (
              <AnalyticsView
                scoped={projectScoped}
                companies={data.companies}
                profile={profile}
                setTab={setActiveTab}
              />
            )}
            {activeTab === 'documents' && (
              <DocumentsView
                documents={projectScoped.documents}
                projects={data.chantiers}
                selectedProjectId={selectedProjectId}
                profile={profile}
                canCreate={canCreate(profile)}
                canDelete={canDelete(profile)}
                saving={saving}
                onCreate={createDocumentWeb}
                onDelete={deleteDocumentWeb}
              />
            )}
            {activeTab === 'checklists' && (
              <ChecklistsView
                profile={profile}
                selectedProjectId={selectedProjectId}
                canCreate={canCreate(profile)}
                canEdit={canEdit(profile)}
                canDelete={canDelete(profile)}
                rows={data.checklists}
                onSave={saveChecklistWeb}
                onToggle={updateChecklistItemsWeb}
                onDelete={deleteChecklistWeb}
                onMigrate={migrateLocalChecklistsWeb}
              />
            )}
            {activeTab === 'reglementaire' && (
              <ReglementaireView
                docs={projectScoped.regulatoryDocs}
                companies={data.companies}
                profile={profile}
                canCreate={canCreate(profile)}
                canEdit={canEdit(profile)}
                canDelete={canDelete(profile)}
                saving={saving}
                onSave={saveRegulatoryDocWeb}
                onDelete={deleteRegulatoryDocWeb}
              />
            )}
            {activeTab === 'search' && (
              <SearchView
                scoped={projectScoped}
                data={data}
                setTab={setActiveTab}
                onOpenReserve={openReserveDetailTab}
                setSelectedPlanId={setSelectedPlanId}
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
                  openReserveDetailTab(reserve.id);
                }}
                onUnlinkReserve={unlinkReserveFromVisitWeb}
                onAttachReserves={attachReservesToVisitWeb}
                onArchiveReserve={toggleArchive}
                onDeleteReserve={deleteReserveWeb}
                onUpdateVisit={updateVisitWeb}
                onDeleteVisit={deleteVisitWeb}
                onGenerateVisitReport={(visit: any, language: 'fr' | 'en' | 'es') => generateWebReport('visit_report', { visit, language })}
                reportLanguage={reportLanguage}
                setReportLanguage={setReportLanguage}
                generatingReport={generatingReport}
                restricted={profile?.role === 'sous_traitant'}
                editable={canEdit(profile)}
                canCreate={canCreate(profile)}
                canDelete={canDelete(profile)}
                canExport={canExport(profile)}
              />
            )}
            {activeTab === 'planning' && (
              <PlanningView
                tasks={projectScoped.tasks}
                visites={projectScoped.visites}
                reserves={projectScoped.reserves}
                companies={data.companies}
                 profile={profile}
                 editable={canEdit(profile)}
                 canCreate={canCreate(profile)}
                 onUpdateTask={updateTaskQuick}
                 onCreateTask={createTaskWeb}
                 onOpenReserve={openReserveDetailTab}
                 onOpenVisites={() => setActiveTab('visites')}
               />
            )}
            {activeTab === 'messages' && (
              <MessagesWorkspace
                snapshot={{
                  channels: data.channels,
                  companies: data.companies,
                  messages: data.messages,
                }}
                actor={{
                  userId: session?.user?.id ?? '',
                  displayName: profile?.name || authUser?.email || '',
                }}
                language={webLang}
                selectedChannelId={selectedChannel?.id ?? null}
                lastReadByChannel={lastReadByChannel}
                draft={messageDraft}
                onDraftChange={setMessageDraft}
                onSelectChannel={setSelectedChannelId}
                onSend={sendMessage}
                onUploadPhoto={uploadMessagePhoto}
                saving={saving}
              />
            )}
            {activeTab === 'terrain' && (
              <TerrainView
                scoped={projectScoped}
                data={data}
                profile={profile}
                canViewTeams={canViewTeams(profile)}
                setTab={setActiveTab}
              />
            )}
            {activeTab === 'incidents' && (
              <IncidentsView
                incidents={projectScoped.incidents}
                profile={profile}
                canCreate={canCreate(profile)}
                canEdit={canEdit(profile)}
                onCreate={createIncidentWeb}
                onUpdate={updateIncidentWeb}
              />
            )}
            {activeTab === 'opr' && (
              <OprView oprs={projectScoped.oprs} reserves={projectScoped.reserves} onOpenReserve={openReserveDetailTab} />
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
                canExport={canExport(profile)}
                onGenerate={generateWebReport}
              />
            )}
            {activeTab === 'equipes' && (
              canViewTeams(profile) ? (
                <EquipesView
                  companies={data.companies}
                  reserves={projectScoped.reserves}
                  tasks={projectScoped.tasks}
                  editable={canUpdateAttendance(profile)}
                  onUpdateCompanyField={updateCompanyField}
                />
              ) : (
                <RestrictedTool title="Équipes chantier" />
              )
            )}
            {activeTab === 'settings' && (
              <SettingsView
                profile={profile}
                authUser={authUser}
                data={data}
                scoped={projectScoped}
                selectedProjectId={selectedProjectId}
                preferences={data.notificationPreferences}
                languagePreference={webLanguagePreference}
                deviceLanguage={deviceLanguage}
                onUpdateLanguagePreference={handleWebLanguagePreferenceChange}
                exportLanguage={reportLanguage}
                onUpdateExportLanguage={setReportLanguage}
                onUpdateOwnProfile={updateOwnProfile}
                onUpdateNotificationField={updateNotificationField}
                onUpdateProject={updateProjectSettings}
                onUpdateCompanyField={updateCompanyField}
                onOpenTab={setActiveTab}
                onOpenAdmin={() => setActiveTab('admin')}
                onLogout={handleSignOut}
              />
            )}
            {activeTab === 'admin' && (
               <AdminView
                 data={data}
                 profile={profile}
                 onUpdateProfile={updateProfileField}
                 onEnterSupport={enterWebSupport}
                 onCreateCompany={createCompanyWeb}
                 onUpdateCompany={updateCompanyWeb}
                 onDeleteCompany={deleteCompanyWeb}
                 onRemoveUser={removeUserWeb}
               />
            )}
          </>
        )}
      </WorkspaceChrome>
      {reserveModalMode && (
        <ReserveModal
          mode={reserveModalMode}
          draft={reserveDraft}
          setDraft={setReserveDraft}
          data={data}
          selectedProjectId={selectedProjectId}
          saving={saving}
          onClose={requestCloseReserveModal}
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
    </WebI18nContext.Provider>
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
  profile: Profile | null;
  companies: any[];
  scopeKey: string;
  selectedReserveId: string | null;
  selectedReserve: any;
  setSelectedReserveId: (id: string) => void;
  detailRequest: { id: string; token: number } | null;
  onDetailRequestHandled: (token: number) => void;
  onOpenReserveDetail: (reserveId: string) => boolean;
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
  onRequestLift: (reserve: any, payload: { comment: string; file: File | null }) => Promise<void> | void;
  onAcknowledge: (reserve: any) => void;
  onSign: (reserve: any, companyName?: string) => void;
  onRejectVerification: (reserve: any) => void;
  onArchive: (reserve: any) => void;
  onDelete: (reserve: any) => Promise<void> | void;
  onRestore: (reserve: any) => Promise<void> | void;
  onPermanentDelete: (reserve: any) => Promise<void> | void;
  onComment: (reserve: any, content: string) => Promise<void> | void;
  onCreate: () => void;
  onEdit: (reserve: any) => void;
  onFillDescriptions: (reserves: any[]) => Promise<void> | void;
  onTranslateReserves: (reserves: any[], language: TextLang) => Promise<void> | void;
  onGenerateReservesPdf: (reserves: any[], language: TextLang, companyFilter?: string | null) => Promise<void> | void;
  onGenerateReservePdf: (reserve: any, language: TextLang) => Promise<void> | void;
  generatingReport: string | null;
  defaultReportLanguage: TextLang;
  onReportLanguageChange: (language: TextLang) => void;
  canUseAssistant: boolean;
  editable: boolean;
  canCreateReserve: boolean;
  canDeleteReserve: boolean;
  canPermanentlyDeleteReserve: boolean;
  canExport: boolean;
  canMovePins?: boolean;
  onLocateOnPlan?: (reserve: any) => void;
  canViewTrash: boolean;
  saving: boolean;
}) {
  const { allReserves, reserves, selectedReserve } = props;
  const { lang, t } = useWebI18n();
  const workspaceCopy = PLAN_RESERVE_WORKSPACE_COPY[lang].reserves;
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [assistantLanguage, setAssistantLanguage] = useState<TextLang>('fr');
  const [pdfLanguage, setPdfLanguage] = useState<TextLang>(props.defaultReportLanguage);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfMode, setPdfMode] = useState<'view' | 'selected' | 'company' | 'company_multi' | 'no_company'>('view');
  const [pdfCompany, setPdfCompany] = useState('');
  const [pdfCompaniesMulti, setPdfCompaniesMulti] = useState<Set<string>>(new Set());
  const [assistantScope, setAssistantScope] = useState<'view' | 'project' | 'selected'>('view');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [photoLightboxIndex, setPhotoLightboxIndex] = useState<number | null>(null);
  const [photoCopyFeedback, setPhotoCopyFeedback] = useState<'idle' | 'copied' | 'error'>('idle');
  const photoCopyFeedbackTimeoutRef = useRef<number | null>(null);
  const [liftRequestReserve, setLiftRequestReserve] = useState<any | null>(null);
  const [liftRequestComment, setLiftRequestComment] = useState('');
  const [liftRequestFile, setLiftRequestFile] = useState<File | null>(null);
  const [liftRequestBusy, setLiftRequestBusy] = useState(false);
  const reserveNavigatorScopeKey = [
    props.scopeKey,
    props.statusFilter,
    props.priorityFilter,
    props.companyFilter,
    props.buildingFilter,
    props.pinFilter,
    props.search,
  ].join('\u0000');
  const [reserveNavigatorState, setReserveNavigatorState] = useState(() => createReserveNavigatorState(reserveNavigatorScopeKey));
  const reserveListScrollTopRef = useRef(0);
  const reserveListFocusIdRef = useRef<string | null>(null);
  const reserveShouldRestoreListRef = useRef(false);
  const reserveHistoryEntryRef = useRef(false);
  const reserveDetailHistoryIdRef = useRef<string | null>(null);
  const reserveDetailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const syncedReserveNavigatorState = syncReserveNavigatorScope(
    reserveNavigatorState,
    reserveNavigatorScopeKey,
  );
  const effectiveReserveNavigatorState = reserveDetailHistoryIdRef.current
    ? showReserveNavigatorDetail(syncedReserveNavigatorState)
    : syncedReserveNavigatorState;
  const isTrashView = props.statusFilter === 'deleted';
  const currentReserves = useMemo(() => allReserves.filter(reserve => (
    !isReserveArchived(reserve)
    && !isReserveDeleted(reserve)
  )), [allReserves]);
  const activeReserves = useMemo(
    () => currentReserves.filter(reserve => !isReserveClosed(reserve)),
    [currentReserves],
  );
  const explicitlySelectedReserve = props.selectedReserveId
    ? allReserves.find(reserve => reserve.id === props.selectedReserveId) ?? null
    : null;
  const setReserveDetailOpen = useCallback((open: boolean) => {
    setReserveNavigatorState(state => open
      ? showReserveNavigatorDetail(state)
      : showReserveNavigatorList(state));
  }, []);
  const reserveWorkspace = useResponsiveWorkspaceNavigation({
    hasDetail: Boolean(explicitlySelectedReserve),
    detailOpen: effectiveReserveNavigatorState.view === 'detail',
    onDetailOpenChange: setReserveDetailOpen,
  });
  const {
    isCompact: isCompactReserveView,
    detailOpen: reserveDetailOpen,
    openDetail: openReserveDetail,
    closeDetail: closeReserveDetail,
  } = reserveWorkspace;
  const mobileDetailReserve = reserveDetailOpen ? explicitlySelectedReserve : null;
  const showMobileReserveDetail = isCompactReserveView && !!mobileDetailReserve;
  const detailReserve = showMobileReserveDetail ? mobileDetailReserve : selectedReserve;
  const reserveNavigatorModel = useMemo(
    () => buildReserveNavigatorModel(reserves, effectiveReserveNavigatorState, props.selectedReserveId),
    [effectiveReserveNavigatorState, props.selectedReserveId, reserves],
  );
  const visibleReserveRows = isCompactReserveView
    ? reserveNavigatorModel.visibleRows
    : reserves;
  const hiddenReserveRowCount = isCompactReserveView ? reserveNavigatorModel.hiddenCount : 0;
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

  useEffect(() => {
    reserveListScrollTopRef.current = 0;
    reserveListFocusIdRef.current = null;
    reserveShouldRestoreListRef.current = false;
    setReserveNavigatorState(state => {
      const synced = syncReserveNavigatorScope(state, reserveNavigatorScopeKey);
      return reserveDetailHistoryIdRef.current ? showReserveNavigatorDetail(synced) : synced;
    });
  }, [reserveNavigatorScopeKey]);
  const selectedPhotos = reservePhotoItems(detailReserve, props.photos);
  const selectedLocalOnlyPhotos = localOnlyPhotoCount(detailReserve, props.photos);
  const lightboxPhoto = photoLightboxIndex !== null ? selectedPhotos[photoLightboxIndex] : null;
  const lightboxPhotoMedia = usePrivateMediaAccess(lightboxPhoto?.uri, {
    enabled: Boolean(lightboxPhoto),
    priority: 'critical',
  });
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
  const detailReserveCompanies = detailReserve ? reserveCompanies(detailReserve) : [];
  const detailReserveSignatures = detailReserve ? reserveCompanySignatures(detailReserve) : {};
  const detailReserveAckAt = detailReserve?.enterprise_acknowledged_at ?? detailReserve?.enterpriseAcknowledgedAt ?? null;
  const detailReserveIsMultiCompany = detailReserveCompanies.length > 1;
  const detailReserveHasGlobalSignature = Boolean(detailReserve?.enterprise_signature ?? detailReserve?.enterpriseSignature);
  const detailReserveAllCompaniesSigned = detailReserveIsMultiCompany
    ? detailReserveCompanies.every(company => Boolean(detailReserveSignatures[company]?.signature))
    : detailReserveHasGlobalSignature;
  const canEditReserveWorkflow = props.editable;
  const canUseSubcontractorWorkflow = isSubcontractor(props.profile);
  const canUseReserveWorkflow = canEditReserveWorkflow || canUseSubcontractorWorkflow;
  const subcontractorCompanyName = canUseSubcontractorWorkflow && props.profile?.company_id
    ? props.companies.find(company => String(company.id) === String(props.profile?.company_id))?.name ?? null
    : null;
  const canSubcontractorSignCompany = (companyName?: string) => (
    !canUseSubcontractorWorkflow ||
    !subcontractorCompanyName ||
    sameName(companyName, subcontractorCompanyName)
  );
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
  const reserveFilterOptions = useMemo(
    () => RESERVE_FILTER_OPTIONS.filter(option => option.key !== 'deleted' || props.canViewTrash),
    [props.canViewTrash],
  );
  const filterCounts = useMemo(() => reserveFilterOptions.reduce<Record<string, number>>((acc, option) => {
    acc[option.key] =
      option.key === 'all'
        ? currentReserves.length
        : option.key === 'archived'
          ? allReserves.filter(isReserveArchived).length
          : option.key === 'deleted'
            ? allReserves.filter(isReserveDeleted).length
          : option.key === 'overdue'
            ? currentReserves.filter(isReserveOverdue).length
            : option.key === 'due_soon'
              ? currentReserves.filter(reserve => isReserveDueSoon(reserve)).length
              : option.key === 'ack_missing'
                ? currentReserves.filter(needsEnterpriseAck).length
                : option.key === 'ack_received'
                  ? currentReserves.filter(hasEnterpriseAck).length
                  : currentReserves.filter(reserve => reserve.status === option.key).length;
    return acc;
  }, {}), [allReserves, currentReserves, reserveFilterOptions]);
  const quickStatusKeys = new Set(['all', 'open', 'in_progress', 'waiting']);
  const quickStatusOptions = reserveFilterOptions.filter(option => quickStatusKeys.has(option.key));
  const advancedStatusOptions = reserveFilterOptions.filter(option => !quickStatusKeys.has(option.key));
  const advancedFilterCount = [
    props.priorityFilter,
    props.companyFilter,
    props.buildingFilter,
    props.pinFilter,
  ].filter(value => value !== 'all').length + (quickStatusKeys.has(props.statusFilter) ? 0 : 1);
  const workspaceSummary = useMemo(
    () => buildReserveWorkspaceSummary(allReserves, reserves),
    [allReserves, reserves],
  );

  useEffect(() => {
    if (advancedFilterActive || !quickStatusKeys.has(props.statusFilter)) {
      setShowAdvancedFilters(true);
    }
  }, [advancedFilterActive, props.statusFilter]);

  function reserveScrollOwner(source?: HTMLElement | null) {
    if (typeof document === 'undefined') return null;
    return (source?.closest("[data-operational-mobile='true']")
      ?? document.querySelector("[data-operational-mobile='true']")) as HTMLElement | null;
  }

  function reserveDetailUrl(reserveId: string | null) {
    const url = new URL(window.location.href);
    if (reserveId) url.searchParams.set('reserve', reserveId);
    else url.searchParams.delete('reserve');
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function pushReserveDetailHistory(reserveId: string) {
    if (typeof window === 'undefined') return;
    const currentState = window.history.state ?? {};
    if (currentState[WEB_RESERVE_HISTORY_STATE]) {
      window.history.replaceState(
        { ...currentState, [WEB_RESERVE_HISTORY_STATE]: true, reserveId },
        '',
        reserveDetailUrl(reserveId),
      );
    } else {
      window.history.pushState(
        { ...currentState, [WEB_RESERVE_HISTORY_STATE]: true, reserveId },
        '',
        reserveDetailUrl(reserveId),
      );
    }
    reserveHistoryEntryRef.current = true;
    reserveDetailHistoryIdRef.current = null;
  }

  function closeReserveDetailAndRestore() {
    reserveShouldRestoreListRef.current = true;
    closeReserveDetail();
    setCommentText('');
    setPhotoLightboxIndex(null);
  }

  useEffect(() => {
    setPdfLanguage(props.defaultReportLanguage);
  }, [props.defaultReportLanguage]);

  useEffect(() => {
    if (reserveDetailOpen && !explicitlySelectedReserve) {
      closeReserveDetailAndRestore();
    }
  }, [closeReserveDetail, explicitlySelectedReserve, reserveDetailOpen]);

  useEffect(() => {
    const request = props.detailRequest;
    if (!request || !explicitlySelectedReserve || String(explicitlySelectedReserve.id) !== String(request.id)) return;
    if (!isCompactReserveView) {
      props.onDetailRequestHandled(request.token);
      return;
    }
    reserveListScrollTopRef.current = 0;
    reserveListFocusIdRef.current = null;
    reserveShouldRestoreListRef.current = true;
    reserveDetailHistoryIdRef.current = request.id;
    openReserveDetail();
    setCommentText('');
    props.onDetailRequestHandled(request.token);
  }, [explicitlySelectedReserve, isCompactReserveView, openReserveDetail, props.detailRequest, props.onDetailRequestHandled]);

  useEffect(() => {
    if (!isCompactReserveView || !reserveDetailOpen || !detailReserve?.id || reserveHistoryEntryRef.current) return;
    if (reserveDetailHistoryIdRef.current !== String(detailReserve.id)) return;
    pushReserveDetailHistory(String(detailReserve.id));
  }, [detailReserve?.id, isCompactReserveView, reserveDetailOpen]);

  useEffect(() => {
    if (!reserveHistoryEntryRef.current || !reserveDetailOpen || !detailReserve?.id) return;
    if (reserveDetailHistoryIdRef.current === String(detailReserve.id)) {
      reserveDetailHistoryIdRef.current = null;
    }
  }, [detailReserve?.id, reserveDetailOpen]);

  useEffect(() => {
    if (!isCompactReserveView || !reserveDetailOpen) return;
    const scrollOwner = reserveScrollOwner();
    if (scrollOwner) scrollOwner.scrollTop = 0;
    const frame = window.requestAnimationFrame(() => reserveDetailHeadingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [isCompactReserveView, reserveDetailOpen, detailReserve?.id]);

  useEffect(() => {
    if (!isCompactReserveView || reserveDetailOpen || !reserveShouldRestoreListRef.current) return;
    reserveShouldRestoreListRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      const scrollOwner = reserveScrollOwner();
      if (scrollOwner) scrollOwner.scrollTop = reserveListScrollTopRef.current;
      const selectedId = reserveListFocusIdRef.current;
      const selectedRow = selectedId
        ? document.querySelector(`[data-reserve-id="${CSS.escape(selectedId)}"]`) as HTMLElement | null
        : null;
      const fallback = document.querySelector('[data-prw-reserve-sticky] input') as HTMLElement | null;
      (selectedRow ?? fallback)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isCompactReserveView, reserveDetailOpen, visibleReserveRows]);

  useEffect(() => {
    if (!isCompactReserveView) return;
    function onPopState(event: PopStateEvent) {
      const state = event.state ?? {};
      const reserveId = state[WEB_RESERVE_HISTORY_STATE] ? String(state.reserveId ?? '') : '';
      if (reserveId) {
        const target = allReserves.find(reserve => String(reserve.id) === reserveId);
        if (!target) {
          if (props.onOpenReserveDetail(reserveId)) return;
          const nextState = { ...state };
          delete nextState[WEB_RESERVE_HISTORY_STATE];
          delete nextState.reserveId;
          window.history.replaceState(nextState, '', reserveDetailUrl(null));
          reserveHistoryEntryRef.current = false;
          reserveDetailHistoryIdRef.current = null;
          closeReserveDetailAndRestore();
          return;
        }
        props.setSelectedReserveId(reserveId);
        reserveHistoryEntryRef.current = true;
        reserveDetailHistoryIdRef.current = reserveId;
        reserveListScrollTopRef.current = 0;
        reserveListFocusIdRef.current = null;
        reserveShouldRestoreListRef.current = true;
        openReserveDetail();
        return;
      }
      if (!reserveHistoryEntryRef.current && !reserveDetailOpen) return;
      reserveHistoryEntryRef.current = false;
      reserveDetailHistoryIdRef.current = null;
      closeReserveDetailAndRestore();
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [allReserves, closeReserveDetail, isCompactReserveView, openReserveDetail, props.onOpenReserveDetail, reserveDetailOpen]);

  useEffect(() => {
    if (
      !isCompactReserveView
      || reserveDetailOpen
      || !explicitlySelectedReserve
      || typeof window === 'undefined'
    ) return;
    const state = window.history.state ?? {};
    const reserveId = state[WEB_RESERVE_HISTORY_STATE] ? String(state.reserveId ?? '') : '';
    if (!reserveId || reserveId !== String(explicitlySelectedReserve.id)) return;
    reserveHistoryEntryRef.current = true;
    reserveDetailHistoryIdRef.current = reserveId;
    reserveListScrollTopRef.current = 0;
    reserveListFocusIdRef.current = null;
    reserveShouldRestoreListRef.current = true;
    openReserveDetail();
  }, [explicitlySelectedReserve, isCompactReserveView, openReserveDetail, reserveDetailOpen]);

  useEffect(() => {
    if (reserveDetailOpen || !reserveHistoryEntryRef.current || reserveDetailHistoryIdRef.current) return;
    const ownsCurrentHistoryEntry = typeof window !== 'undefined'
      && Boolean(window.history.state?.[WEB_RESERVE_HISTORY_STATE]);
    reserveHistoryEntryRef.current = false;
    reserveDetailHistoryIdRef.current = null;
    if (ownsCurrentHistoryEntry) window.history.back();
  }, [reserveDetailOpen, reserveNavigatorScopeKey]);

  useEffect(() => {
    setPhotoLightboxIndex(null);
  }, [detailReserve?.id]);

  useEffect(() => {
    setPhotoCopyFeedback('idle');
  }, [lightboxPhoto?.uri]);

  useEffect(() => () => {
    if (photoCopyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(photoCopyFeedbackTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (photoLightboxIndex === null) return;
    if (photoLightboxIndex >= selectedPhotos.length) {
      setPhotoLightboxIndex(selectedPhotos.length ? selectedPhotos.length - 1 : null);
    }
  }, [photoLightboxIndex, selectedPhotos.length]);

  useEffect(() => {
    if (photoLightboxIndex === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPhotoLightboxIndex(null);
      }
      if (selectedPhotos.length > 1 && event.key === 'ArrowLeft') {
        setPhotoLightboxIndex(index => index === null ? index : (index - 1 + selectedPhotos.length) % selectedPhotos.length);
      }
      if (selectedPhotos.length > 1 && event.key === 'ArrowRight') {
        setPhotoLightboxIndex(index => index === null ? index : (index + 1) % selectedPhotos.length);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [photoLightboxIndex, selectedPhotos.length]);

  function openReserveFromList(reserve: any, event: MouseEvent<HTMLButtonElement>) {
    props.setSelectedReserveId(reserve.id);
    if (isCompactReserveView) {
      const scrollOwner = reserveScrollOwner(event.currentTarget);
      reserveListScrollTopRef.current = scrollOwner?.scrollTop ?? 0;
      reserveListFocusIdRef.current = String(reserve.id);
      reserveShouldRestoreListRef.current = true;
      reserveDetailHistoryIdRef.current = String(reserve.id);
      openReserveDetail();
      setCommentText('');
    }
  }

  function handleReserveDetailBack() {
    if (
      typeof window !== 'undefined'
      && reserveHistoryEntryRef.current
      && window.history.state?.[WEB_RESERVE_HISTORY_STATE]
    ) {
      reserveHistoryEntryRef.current = false;
      reserveDetailHistoryIdRef.current = null;
      window.history.back();
      return;
    }
    reserveHistoryEntryRef.current = false;
    reserveDetailHistoryIdRef.current = null;
    closeReserveDetailAndRestore();
  }

  function moveLightboxPhoto(direction: -1 | 1) {
    if (selectedPhotos.length <= 1) return;
    setPhotoLightboxIndex(index => index === null ? index : (index + direction + selectedPhotos.length) % selectedPhotos.length);
  }

  function showPhotoCopyFeedback(state: 'copied' | 'error') {
    if (photoCopyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(photoCopyFeedbackTimeoutRef.current);
    }
    setPhotoCopyFeedback(state);
    photoCopyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setPhotoCopyFeedback('idle');
      photoCopyFeedbackTimeoutRef.current = null;
    }, 2200);
  }

  async function copyLightboxPhotoLink() {
    if (!lightboxPhotoMedia.url || typeof navigator === 'undefined' || !navigator.clipboard) {
      showPhotoCopyFeedback('error');
      return;
    }
    try {
      await navigator.clipboard.writeText(lightboxPhotoMedia.url);
      showPhotoCopyFeedback('copied');
    } catch {
      showPhotoCopyFeedback('error');
    }
  }

  function openLiftRequest(reserve: any) {
    setLiftRequestReserve(reserve);
    setLiftRequestComment('');
    setLiftRequestFile(null);
  }

  function closeLiftRequest() {
    if (liftRequestBusy || props.saving) return;
    setLiftRequestReserve(null);
    setLiftRequestComment('');
    setLiftRequestFile(null);
  }

  async function submitLiftRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!liftRequestReserve || liftRequestBusy) return;
    setLiftRequestBusy(true);
    try {
      await props.onRequestLift(liftRequestReserve, {
        comment: liftRequestComment,
        file: liftRequestFile,
      });
      setLiftRequestReserve(null);
      setLiftRequestComment('');
      setLiftRequestFile(null);
    } catch {
      // L'erreur est affichee par le parent.
    } finally {
      setLiftRequestBusy(false);
    }
  }

  async function handleReservePdfExport() {
    if (!props.canExport) return;
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
    <div className={`${styles.reservesLayout} ${workspaceStyles.reserveRoot} ${showMobileReserveDetail ? styles.reservesLayoutMobileDetail : ''}`} data-testid="web-reserves-workspace">
      <WorkspacePageHeader
        eyebrow={t('reserves.followUp')}
        title={isTrashView ? (lang === 'en' ? 'Trash' : lang === 'es' ? 'Papelera' : 'Corbeille') : t('reserves.title')}
        description={workspaceCopy.description}
        metrics={[
          { label: workspaceCopy.visible, value: workspaceSummary.visible },
          { label: workspaceCopy.active, value: workspaceSummary.active, tone: 'blue' },
          { label: workspaceCopy.overdue, value: workspaceSummary.overdue, tone: 'danger' },
          { label: workspaceCopy.verification, value: workspaceSummary.verification, tone: 'orange' },
        ]}
        actions={(
          <>
            {props.canExport && (
              <button
                type="button"
                onClick={() => setPdfModalOpen(true)}
                disabled={isTrashView || (reserves.length === 0 && !selectedReserve)}
              >
                <WorkspaceIcon name="document" size={17} />
                {workspaceCopy.export}
              </button>
            )}
            {!isTrashView && props.canUseAssistant && activeReserves.length > 0 && (
              <button type="button" onClick={() => setAssistantVisible(true)}>
                <WorkspaceIcon name="assistant" size={17} />
                {workspaceCopy.assistant}
                {assistantMissingDescriptionCount > 0 ? ` (${assistantMissingDescriptionCount > 9 ? '9+' : assistantMissingDescriptionCount})` : ''}
              </button>
            )}
            {props.canCreateReserve && (
              <button type="button" data-primary="true" onClick={props.onCreate}>
                <WorkspaceIcon name="plus" size={17} />
                {workspaceCopy.create}
              </button>
            )}
          </>
        )}
        compactDetail={showMobileReserveDetail}
      />
      {!showMobileReserveDetail && (
      <section className={`${styles.panel} ${styles.reservesListPanel}`} data-prw-panel data-prw-reserve-list>
        <div className={styles.reserveRailStickyWeb} data-prw-reserve-sticky>
          <WorkspaceSearch
            value={props.search}
            placeholder={t('reserves.searchPlaceholder')}
            clearLabel={t('common.clearSearch')}
            onChange={props.setSearch}
          />
          <div className={styles.reserveCompactToolbar} data-prw-reserve-toolbar>
          <div className={styles.reserveFilterRail} data-prw-filter-rail role="group" aria-label="Filtrer les réserves par statut">
            {quickStatusOptions.map(option => {
              const active = props.statusFilter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={active ? styles.reserveFilterChipActive : ''}
                  data-active={active}
                  aria-pressed={active}
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
            data-prw-filter-toggle
            aria-expanded={showAdvancedFilters}
            aria-controls="reserve-advanced-filters"
            onClick={() => setShowAdvancedFilters(value => !value)}
          >
            <WorkspaceIcon name="filter" size={16} />
            Filtres
            {advancedFilterCount > 0 && <em>{advancedFilterCount}</em>}
          </button>
          </div>
        </div>
        {showAdvancedFilters && (
          <div id="reserve-advanced-filters" className={styles.reserveAdvancedPanel} data-prw-advanced>
            <div className={styles.reserveAdvancedStatusGrid} data-prw-advanced-status role="group" aria-label="Statuts supplémentaires">
              {advancedStatusOptions.map(option => {
                const active = props.statusFilter === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={active ? styles.reserveFilterChipActive : ''}
                    data-active={active}
                    aria-pressed={active}
                    onClick={() => props.setStatusFilter(option.key)}
                  >
                    <span>{option.label}</span>
                    <em>{filterCounts[option.key] ?? 0}</em>
                  </button>
                );
              })}
            </div>
            <div className={styles.reserveAdvancedFiltersWeb} data-prw-advanced-controls>
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
        <div className={styles.reserveListMeta} data-prw-list-meta>
          <span role="status" aria-live="polite">
            {visibleReserveRows.length} affichée{visibleReserveRows.length > 1 ? 's' : ''} sur {reserves.length}
          </span>
          <span>{isTrashView ? 'éléments récupérables' : `${currentReserves.length} non archivée${currentReserves.length > 1 ? 's' : ''}`}</span>
        </div>
        <div className={styles.reserveList} data-prw-reserve-rows>
          {visibleReserveRows.map(reserve => {
            const selectedRowId = isCompactReserveView ? props.selectedReserveId : selectedReserve?.id;
            const isSelected = selectedRowId != null && String(selectedRowId) === String(reserve.id);
            return (
              <button
                key={reserve.id}
                className={`${styles.reserveRow} ${isSelected ? styles.reserveRowActive : ''}`}
                data-prw-reserve-row
                data-reserve-id={String(reserve.id)}
                data-selected={isSelected}
                aria-current={isSelected ? 'true' : undefined}
                onClick={event => openReserveFromList(reserve, event)}
              >
              <div>
                <span className={`${styles.dot} ${styles[`priority_${reserve.priority}`] ?? ''}`} aria-hidden="true" />
                <span className={styles.srOnly}>Priorité {PRIORITY_LABELS[reserve.priority] ?? reserve.priority ?? 'non définie'}</span>
                <strong>{reserve.id}</strong>
              </div>
              <div>
                <strong>{reserve.title}</strong>
                <small>{[reserve.building, reserve.level, reserve.zone].filter(Boolean).join(' · ') || 'Sans localisation'}</small>
                <span>{reserveCompanies(reserve).join(', ') || 'Sans entreprise'}</span>
              </div>
              <em className={isReserveOverdue(reserve) ? styles.reserveStatusOverdue : ''}>
                {isReserveDeleted(reserve) ? 'Corbeille' : isReserveArchived(reserve) ? 'Archivée' : isReserveOverdue(reserve) ? 'En retard' : STATUS_LABELS[reserve.status] ?? reserve.status}
              </em>
              </button>
            );
          })}
          {hiddenReserveRowCount > 0 && (
            <button
              type="button"
              className={styles.reserveLoadMore}
              onClick={() => setReserveNavigatorState(showNextReserveBatch)}
            >
              <strong>Afficher {reserveNavigatorModel.nextBatchCount} réserves de plus</strong>
              <span>{reserveNavigatorModel.visibleCount} sur {reserveNavigatorModel.totalCount}</span>
            </button>
          )}
          {!reserves.length && (
            <p className={styles.empty}>
              {isTrashView ? 'Corbeille vide.' : 'Aucune réserve avec ces filtres.'}
              {!isTrashView && (props.search || props.statusFilter !== 'all' || props.priorityFilter !== 'all' || props.companyFilter !== 'all' || props.buildingFilter !== 'all' || props.pinFilter !== 'all') ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => {
                      props.setSearch('');
                      props.setStatusFilter('all');
                      props.setPriorityFilter('all');
                      props.setCompanyFilter('all');
                      props.setBuildingFilter('all');
                      props.setPinFilter('all');
                    }}
                  >
                    Réinitialiser les filtres
                  </button>
                </>
              ) : null}
            </p>
          )}
        </div>
      </section>
      )}

      {liftRequestReserve && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          onMouseDown={closeLiftRequest}
        >
          <form className={`${styles.modalPanel} ${styles.reserveLiftModalWeb}`} onMouseDown={event => event.stopPropagation()} onSubmit={submitLiftRequest}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Demande de levée</p>
                <h2>{liftRequestReserve.id}</h2>
                <span>Commentaire et photo facultatifs.</span>
              </div>
              <button type="button" onClick={closeLiftRequest} disabled={liftRequestBusy || props.saving}>Fermer</button>
            </div>
            <div className={styles.reserveLiftModalBodyWeb}>
              <label>
                <span>Commentaire facultatif</span>
                <textarea
                  value={liftRequestComment}
                  onChange={event => setLiftRequestComment(event.target.value)}
                  placeholder="Expliquer ce qui a été repris..."
                  disabled={liftRequestBusy || props.saving}
                />
              </label>
              <label>
                <span>Photo facultative</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={liftRequestBusy || props.saving}
                  onChange={event => setLiftRequestFile(event.target.files?.[0] ?? null)}
                />
              </label>
              {liftRequestFile && (
                <div className={styles.reserveLiftFileWeb}>
                  <span>{liftRequestFile.name}</span>
                  <button type="button" onClick={() => setLiftRequestFile(null)} disabled={liftRequestBusy || props.saving}>
                    Retirer
                  </button>
                </div>
              )}
            </div>
            <div className={styles.modalActions}>
              <button type="button" onClick={closeLiftRequest} disabled={liftRequestBusy || props.saving}>Annuler</button>
              <button type="submit" disabled={liftRequestBusy || props.saving}>
                {liftRequestBusy || props.saving ? 'Envoi...' : 'Envoyer la demande'}
              </button>
            </div>
          </form>
        </div>
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

      {pdfModalOpen && props.canExport && (
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
                      onClick={() => {
                        setPdfLanguage(option.value);
                        props.onReportLanguageChange(option.value);
                      }}
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
      <section className={`${styles.panel} ${styles.reservesDetailPanel} ${showMobileReserveDetail ? styles.reservesMobileDetailPanel : ''}`} data-prw-panel data-prw-reserve-detail>
        {showMobileReserveDetail && (
          <WorkspaceBackButton
            label={workspaceCopy.back}
            onClick={handleReserveDetailBack}
          />
        )}
        {detailReserve ? (
          <>
            <div className={styles.reserveDetailHeader} data-prw-detail-header>
              <div>
                <p className={styles.eyebrow}>{detailReserve.id}</p>
                <h2 ref={reserveDetailHeadingRef} tabIndex={-1}>{detailReserve.title}</h2>
                <span>{[detailReserve.building, detailReserve.level, detailReserve.zone].filter(Boolean).join(' · ') || 'Sans localisation'}</span>
              </div>
              <span className={styles.badge}>{PRIORITY_LABELS[detailReserve.priority] ?? detailReserve.priority}</span>
            </div>
            <div className={styles.reserveDetailBody} data-prw-detail-body>
            <p className={styles.description}>{detailReserve.description || 'Aucune description.'}</p>
            <dl className={styles.metaGrid} data-prw-meta>
              <div><dt>Statut</dt><dd>{STATUS_LABELS[detailReserve.status] ?? detailReserve.status}</dd></div>
              <div><dt>Entreprise</dt><dd>{reserveCompanies(detailReserve).join(', ') || '—'}</dd></div>
              <div><dt>Échéance</dt><dd>{prettyDate(detailReserve.deadline)}</dd></div>
              <div><dt>Plan</dt><dd>{detailReserve.plan_id ? 'Épinglée' : 'Non épinglée'}</dd></div>
              <div><dt>Accusé réception</dt><dd>{detailReserve.enterprise_acknowledged_at ? prettyDate(detailReserve.enterprise_acknowledged_at, true) : 'Manquant'}</dd></div>
              <div><dt>Archive</dt><dd>{detailReserve.archived_at ? prettyDate(detailReserve.archived_at, true) : 'Active'}</dd></div>
              {isTrashView && <div><dt>Corbeille</dt><dd>{detailReserve.deleted_at ? prettyDate(detailReserve.deleted_at, true) : 'Oui'}</dd></div>}
              {isTrashView && <div><dt>Supprimée par</dt><dd>{detailReserve.deleted_by ?? '—'}</dd></div>}
            </dl>
            {!isTrashView && canUseReserveWorkflow && (
              <section className={styles.reserveWorkflowCard} data-prw-workflow>
                <div className={styles.reserveWorkflowHeader}>
                  <div>
                    <h3>Tunnel réserve</h3>
                    <span>{detailReserve.status === 'closed' ? 'Finalisée' : detailReserve.status === 'verification' ? 'En attente de validation' : 'En traitement'}</span>
                  </div>
                  <strong>{STATUS_LABELS[detailReserve.status] ?? detailReserve.status}</strong>
                </div>

                {canUseSubcontractorWorkflow && (
                  <div className={styles.reserveWorkflowBlock}>
                    <p>Sous-traitant</p>
                    <div className={styles.reserveWorkflowActions}>
                      {detailReserve.status === 'open' && (
                        <button type="button" disabled={props.saving} onClick={() => props.onStatus(detailReserve.id, 'in_progress')}>
                          Passer en cours
                        </button>
                      )}
                      {['open', 'in_progress', 'waiting'].includes(detailReserve.status) && (
                        <button type="button" disabled={props.saving} onClick={() => openLiftRequest(detailReserve)}>
                          Demander la levée
                        </button>
                      )}
                      {detailReserve.status === 'verification' && <span>Demande envoyée, en attente de validation interne.</span>}
                      {detailReserve.status === 'closed' && <span>Clôture validée.</span>}
                    </div>
                  </div>
                )}

                {canEditReserveWorkflow && (
                  <div className={styles.reserveWorkflowBlock}>
                    <p>Équipe interne</p>
                    <div className={styles.reserveWorkflowActions}>
                      {!detailReserveAckAt ? (
                        <button type="button" disabled={props.saving} onClick={() => props.onAcknowledge(detailReserve)}>
                          Accuser réception
                        </button>
                      ) : (
                        <span>AR reçu le {prettyDate(detailReserveAckAt, true)}</span>
                      )}
                      {detailReserve.status === 'verification' && (
                        <>
                          <button type="button" disabled={props.saving} onClick={() => props.onStatus(detailReserve.id, 'closed')}>
                            Valider et clôturer
                          </button>
                          <button type="button" disabled={props.saving} onClick={() => props.onRejectVerification(detailReserve)}>
                            Refuser la levée
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className={styles.reserveWorkflowBlock}>
                  <p>Signature de levée</p>
                  {!detailReserveAckAt ? (
                    <span>Disponible après accusé de réception.</span>
                  ) : detailReserveIsMultiCompany ? (
                    <div className={styles.reserveSignatureGrid}>
                      {detailReserveCompanies.map(company => {
                        const signature = detailReserveSignatures[company];
                        return (
                          <div key={company} className={styles.reserveSignatureRow}>
                            <strong>{company}</strong>
                            {signature?.signature ? (
                              <span>Signée par {signature.signataire || '—'}{signature.signedAt ? ` le ${prettyDate(signature.signedAt, true)}` : ''}</span>
                            ) : canEditReserveWorkflow || canSubcontractorSignCompany(company) ? (
                              <button type="button" disabled={props.saving} onClick={() => props.onSign(detailReserve, company)}>
                                Signer
                              </button>
                            ) : (
                              <span>Signature réservée à l’entreprise concernée.</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : detailReserveHasGlobalSignature ? (
                    <div className={styles.reserveSignaturePreview}>
                      <span>Signée par {detailReserve.enterprise_signataire ?? detailReserve.enterpriseSignataire ?? '—'}</span>
                      <img src={signatureImageSrc(detailReserve.enterprise_signature ?? detailReserve.enterpriseSignature)} alt="Signature de levée" />
                    </div>
                  ) : canEditReserveWorkflow || canSubcontractorSignCompany(detailReserveCompanies[0]) ? (
                    <button type="button" disabled={props.saving} onClick={() => props.onSign(detailReserve)}>
                      Signer la levée
                    </button>
                  ) : (
                    <span>Signature réservée à l’entreprise concernée.</span>
                  )}
                  {detailReserveAllCompaniesSigned && detailReserveIsMultiCompany && <span>Toutes les entreprises ont signé.</span>}
                </div>
              </section>
            )}
            {selectedPhotos.length ? (
              <div className={styles.reserveDetailPhotos}>
                <div>
                  <h3>Photos</h3>
                  <span>{selectedPhotos.length} média{selectedPhotos.length > 1 ? 's' : ''} associé{selectedPhotos.length > 1 ? 's' : ''}</span>
                </div>
                <div className={styles.reserveDetailPhotoGrid}>
                  {selectedPhotos.map((photo, index) => (
                    <button
                      key={photo.id ?? photo.uri}
                      type="button"
                      onClick={() => setPhotoLightboxIndex(index)}
                      aria-label={`Ouvrir la photo ${index + 1} sur ${selectedPhotos.length}`}
                    >
                      <PrivatePhotoFrame photo={photo} compact fit="cover" />
                      <span className={styles.reservePhotoKindBadge}>{photo.kind === 'resolution' ? 'Levée' : 'Constat'}</span>
                    </button>
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
            {!isTrashView && <form
              className={styles.commentForm}
              onSubmit={async event => {
                event.preventDefault();
                if (!commentText.trim() || commentBusy) return;
                setCommentBusy(true);
                try {
                  await props.onComment(detailReserve, commentText);
                  setCommentText('');
                } finally {
                  setCommentBusy(false);
                }
              }}
            >
              <input
                value={commentText}
                onChange={event => setCommentText(event.target.value)}
                placeholder="Ajouter un commentaire de suivi..."
              />
              <button type="submit" disabled={props.saving || commentBusy || !commentText.trim()}>Ajouter</button>
              <div className={styles.commentAssist}>
                <TextAssistControls
                  value={commentText}
                  onChange={setCommentText}
                  context="reserve comment"
                />
              </div>
            </form>}
            {!isTrashView && props.canExport && <div className={styles.reserveDetailExportRow}>
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
            </div>}
            {props.editable && isTrashView && (
              <div className={styles.actionBar} data-prw-actions>
                <button type="button" onClick={() => props.onRestore(detailReserve)} disabled={props.saving}>Restaurer</button>
                {props.canPermanentlyDeleteReserve && (
                  <button type="button" className={styles.dangerButton} onClick={() => props.onPermanentDelete(detailReserve)} disabled={props.saving}>
                    Supprimer définitivement
                  </button>
                )}
              </div>
            )}
            {props.editable && !isTrashView && (
              <div className={styles.actionBar} data-prw-actions>
                <button type="button" onClick={() => props.onEdit(detailReserve)}>Modifier</button>
                {props.canMovePins && !detailReserve.plan_id && props.onLocateOnPlan && (
                  <button
                    type="button"
                    className={styles.reserveLocateButton}
                    onClick={() => props.onLocateOnPlan?.(detailReserve)}
                    title="Placer une pastille sur un plan pour localiser cette réserve"
                  >
                    <WorkspaceIcon name="pin" size={16} /> Placer sur le plan
                  </button>
                )}
                {STATUS_OPTIONS.map(([value, label]) => (
                  <button type="button" key={value} disabled={props.saving || detailReserve.status === value} onClick={() => props.onStatus(detailReserve.id, value)}>
                    {label}
                  </button>
                ))}
                <button type="button" onClick={() => props.onArchive(detailReserve)}>{detailReserve.archived_at ? 'Désarchiver' : 'Archiver'}</button>
                {props.canDeleteReserve && <button type="button" className={styles.dangerButton} onClick={() => props.onDelete(detailReserve)}>Supprimer</button>}
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
      {lightboxPhoto && (
        <div
          className={styles.reservePhotoLightboxBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu photo réserve"
          onMouseDown={() => setPhotoLightboxIndex(null)}
        >
          <section className={styles.reservePhotoLightboxPanel} onMouseDown={event => event.stopPropagation()}>
            <header className={styles.reservePhotoLightboxHeader}>
              <div>
                <p className={styles.eyebrow}>{detailReserve?.id ?? 'Réserve'}</p>
                <h2>{lightboxPhoto.comment ?? lightboxPhoto.name ?? 'Photo réserve'}</h2>
                <span>{photoLightboxIndex !== null ? `${photoLightboxIndex + 1} / ${selectedPhotos.length}` : ''} · {lightboxPhoto.kind === 'resolution' ? 'Levée' : 'Constat'}</span>
              </div>
              <button type="button" onClick={() => setPhotoLightboxIndex(null)} aria-label="Fermer l’aperçu">×</button>
            </header>

            <div className={styles.reservePhotoLightboxStage}>
              {selectedPhotos.length > 1 && (
                <button type="button" className={styles.reservePhotoLightboxPrev} onClick={() => moveLightboxPhoto(-1)} aria-label="Photo précédente">
                  ‹
                </button>
              )}
              <PrivatePhotoFrame
                photo={lightboxPhoto}
                className={styles.reservePhotoLightboxImageFrame}
                immediate
              />
              {selectedPhotos.length > 1 && (
                <button type="button" className={styles.reservePhotoLightboxNext} onClick={() => moveLightboxPhoto(1)} aria-label="Photo suivante">
                  ›
                </button>
              )}
            </div>

            <footer className={styles.reservePhotoLightboxFooter}>
              <span>{lightboxPhoto.name ?? lightboxPhoto.comment ?? 'Photo réserve'}</span>
              {photoCopyFeedback !== 'idle' && (
                <span
                  className={`${styles.reservePhotoLightboxCopyFeedback} ${photoCopyFeedback === 'error' ? styles.reservePhotoLightboxCopyFeedbackError : ''}`}
                  role="status"
                  aria-live="polite"
                >
                  {photoCopyFeedback === 'copied' ? 'Lien copié' : 'Copie impossible'}
                </span>
              )}
              <div>
                <button
                  type="button"
                  className={
                    photoCopyFeedback === 'copied'
                      ? styles.reservePhotoLightboxCopiedButton
                      : photoCopyFeedback === 'error'
                        ? styles.reservePhotoLightboxCopyErrorButton
                        : ''
                  }
                  onClick={() => void copyLightboxPhotoLink()}
                  disabled={!lightboxPhotoMedia.url}
                >
                  {photoCopyFeedback === 'copied' ? 'Lien copié' : photoCopyFeedback === 'error' ? 'Réessayer' : 'Copier le lien'}
                </button>
                {lightboxPhotoMedia.url ? (
                  <a href={lightboxPhotoMedia.url} target="_blank" rel="noreferrer">Ouvrir dans un onglet</a>
                ) : null}
              </div>
            </footer>
          </section>
        </div>
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
          <span>{row.content ?? row.newValue ?? prettyDate(row.createdAt, true)}</span>
        </div>
      )) : <small>Aucun élément.</small>}
    </div>
  );
}

function drawingPath(points: PlanDrawing['points']) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function webPlanCloudPath(x1: number, y1: number, x2: number, y2: number) {
  const sx = Math.min(x1, x2);
  const sy = Math.min(y1, y2);
  const width = Math.max(Math.abs(x2 - x1), 0.75);
  const height = Math.max(Math.abs(y2 - y1), 0.75);
  const horizontalBumps = 5;
  const verticalBumps = Math.max(
    2,
    Math.min(12, Math.round(height / Math.max(width / horizontalBumps, 0.15))),
  );
  const bumpWidth = width / horizontalBumps;
  const bumpHeight = height / verticalBumps;
  const radiusX = bumpWidth * 0.55;
  const radiusY = bumpHeight * 0.55;
  let path = `M ${sx + bumpWidth / 2} ${sy}`;
  for (let index = 0; index < horizontalBumps; index += 1) path += ` a ${radiusX} ${radiusY} 0 0 1 ${bumpWidth} 0`;
  for (let index = 0; index < verticalBumps; index += 1) path += ` a ${radiusX} ${radiusY} 0 0 1 0 ${bumpHeight}`;
  for (let index = 0; index < horizontalBumps; index += 1) path += ` a ${radiusX} ${radiusY} 0 0 1 ${-bumpWidth} 0`;
  for (let index = 0; index < verticalBumps; index += 1) path += ` a ${radiusX} ${radiusY} 0 0 1 0 ${-bumpHeight}`;
  return `${path} Z`;
}

const WEB_PLAN_DRAWING_PAGE = 1;
const WEB_PLAN_DRAWING_COLORS = [
  { value: '#ef4444', labelKey: 'plans.drawingColorRed' },
  { value: '#f59e0b', labelKey: 'plans.drawingColorAmber' },
  { value: '#22c55e', labelKey: 'plans.drawingColorGreen' },
  { value: '#2563eb', labelKey: 'plans.drawingColorBlue' },
  { value: '#111827', labelKey: 'plans.drawingColorBlack' },
] as const;

function renderWebPlanDrawing(
  drawing: PlanDrawing,
  key: string,
  selected = false,
  interactive = false,
  accessibleLabel?: string,
) {
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

  let shape: ReactNode;
  if (drawing.tool === 'cloud') {
    shape = <path d={webPlanCloudPath(first.x, first.y, last.x, last.y)} fill="none" {...common} />;
  } else if (drawing.tool === 'rect' || drawing.tool === 'highlight') {
    const x = Math.min(first.x, last.x);
    const y = Math.min(first.y, last.y);
    const width = Math.abs(last.x - first.x);
    const height = Math.abs(last.y - first.y);
    shape = (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={0.7}
        fill={drawing.tool === 'highlight' ? drawing.color || '#facc15' : 'none'}
        {...common}
      />
    );
  } else if (drawing.tool === 'ellipse') {
    const cx = (first.x + last.x) / 2;
    const cy = (first.y + last.y) / 2;
    shape = (
      <ellipse
        cx={cx}
        cy={cy}
        rx={Math.abs(last.x - first.x) / 2}
        ry={Math.abs(last.y - first.y) / 2}
        fill="none"
        {...common}
      />
    );
  } else if (drawing.tool === 'line' || drawing.tool === 'arrow') {
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
    shape = (
      <g>
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
  } else if (drawing.tool === 'text') {
    shape = (
      <text
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
  } else {
    shape = (
      <path
        d={drawingPath(points)}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...common}
      />
    );
  }

  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(1.8, Math.max(...xs) - minX);
  const height = Math.max(1.8, Math.max(...ys) - minY);
  return (
    <g
      key={key}
      data-plan-drawing-id={drawing.id}
      className={selected ? styles.webPdfDrawingSelected : styles.webPdfDrawing}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? accessibleLabel ?? `Annotation ${drawing.tool}` : undefined}
    >
      {shape}
      {interactive ? (
        <rect
          className={styles.webPdfDrawingHitArea}
          x={minX - 1.2}
          y={minY - 1.2}
          width={width + 2.4}
          height={height + 2.4}
          rx={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {selected ? (
        <rect
          className={styles.webPdfDrawingSelectionBox}
          x={minX - 0.9}
          y={minY - 0.9}
          width={width + 1.8}
          height={height + 1.8}
          rx={0.8}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  );
}

function WebPdfPlan({
  uri,
  name,
  cachedPreview,
  previewCacheKey,
  mediaStatus,
  onPreviewReady,
  onRetryMedia,
  pins,
  focusedReserveId,
  canCreate,
  canMovePins,
  canAnnotate,
  annotations,
  placementPreview,
  placementActive,
  createModeActive,
  openPinOnSingleTap,
  onPlacePin,
  onCreateReserveAtPin,
  onPinMove,
  onAnnotationsChange,
  onPinClick,
  onPinOpen,
  onClearFocus,
}: {
  uri: string;
  name: string;
  cachedPreview?: { url: string; width: number; height: number } | null;
  previewCacheKey?: string;
  mediaStatus?: 'empty' | 'idle' | 'resolving' | 'ready' | 'error';
  onPreviewReady?: (preview: PlanPreviewRecord) => void;
  onRetryMedia?: () => void;
  pins: PlanPin[];
  focusedReserveId?: string | null;
  canCreate?: boolean;
  canMovePins?: boolean;
  canAnnotate?: boolean;
  annotations?: PlanDrawing[];
  placementPreview?: PinPlacementPreview | null;
  placementActive?: boolean;
  createModeActive?: boolean;
  openPinOnSingleTap?: boolean;
  onPlacePin?: (x: number, y: number) => void;
  onCreateReserveAtPin?: (x: number, y: number) => void;
  onPinMove?: (reserveId: string, x: number, y: number) => PinMoveResult;
  onAnnotationsChange?: (annotations: PlanDrawing[]) => void;
  onPinClick: (reserveId: string) => void;
  onPinOpen: (reserveId: string) => void;
  onClearFocus?: () => void;
}) {
  const { t } = useWebI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const pdfPageRef = useRef<any>(null);
  const fitModeRef = useRef<PdfZoomMode>('fit');
  const resizeFrameRef = useRef<number | null>(null);
  const lastViewportWidthRef = useRef(0);
  const capturedPreviewKeyRef = useRef('');
  const capturingPreviewKeyRef = useRef('');
  const lastFocusZoomRef = useRef('');
  const drawingPointerRef = useRef<number | null>(null);
  const liveDrawingRef = useRef<PlanDrawing | null>(null);
  const liveDrawingFrameRef = useRef<number | null>(null);
  const pendingAnnotationEchoRef = useRef<PlanDrawing[] | null>(null);
  const movePreviewTimerRef = useRef<number | null>(null);
  const previousFullscreenRef = useRef(false);
  const suppressNextPageClickRef = useRef(false);
  const panStateRef = useRef({
    active: false,
    captured: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    moved: false,
  });
  const [scale, setScale] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [renderReady, setRenderReady] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [pdfPageVersion, setPdfPageVersion] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [drawTool, setDrawTool] = useState<PlanDrawingTool | 'select'>('pen');
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [drawWidth, setDrawWidth] = useState(4);
  const [drawText, setDrawText] = useState('');
  const [liveDrawing, setLiveDrawing] = useState<PlanDrawing | null>(null);
  const [annotationSession, setAnnotationSession] = useState<PlanAnnotationSession>(() => createPlanAnnotationSession(annotations));
  const annotationSessionRef = useRef(annotationSession);
  const [moveMode, setMoveMode] = useState(false);
  const [movePreview, setMovePreview] = useState<PinPlacementPreview | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuId = useId();

  const fitCachedPreviewToViewport = useCallback((width: number, height: number) => {
    if (!width || !height || pdfPageRef.current) return;
    const viewportWidth = viewportRef.current?.clientWidth ?? Math.min(width, 900);
    const availableWidth = Math.max(1, viewportWidth - 32);
    const previewScale = Math.min(1, availableWidth / width);
    setPageSize({ width: width * previewScale, height: height * previewScale });
  }, []);

  const fitPdfToViewport = useCallback(() => {
    const page = pdfPageRef.current;
    if (!page) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const viewportWidth = viewportRef.current?.clientWidth ?? 900;
    const horizontalPadding = viewportRef.current
      ? parseFloat(window.getComputedStyle(viewportRef.current).paddingLeft || '0')
        + parseFloat(window.getComputedStyle(viewportRef.current).paddingRight || '0')
      : 0;
    setScale(calculatePdfFitScale(viewportWidth - horizontalPadding, baseViewport.width));
  }, []);

  const activatePdfFit = useCallback(() => {
    fitModeRef.current = 'fit';
    fitPdfToViewport();
  }, [fitPdfToViewport]);

  useEffect(() => {
    fitModeRef.current = 'fit';
    setScale(null);
    setPageSize({ width: 0, height: 0 });
    setError(false);
    setRenderReady(false);
    setAnnotationMode(false);
    setDrawTool('pen');
    setLiveDrawing(null);
    if (liveDrawingFrameRef.current != null) {
      window.cancelAnimationFrame(liveDrawingFrameRef.current);
      liveDrawingFrameRef.current = null;
    }
    liveDrawingRef.current = null;
    drawingPointerRef.current = null;
    setMoveMode(false);
    setMovePreview(null);
    setActionMenuOpen(false);
    lastFocusZoomRef.current = '';
  }, [uri]);

  useEffect(() => {
    if (!cachedPreview || pdfPageRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      fitCachedPreviewToViewport(cachedPreview.width, cachedPreview.height);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cachedPreview, fitCachedPreviewToViewport, isFullscreen, uri]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;

    lastViewportWidthRef.current = viewport.clientWidth;
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width ?? viewport.clientWidth;
      const previousWidth = lastViewportWidthRef.current;
      lastViewportWidthRef.current = nextWidth;
      if (!shouldRefitPdfOnResize(fitModeRef.current, previousWidth, nextWidth)) return;

      if (resizeFrameRef.current != null) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        if (pdfPageRef.current) {
          fitPdfToViewport();
        } else if (cachedPreview) {
          fitCachedPreviewToViewport(cachedPreview.width, cachedPreview.height);
        }
      });
    });

    observer.observe(viewport);
    return () => {
      observer.disconnect();
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [cachedPreview, fitCachedPreviewToViewport, fitPdfToViewport, isFullscreen, uri]);

  useEffect(() => {
    if (annotations === pendingAnnotationEchoRef.current) {
      pendingAnnotationEchoRef.current = null;
      return;
    }
    const incomingSignature = getCanonicalPlanAnnotationSignature(annotations ?? []);
    const currentSignature = getCanonicalPlanAnnotationSignature(annotationSessionRef.current.drawings);
    if (incomingSignature === currentSignature) {
      pendingAnnotationEchoRef.current = null;
      return;
    }
    const nextSession = createPlanAnnotationSession(sanitizePlanDrawings(annotations ?? []));
    annotationSessionRef.current = nextSession;
    setAnnotationSession(nextSession);
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
    if (previousFullscreenRef.current === isFullscreen) return;
    previousFullscreenRef.current = isFullscreen;
    const focusFrame = window.requestAnimationFrame(() => {
      fullscreenButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [isFullscreen]);

  useEffect(() => {
    if (!actionMenuOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      const actions = document.getElementById(actionMenuId)?.querySelectorAll<HTMLElement>('button, a');
      Array.from(actions ?? []).find(action => action.offsetParent !== null)?.focus();
    });
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) setActionMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setActionMenuOpen(false);
      actionMenuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [actionMenuId, actionMenuOpen]);

  useEffect(() => {
    return () => {
      if (movePreviewTimerRef.current) window.clearTimeout(movePreviewTimerRef.current);
      if (liveDrawingFrameRef.current != null) window.cancelAnimationFrame(liveDrawingFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!focusedReserveId || scale == null) return;
    const key = `${uri}:${focusedReserveId}`;
    if (lastFocusZoomRef.current === key) return;
    lastFocusZoomRef.current = key;
    fitModeRef.current = 'manual';
    setScale(value => {
      const current = value ?? scale ?? 1;
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
    let pdfSession: ReturnType<typeof createDedicatedPdfLoadingTask> | null = null;

    async function loadPdfPage() {
      if (!uri) {
        setLoading(false);
        setError(false);
        return;
      }
      setLoading(true);
      setError(false);
      pdfPageRef.current = null;
      try {
        const pdfjs: any = await loadPdfJs();
        if (cancelled) return;
        pdfSession = createDedicatedPdfLoadingTask(pdfjs, { url: uri });
        const pdf = await pdfSession.loadingTask.promise;
        const page = await pdf.getPage(1);
        if (cancelled) return;
        pdfPageRef.current = page;
        setPdfPageVersion(version => version + 1);
      } catch (pdfError: any) {
        if (cancelled) return;
        console.warn('[web-pdf] plan loading failed', {
          name: pdfError?.name,
          message: pdfError?.message,
        });
        setError(true);
        setLoading(false);
      }
    }

    void loadPdfPage();

    return () => {
      cancelled = true;
      pdfPageRef.current = null;
      renderTaskRef.current?.cancel?.();
      const destroyResult = pdfSession?.destroy();
      if (destroyResult && typeof destroyResult.catch === 'function') {
        void destroyResult.catch(() => undefined);
      }
    };
  }, [retryVersion, uri]);

  useEffect(() => {
    if (!pdfPageRef.current) return;
    if (fitModeRef.current !== 'fit') return;
    const frame = window.requestAnimationFrame(activatePdfFit);
    return () => window.cancelAnimationFrame(frame);
  }, [activatePdfFit, isFullscreen, pdfPageVersion]);

  useEffect(() => {
    const page = pdfPageRef.current;
    if (!page || scale == null || !canvasRef.current) return;
    let cancelled = false;

    async function renderPdfPage() {
      setRenderReady(false);
      setLoading(true);
      setError(false);
      try {
        const previousRenderTask = renderTaskRef.current;
        if (previousRenderTask) {
          previousRenderTask.cancel?.();
          await previousRenderTask.promise?.catch?.(() => undefined);
          if (cancelled) return;
        }

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas PDF indisponible');

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setPageSize({ width: viewport.width, height: viewport.height });

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
        if (!cancelled) {
          renderTaskRef.current = null;
          setRenderReady(true);
          setLoading(false);
          if (
            previewCacheKey
            && capturedPreviewKeyRef.current !== previewCacheKey
            && capturingPreviewKeyRef.current !== previewCacheKey
          ) {
            capturingPreviewKeyRef.current = previewCacheKey;
            void rasterizePlanPreview(canvas).then(preview => {
              if (!cancelled && preview) {
                capturedPreviewKeyRef.current = previewCacheKey;
                onPreviewReady?.(preview);
              }
            }).catch(() => undefined).finally(() => {
              if (capturingPreviewKeyRef.current === previewCacheKey) {
                capturingPreviewKeyRef.current = '';
              }
            });
          }
        }
      } catch (pdfError: any) {
        if (cancelled || pdfError?.name === 'RenderingCancelledException') return;
        console.warn('[web-pdf] plan rendering failed', {
          name: pdfError?.name,
          message: pdfError?.message,
        });
        setError(true);
        setLoading(false);
      }
    }

    void renderPdfPage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
    };
  }, [isFullscreen, onPreviewReady, pdfPageVersion, previewCacheKey, scale]);

  function pagePointFromEvent(event: MouseEvent<HTMLDivElement> | PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Number(clampPercent(((event.clientX - rect.left) / rect.width) * 100).toFixed(2)),
      y: Number(clampPercent(((event.clientY - rect.top) / rect.height) * 100).toFixed(2)),
    };
  }

  function applyAnnotationSession(next: PlanAnnotationSession, persist = false) {
    const previous = annotationSessionRef.current;
    if (next === previous) return;
    annotationSessionRef.current = next;
    setAnnotationSession(next);
    if (persist && next.drawings !== previous.drawings) {
      const persisted = [...next.drawings];
      pendingAnnotationEchoRef.current = persisted;
      onAnnotationsChange?.(persisted);
    }
  }

  function renderLiveDrawingSoon() {
    if (liveDrawingFrameRef.current != null) return;
    liveDrawingFrameRef.current = window.requestAnimationFrame(() => {
      liveDrawingFrameRef.current = null;
      const current = liveDrawingRef.current;
      setLiveDrawing(current ? { ...current, points: [...current.points] } : null);
    });
  }

  function cancelLiveDrawing(event?: PointerEvent<SVGSVGElement>) {
    if (event && drawingPointerRef.current !== event.pointerId) return;
    if (liveDrawingFrameRef.current != null) {
      window.cancelAnimationFrame(liveDrawingFrameRef.current);
      liveDrawingFrameRef.current = null;
    }
    if (event && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    drawingPointerRef.current = null;
    liveDrawingRef.current = null;
    setLiveDrawing(null);
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
      captured: false,
    };
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
      panState.captured = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setIsPanning(true);
    }
    if (!panState.moved) return;
    viewport.scrollLeft = panState.scrollLeft - deltaX;
    viewport.scrollTop = panState.scrollTop - deltaY;
    event.preventDefault();
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
      captured: false,
      pointerId: -1,
      startX: 0,
      startY: 0,
      scrollLeft: 0,
      scrollTop: 0,
      moved: false,
    };
    if (panState.captured) event.currentTarget.releasePointerCapture?.(event.pointerId);
    setIsPanning(false);
  }

  async function handlePageClick(event: MouseEvent<HTMLDivElement>) {
    if (suppressNextPageClickRef.current) {
      suppressNextPageClickRef.current = false;
      return;
    }
    if (annotationMode) return;
    const { x, y } = pagePointFromEvent(event);
    const tapIntent = resolvePlanCanvasTapIntent({
      placementActive: Boolean(placementActive),
      moveMode,
      canMovePins: Boolean(canMovePins),
      focusedReserveId,
      canCreate: Boolean(canCreate),
      createModeActive: Boolean(createModeActive),
    });
    if (tapIntent === 'place-existing-pin') {
      onPlacePin?.(x, y);
      return;
    }
    if (tapIntent === 'move-focused-pin' && focusedReserveId) {
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
    if (tapIntent === 'clear-focus') {
      setMoveMode(false);
      onClearFocus?.();
      return;
    }
    if (tapIntent === 'create-reserve') onCreateReserveAtPin?.(x, y);
  }

  function handleDrawPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!annotationMode || !canAnnotate) return;
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();

    if (drawTool === 'select') {
      const drawingElement = event.target instanceof Element
        ? event.target.closest<SVGGElement>('[data-plan-drawing-id]')
        : null;
      applyAnnotationSession(selectPlanDrawing(annotationSessionRef.current, drawingElement?.dataset.planDrawingId ?? null));
      return;
    }

    if (drawTool === 'text' && !drawText.trim()) return;
    drawingPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pagePointFromEvent(event);
    const started = beginPlanDrawing(annotationSessionRef.current, {
      id: `drawing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tool: drawTool,
      point,
      color: drawColor,
      strokeWidth: drawWidth,
      page: 1,
      text: drawTool === 'text' ? drawText : undefined,
      fontSize: drawTool === 'text' ? 18 : undefined,
      opacity: drawTool === 'highlight' ? 0.28 : undefined,
    });
    liveDrawingRef.current = started.draft ? { ...started.draft, points: [...started.draft.points] } : null;
    setLiveDrawing(liveDrawingRef.current);
  }

  function handleDrawKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    const drawingElement = event.target instanceof Element
      ? event.target.closest<SVGGElement>('[data-plan-drawing-id]')
      : null;
    const drawingId = drawingElement?.dataset.planDrawingId;
    if ((event.key === 'Enter' || event.key === ' ') && drawingId) {
      event.preventDefault();
      applyAnnotationSession(selectPlanDrawing(annotationSessionRef.current, drawingId));
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && drawingId === annotationSessionRef.current.selectedId) {
      event.preventDefault();
      applyAnnotationSession(deletePlanDrawing(annotationSessionRef.current, drawingId), true);
    }
  }

  function handleDrawPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (drawingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    if (!liveDrawingRef.current || liveDrawingRef.current.tool === 'text') return;
    const point = pagePointFromEvent(event);
    const current = liveDrawingRef.current;
    const last = current.points[current.points.length - 1];
    if (last && Math.abs(last.x - point.x) + Math.abs(last.y - point.y) < 0.1) return;
    if (current.tool === 'pen') current.points.push(point);
    else if (current.points.length === 1) current.points.push(point);
    else current.points[1] = point;
    renderLiveDrawingSoon();
  }

  function handleDrawPointerUp(event: PointerEvent<SVGSVGElement>) {
    if (drawingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const completed = liveDrawingRef.current;
    cancelLiveDrawing(event);
    if (!completed) return;
    const next = commitPlanDrawing({ ...annotationSessionRef.current, draft: completed }, {
      text: completed.text,
      fontSize: completed.fontSize,
      opacity: completed.opacity,
    });
    applyAnnotationSession(next, true);
  }

  function undoAnnotation() {
    applyAnnotationSession(undoPlanDrawing(annotationSessionRef.current), true);
  }

  function redoAnnotation() {
    applyAnnotationSession(redoPlanDrawing(annotationSessionRef.current), true);
  }

  function deleteSelectedAnnotation() {
    const selectedId = annotationSessionRef.current.selectedId;
    if (!selectedId) return;
    applyAnnotationSession(deletePlanDrawing(annotationSessionRef.current, selectedId), true);
  }

  function deletePageAnnotations() {
    if (!window.confirm(t('plans.drawingConfirmClearPage'))) return;
    applyAnnotationSession(deletePlanDrawingsForPage(annotationSessionRef.current, WEB_PLAN_DRAWING_PAGE), true);
  }

  function deleteAllAnnotations() {
    if (!window.confirm(t('plans.drawingConfirmClearAll'))) return;
    applyAnnotationSession(clearPlanDrawings(annotationSessionRef.current), true);
  }

  const focusedPin = focusedReserveId ? pins.find(pin => pin.reserve.id === focusedReserveId) : null;
  const activePreview = placementPreview ?? movePreview;
  const pageAnnotations = filterPlanDrawingsByPage(annotationSession.drawings, WEB_PLAN_DRAWING_PAGE);
  const selectedPageAnnotation = pageAnnotations.find(drawing => drawing.id === annotationSession.selectedId) ?? null;
  const zoomReady = !loading && !error && scale != null && pageSize.width > 0 && pageSize.height > 0;
  const zoomLabel = zoomReady && scale != null ? `${Math.round(scale * 100)}%` : '—';

  function retryPdfLoad() {
    fitModeRef.current = 'fit';
    setError(false);
    setPageSize({ width: 0, height: 0 });
    setScale(null);
    setRetryVersion(value => value + 1);
  }

  const pdfShell = (
    <div
      className={`${styles.webPdfShell} ${isFullscreen ? styles.webPdfShellFullscreen : ''}`}
      role={isFullscreen ? 'dialog' : undefined}
      aria-modal={isFullscreen || undefined}
      aria-label={isFullscreen ? name : undefined}
    >
      <div className={styles.webPdfToolbar} data-web-pdf-toolbar role="group" aria-label={t('plans.readerTools')}>
        <div className={styles.webPdfToolbarPrimary} data-web-pdf-primary-actions>
          <div className={styles.webPdfZoomControls}>
            <button
              type="button"
              aria-label={t('plans.zoomOut')}
              disabled={!zoomReady}
              onClick={() => {
                fitModeRef.current = 'manual';
                setScale(value => Math.max(0.08, Number(((value ?? 1) - 0.1).toFixed(2))));
              }}
            >−</button>
            <strong aria-live="polite" aria-label={t('plans.zoomLevel')}>{zoomLabel}</strong>
            <button
              type="button"
              aria-label={t('plans.zoomIn')}
              disabled={!zoomReady}
              onClick={() => {
                fitModeRef.current = 'manual';
                setScale(value => Math.min(3, Number(((value ?? 1) + 0.1).toFixed(2))));
              }}
            >+</button>
          </div>
          <button type="button" disabled={!zoomReady} onClick={activatePdfFit} aria-label={t('plans.fit')}>
            <span className={styles.webPdfToolbarIcon} aria-hidden="true">↔</span>
            <span className={styles.webPdfToolbarLabel}>{t('plans.fit')}</span>
          </button>
          <button
            ref={fullscreenButtonRef}
            type="button"
            onClick={() => {
              setActionMenuOpen(false);
              setIsFullscreen(value => !value);
            }}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? t('plans.reduce') : t('plans.bigPlan')}
          >
            <span className={styles.webPdfToolbarIcon} aria-hidden="true">⛶</span>
            <span className={styles.webPdfToolbarLabel}>{isFullscreen ? t('plans.reduce') : t('plans.bigPlan')}</span>
          </button>
          {canMovePins && focusedPin && (
            <button
              type="button"
              className={`${styles.webPdfToolbarDesktopAction} ${moveMode ? styles.webPdfToolbarActive : ''}`}
              aria-pressed={moveMode}
              onClick={() => {
                setMoveMode(value => !value);
                setAnnotationMode(false);
              }}
            >
              {moveMode ? t('plans.choosePinPosition') : t('plans.movePin')}
            </button>
          )}
          {canAnnotate && (
            <button
              type="button"
              className={`${styles.webPdfToolbarDesktopAction} ${annotationMode ? styles.webPdfToolbarActive : ''}`}
              aria-pressed={annotationMode}
              aria-controls={annotationMode ? `${actionMenuId}-drawing` : undefined}
              onClick={() => {
                setAnnotationMode(value => !value);
                setMoveMode(false);
              }}
            >
              {t('plans.drawing')}
            </button>
          )}
          {uri ? (
            <a className={styles.webPdfToolbarDesktopAction} href={uri} target="_blank" rel="noreferrer">
              {t('plans.openPdf')} <span className={styles.srOnly}>({t('plans.newTab')})</span>
            </a>
          ) : null}
        </div>
        {(uri || canAnnotate || (canMovePins && focusedPin)) && (
          <div ref={actionMenuRef} className={styles.webPdfActionMenu}>
            <button
              ref={actionMenuButtonRef}
              type="button"
              className={styles.webPdfActionMenuButton}
              aria-expanded={actionMenuOpen}
              aria-controls={actionMenuId}
              aria-haspopup="true"
              onClick={() => setActionMenuOpen(value => !value)}
            >
              <span aria-hidden="true">•••</span>
              <span className={styles.webPdfToolbarLabel}>{t('plans.moreActions')}</span>
            </button>
            {actionMenuOpen && (
              <div id={actionMenuId} className={styles.webPdfActionMenuPopover} role="group" aria-label={t('plans.moreActions')}>
                {canMovePins && focusedPin && (
                  <button
                    type="button"
                    className={`${styles.webPdfActionMenuCompactOnly} ${moveMode ? styles.webPdfToolbarActive : ''}`}
                    aria-pressed={moveMode}
                    onClick={() => {
                      setMoveMode(value => !value);
                      setAnnotationMode(false);
                      setActionMenuOpen(false);
                    }}
                  >
                    {moveMode ? t('plans.choosePinPosition') : t('plans.movePin')}
                  </button>
                )}
                {canAnnotate && (
                  <button
                    type="button"
                    className={`${styles.webPdfActionMenuCompactOnly} ${annotationMode ? styles.webPdfToolbarActive : ''}`}
                    aria-pressed={annotationMode}
                    aria-controls={annotationMode ? `${actionMenuId}-drawing` : undefined}
                    onClick={() => {
                      setAnnotationMode(value => !value);
                      setMoveMode(false);
                      setActionMenuOpen(false);
                    }}
                  >
                    {t('plans.drawing')}
                  </button>
                )}
                {uri ? (
                  <a className={styles.webPdfActionMenuCompactOnly} href={uri} target="_blank" rel="noreferrer" onClick={() => setActionMenuOpen(false)}>
                    {t('plans.openPdf')} <span className={styles.srOnly}>({t('plans.newTab')})</span>
                  </a>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
      {canAnnotate && annotationMode && (
        <div
          id={`${actionMenuId}-drawing`}
          className={styles.webPdfAnnotateControls}
          role="region"
          aria-label={t('plans.drawingTools')}
        >
          <div className={styles.webPdfDrawingToolRail} role="toolbar" aria-label={t('plans.drawingTools')}>
            <button
              type="button"
              data-drawing-tool="select"
              aria-pressed={drawTool === 'select'}
              className={drawTool === 'select' ? styles.webPdfToolbarActive : ''}
              onClick={() => setDrawTool('select')}
            >
              {t('plans.drawingSelect')}
            </button>
            {PLAN_DRAWING_TOOLS.map(tool => (
              <button
                key={tool}
                type="button"
                data-drawing-tool={tool}
                aria-pressed={drawTool === tool}
                className={drawTool === tool ? styles.webPdfToolbarActive : ''}
                onClick={() => setDrawTool(tool)}
              >
                {t(`plans.drawingTool.${tool}`)}
              </button>
            ))}
          </div>
          <div className={styles.webPdfDrawingOptions}>
            <div className={styles.webPdfDrawingOptionGroup} role="group" aria-label={t('plans.drawingColor')}>
              {WEB_PLAN_DRAWING_COLORS.map(color => (
                <button
                  key={color.value}
                  type="button"
                  className={drawColor === color.value ? styles.webPdfColorButtonActive : styles.webPdfColorButton}
                  style={{ background: color.value }}
                  onClick={() => setDrawColor(color.value)}
                  aria-label={t(color.labelKey)}
                  aria-pressed={drawColor === color.value}
                />
              ))}
            </div>
            <div className={styles.webPdfDrawingOptionGroup} role="group" aria-label={t('plans.drawingWidth')}>
              {[1, 4, 8, 14].map(width => (
                <button
                  key={width}
                  type="button"
                  className={`${styles.webPdfWidthButton} ${drawWidth === width ? styles.webPdfToolbarActive : ''}`}
                  onClick={() => setDrawWidth(width)}
                  aria-label={t('plans.drawingWidthValue', { width })}
                  aria-pressed={drawWidth === width}
                >
                  {width}
                </button>
              ))}
            </div>
            {drawTool === 'text' ? (
              <label className={styles.webPdfDrawingTextField}>
                <span>{t('plans.drawingText')}</span>
                <input
                  value={drawText}
                  maxLength={80}
                  onChange={event => setDrawText(event.target.value)}
                  placeholder={t('plans.drawingTextPlaceholder')}
                />
              </label>
            ) : null}
          </div>
          <div className={styles.webPdfDrawingActions} role="group" aria-label={t('plans.drawingActions')}>
            <button type="button" disabled={!canUndoPlanDrawing(annotationSession)} onClick={undoAnnotation}>
              {t('plans.drawingUndo')}
            </button>
            <button type="button" disabled={!canRedoPlanDrawing(annotationSession)} onClick={redoAnnotation}>
              {t('plans.drawingRedo')}
            </button>
            <button type="button" disabled={!selectedPageAnnotation} onClick={deleteSelectedAnnotation}>
              {t('plans.drawingDeleteObject')}
            </button>
            <button type="button" disabled={pageAnnotations.length === 0} onClick={deletePageAnnotations}>
              {t('plans.drawingDeletePage')}
            </button>
            <button type="button" disabled={annotationSession.drawings.length === 0} onClick={deleteAllAnnotations}>
              {t('plans.drawingDeleteAll')}
            </button>
          </div>
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
        data-web-pdf-viewport
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
          data-plan-render-state={renderReady ? 'ready' : cachedPreview ? 'preview' : 'loading'}
        >
          {cachedPreview && !renderReady ? (
            <img
              className={styles.webPdfCachedPreview}
              src={cachedPreview.url}
              alt={`Aperçu hors ligne du plan ${name}`}
              data-plan-preview-source="cache"
            />
          ) : null}
          <canvas ref={canvasRef} className={styles.webPdfCanvas} data-visible={renderReady ? 'true' : 'false'} />
          {(loading || (!uri && mediaStatus === 'resolving')) && !cachedPreview && (
            <div className={styles.webPdfLoading} role="status" aria-live="polite">
              <span className={styles.webPdfLoadingSpinner} aria-hidden="true" />
              <strong>{t('plans.loadingPdf')}</strong>
            </div>
          )}
          {cachedPreview && !renderReady && mediaStatus !== 'ready' ? (
            <div className={styles.webPdfPreviewBadge} role="status">
              {mediaStatus === 'error' ? 'Aperçu hors ligne' : 'Aperçu instantané · synchronisation du plan'}
            </div>
          ) : null}
          {(error || (!uri && mediaStatus === 'error')) && !cachedPreview && (
            <div className={styles.webPdfError} role="alert" aria-live="assertive">
              <div className={styles.webPdfErrorContent}>
                <span className={styles.webPdfErrorIcon} aria-hidden="true">!</span>
                <strong>{t('plans.pdfUnavailable')}</strong>
                <span>{t('plans.pdfUnavailableBody')}</span>
                <button type="button" onClick={onRetryMedia ?? retryPdfLoad}>{t('plans.retry')}</button>
              </div>
            </div>
          )}
          <svg
            className={`${styles.webPdfAnnotationLayer} ${annotationMode ? styles.webPdfAnnotationLayerActive : ''}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            onPointerDown={handleDrawPointerDown}
            onPointerMove={handleDrawPointerMove}
            onPointerUp={handleDrawPointerUp}
            onPointerCancel={cancelLiveDrawing}
            onKeyDown={handleDrawKeyDown}
            aria-label={t('plans.drawingCanvas')}
          >
            {pageAnnotations.map((drawing, index) => renderWebPlanDrawing(
              drawing,
              drawing.id ?? `drawing-${index}`,
              drawing.id === annotationSession.selectedId,
              annotationMode && drawTool === 'select',
              `${t('plans.drawing')} · ${t(`plans.drawingTool.${drawing.tool}`)}`,
            ))}
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
              style={{ left: `${pin.x}%`, top: `${pin.y}%`, '--plan-pin-color': pin.color, '--plan-pin-foreground': pin.textColor } as CSSProperties}
              title={openPinOnSingleTap ? `${pin.reserve.title} · ouvrir la réserve` : `${pin.reserve.title} · double-clic pour ouvrir la réserve`}
              aria-label={openPinOnSingleTap ? `Ouvrir la réserve de l'épingle ${pin.number}.` : `Sélectionner l'épingle ${pin.number}. Double-clic pour ouvrir la réserve.`}
              onClick={event => {
                event.stopPropagation();
                onPinClick(pin.reserve.id);
                if (openPinOnSingleTap) onPinOpen(pin.reserve.id);
              }}
              onDoubleClick={event => {
                event.stopPropagation();
                if (!openPinOnSingleTap) onPinOpen(pin.reserve.id);
              }}
            >
              <span>{pin.number}</span>
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
  authUserId,
  plans,
  reserves,
  companies,
  projects,
  selectedProject,
  selectedProjectId,
  selectedPlan,
  setSelectedPlanId,
  onOpenReserve,
  placementReserve,
  onPlacementDone,
  onCreateReserve,
  onCreateReserveAtPin,
  onMoveReservePin,
  onUpdatePlanAnnotations,
  onCreatePlan,
  onUpdatePlan,
  onDeletePlanFile,
  onDeletePlan,
  onCreateRevision,
  onGeneratePlansPdf,
  generatingReport,
  defaultReportLanguage,
  onReportLanguageChange,
  editable,
  canCreatePlan,
  canDeletePlan,
  canMovePlanPins,
  canExportReports,
  saving,
}: any) {
  const { lang, locale, t } = useWebI18n();
  const workspaceCopy = PLAN_RESERVE_WORKSPACE_COPY[lang].plans;
  const planWorkspace = useResponsiveWorkspaceNavigation({
    hasDetail: Boolean(selectedPlan),
    forceDetailOpen: Boolean(placementReserve && selectedPlan),
  });
  const isCompactPlanView = planWorkspace.isCompact;
  const mobilePlanOpen = planWorkspace.detailOpen;
  const [buildingQuery, setBuildingQuery] = useState('');
  const [selectedBuildingKey, setSelectedBuildingKey] = useState('all');
  const [activeFamilyKey, setActiveFamilyKey] = useState('all');
  const [buildingFamilyMenuOpen, setBuildingFamilyMenuOpen] = useState(false);
  const [buildingFamilyMenuQuery, setBuildingFamilyMenuQuery] = useState('');
  const [expandedBuildingKeys, setExpandedBuildingKeys] = useState<Set<string>>(() => new Set());
  const [compactExpandedBuildingKey, setCompactExpandedBuildingKey] = useState<string | null>(null);
  const [mobileBuildingLimit, setMobileBuildingLimit] = useState(WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE);
  const [recentBuildingKeys, setRecentBuildingKeys] = useState<string[]>(() => readStoredStringList(WEB_RECENT_BUILDINGS_KEY));
  const [selectedPlanReserveId, setSelectedPlanReserveId] = useState<string | null>(null);
  const [planReservePanelOpen, setPlanReservePanelOpen] = useState(false);
  const [planReserveNavigatorState, setPlanReserveNavigatorState] = useState(() => createPlanReserveNavigatorState('none'));
  const [focusedPlanReserveId, setFocusedPlanReserveId] = useState<string | null>(null);
  const planReservePanelId = useId();
  const planReserveHeadingId = useId();
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
  const [planModalMode, setPlanModalMode] = useState<'create' | 'edit' | 'revision' | null>(null);
  const [planDraft, setPlanDraft] = useState<any>({});
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [migrateRevisionReserves, setMigrateRevisionReserves] = useState(true);
  const [planActionMessage, setPlanActionMessage] = useState('');
  const [planActionsOpen, setPlanActionsOpen] = useState(false);
  const [pinCreateMode, setPinCreateMode] = useState(false);
  const [cachedPlanPreview, setCachedPlanPreview] = useState<{
    ownerId: string;
    key: string;
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const activePreviewOwnerRef = useRef(authUserId);
  activePreviewOwnerRef.current = authUserId;
  const pinPlacementTimerRef = useRef<number | null>(null);
  const planCanCreate = Boolean(canCreatePlan ?? editable);
  const planCanDelete = Boolean(canDeletePlan);
  const planCanMovePins = Boolean(canMovePlanPins ?? editable);
  const planCanExport = Boolean(canExportReports);
  const hasPlanActions = planCanCreate || planCanDelete;

  useEffect(() => {
    if (!isCompactPlanView || mobilePlanOpen || plans.length === 0) return;
    return warmPdfJsWhenIdle();
  }, [isCompactPlanView, mobilePlanOpen, plans.length]);

  useEffect(() => {
    setMobileBuildingLimit(WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE);
    setCompactExpandedBuildingKey(null);
    setSelectedBuildingKey('all');
    setBuildingQuery('');
    setActiveFamilyKey('all');
    setBuildingFamilyMenuOpen(false);
    setBuildingFamilyMenuQuery('');
  }, [selectedProjectId]);

  const projectForDraft = projects.find((project: any) => project.id === (planDraft.chantier_id || selectedProjectId)) ?? selectedProject ?? projects[0] ?? null;
  const draftBuildings = projectBuildings(projectForDraft);
  const draftBuilding = draftBuildings.find((building: any) => building.id === planDraft.building_id) ?? null;
  const draftLevels = Array.isArray(draftBuilding?.levels) ? draftBuilding.levels : [];
  const selectedPlanMediaSource = planWorkspace.shouldLoadDetailMedia
    ? String(selectedPlan?.uri ?? selectedPlan?.url ?? '').trim()
    : '';
  const selectedPlanMedia = usePrivateMediaAccess(selectedPlanMediaSource, { priority: 'critical' });
  const selectedPlanResolvedUri = selectedPlanMedia.url;
  const selectedPlanPreviewKey = selectedPlan
    ? [selectedPlan.id, selectedPlan.revision_code ?? selectedPlan.revisionCode ?? '', selectedPlanMediaSource].join(':')
    : '';
  const activeCachedPlanPreview = cachedPlanPreview && cachedPlanPreview.ownerId === authUserId
    && cachedPlanPreview.key === selectedPlanPreviewKey
    ? cachedPlanPreview
    : null;

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setCachedPlanPreview(null);
    if (!authUserId || !selectedPlanPreviewKey || selectedPlan?.file_type !== 'pdf') return;
    void readPlanPreview({ userId: authUserId, planKey: selectedPlanPreviewKey }).then(preview => {
      if (cancelled || !preview) return;
      objectUrl = URL.createObjectURL(preview.blob);
      setCachedPlanPreview({ ownerId: authUserId, key: selectedPlanPreviewKey, url: objectUrl, width: preview.width, height: preview.height });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authUserId, selectedPlan?.file_type, selectedPlanPreviewKey]);

  const cacheSelectedPlanPreview = useCallback((preview: PlanPreviewRecord) => {
    if (!authUserId || activePreviewOwnerRef.current !== authUserId || !selectedPlanPreviewKey) return;
    void writePlanPreview({
      userId: authUserId,
      planKey: selectedPlanPreviewKey,
      ...preview,
    });
  }, [authUserId, selectedPlanPreviewKey]);

  function makePlanDraft(mode: 'create' | 'edit' | 'revision', plan?: any) {
    const baseProjectId = plan?.chantier_id ?? plan?.chantierId ?? (selectedProjectId !== 'all' ? selectedProjectId : selectedProject?.id ?? projects[0]?.id ?? '');
    const baseName = mode === 'create'
      ? ''
      : mode === 'revision'
        ? String(plan?.name ?? '')
        : String(plan?.name ?? '');
    return {
      id: mode === 'edit' ? plan?.id : undefined,
      chantier_id: baseProjectId,
      name: baseName,
      building: String(plan?.building ?? '').trim(),
      level: String(plan?.level ?? '').trim(),
      building_id: plan?.building_id ?? plan?.buildingId ?? '',
      level_id: plan?.level_id ?? plan?.levelId ?? '',
      revision_code: mode === 'revision' ? '' : String(plan?.revision_code ?? '').trim(),
      revision_note: mode === 'revision' ? '' : String(plan?.revision_note ?? '').trim(),
    };
  }

  function openPlanModal(mode: 'create' | 'edit' | 'revision', plan?: any) {
    setPlanDraft(makePlanDraft(mode, plan ?? selectedPlan));
    setPlanFile(null);
    setMigrateRevisionReserves(true);
    setPlanActionMessage('');
    setPlanModalMode(mode);
  }

  function updatePlanDraftProject(projectId: string) {
    const project = projects.find((item: any) => item.id === projectId);
    const buildings = projectBuildings(project);
    const firstBuilding = buildings[0] ?? null;
    const firstLevel = firstBuilding?.levels?.[0] ?? null;
    setPlanDraft((prev: any) => ({
      ...prev,
      chantier_id: projectId,
      building_id: firstBuilding?.id ?? '',
      building: firstBuilding?.name ?? '',
      level_id: firstLevel?.id ?? '',
      level: firstLevel?.name ?? '',
    }));
  }

  function updatePlanDraftBuilding(buildingId: string) {
    const building = draftBuildings.find((item: any) => item.id === buildingId);
    const firstLevel = building?.levels?.[0] ?? null;
    setPlanDraft((prev: any) => ({
      ...prev,
      building_id: building?.id ?? '',
      building: building?.name ?? '',
      level_id: firstLevel?.id ?? '',
      level: firstLevel?.name ?? '',
    }));
  }

  function updatePlanDraftLevel(levelId: string) {
    const level = draftLevels.find((item: any) => item.id === levelId);
    setPlanDraft((prev: any) => ({
      ...prev,
      level_id: level?.id ?? '',
      level: level?.name ?? '',
    }));
  }

  async function submitPlanModal(event: React.FormEvent) {
    event.preventDefault();
    if (!planModalMode) return;
    if (!planCanCreate) return;
    const patch = {
      chantier_id: planDraft.chantier_id,
      name: String(planDraft.name ?? '').trim(),
      building: String(planDraft.building ?? '').trim() || null,
      level: String(planDraft.level ?? '').trim() || null,
      building_id: planDraft.building_id || null,
      level_id: planDraft.level_id || null,
      revision_code: String(planDraft.revision_code ?? '').trim() || null,
      revision_note: String(planDraft.revision_note ?? '').trim() || null,
    };
    let result: any = null;
    if (planModalMode === 'create') {
      result = await onCreatePlan?.(patch, planFile);
    } else if (planModalMode === 'edit' && selectedPlan) {
      result = await onUpdatePlan?.(selectedPlan, patch, planFile);
    } else if (planModalMode === 'revision' && selectedPlan) {
      result = await onCreateRevision?.(selectedPlan, patch, planFile, migrateRevisionReserves);
      if (result?.migratedCount != null) {
        setPlanActionMessage(`${result.migratedCount} réserve(s) migrée(s) vers la nouvelle révision.`);
      }
    }
    if (result && planModalMode !== 'revision') {
      setPlanModalMode(null);
    } else if (result?.plan) {
      window.setTimeout(() => setPlanModalMode(null), 700);
    }
  }

  async function handleDeleteSelectedPlanFile() {
    if (!planCanDelete || !selectedPlan?.uri) return;
    const confirmed = window.confirm(`Supprimer le fichier du plan "${selectedPlan.name}" ? Le plan restera dans la liste.`);
    if (!confirmed) return;
    await onDeletePlanFile?.(selectedPlan);
  }
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
  const planReserveNavigatorScopeKey = selectedPlan ? String(selectedPlan.id) : 'none';
  const syncedPlanReserveNavigatorState = syncPlanReserveNavigatorScope(
    planReserveNavigatorState,
    planReserveNavigatorScopeKey,
  );
  const planReserveNavigator = useMemo(
    () => buildPlanReserveNavigatorModel(displayPlanReserves, syncedPlanReserveNavigatorState, {
      compact: isCompactPlanView,
      selectedId: selectedPlanReserveId,
      getNumber: reserve => getPlanPinNumber(planPinNumberMap, reserve),
    }),
    [
      displayPlanReserves,
      isCompactPlanView,
      planPinNumberMap,
      selectedPlanReserveId,
      syncedPlanReserveNavigatorState,
    ],
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
  const planLibrary = useMemo(
    () => buildPlanLibraryModel(plans, reserves, locale),
    [locale, plans, reserves],
  );
  const buildingGroups = planLibrary.groups;
  const buildingFamilies = planLibrary;
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
    const activeFamilyUnavailable = activeFamilyKey !== 'all' && (
      !buildingFamilies.useGrouping
      || !buildingFamilies.families.some(family => family.key === activeFamilyKey)
    );
    if (activeFamilyUnavailable) {
      setActiveFamilyKey('all');
      setMobileBuildingLimit(WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE);
      setCompactExpandedBuildingKey(null);
    }
  }, [activeFamilyKey, buildingFamilies]);
  useEffect(() => {
    if (buildingQuery.trim() || !buildingFamilies.useGrouping) {
      setBuildingFamilyMenuOpen(false);
      setBuildingFamilyMenuQuery('');
    }
  }, [buildingFamilies.useGrouping, buildingQuery]);
  const handleBuildingQueryChange = (value: string) => {
    setBuildingQuery(value);
    setMobileBuildingLimit(WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE);
    setCompactExpandedBuildingKey(null);
  };
  const handleSelectBuildingFamily = (key: string) => {
    setActiveFamilyKey(key);
    setBuildingFamilyMenuOpen(false);
    setBuildingFamilyMenuQuery('');
    setMobileBuildingLimit(WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE);
    setCompactExpandedBuildingKey(null);
  };
  const filteredBuildingGroups = useMemo(
    () => filterPlanLibraryGroups(planLibrary, buildingQuery, activeFamilyKey),
    [activeFamilyKey, buildingQuery, planLibrary],
  );
  const totalReserveCount = planLibrary.reserveCount;
  const hasBuildingSearch = Boolean(buildingQuery.trim());
  const recentBuildingGroups = recentBuildingKeys
    .map(key => buildingGroups.find(group => group.key === key))
    .filter(Boolean)
    .slice(0, 3) as typeof buildingGroups;
  const hasBuildingFamilyFilter = buildingFamilies.useGrouping && activeFamilyKey !== 'all';
  const showCompactRecentRail = isCompactPlanView && !hasBuildingSearch && !hasBuildingFamilyFilter;
  const compactSelectedBuildingKey = compactExpandedBuildingKey
    ? (selectedPlanBuildingKey === 'all' ? null : selectedPlanBuildingKey)
    : selectedBuildingKey !== 'all'
      ? selectedBuildingKey
      : (selectedPlanBuildingKey === 'all' ? null : selectedPlanBuildingKey);
  const compactBuildingOrder = useMemo(() => orderCompactBuildingGroups(
    filteredBuildingGroups,
    {
      selectedKey: compactSelectedBuildingKey,
      expandedKey: compactExpandedBuildingKey,
      recentKeys: recentBuildingKeys.slice(0, 3),
      showRecentRail: showCompactRecentRail,
    },
  ), [
    compactExpandedBuildingKey,
    compactSelectedBuildingKey,
    filteredBuildingGroups,
    recentBuildingKeys,
    showCompactRecentRail,
  ]);
  const compactBuildingBatch = takeCompactBuildingBatch(
    compactBuildingOrder.mainGroups,
    compactBuildingOrder.recentGroups.length,
    mobileBuildingLimit,
  );
  const visibleBuildingGroups = isCompactPlanView
    ? compactBuildingBatch.visibleMainGroups
    : filteredBuildingGroups;
  const visibleBuildingCount = isCompactPlanView
    ? compactBuildingBatch.visibleCount
    : filteredBuildingGroups.length;
  const hiddenBuildingGroupCount = isCompactPlanView
    ? compactBuildingBatch.hiddenCount
    : 0;
  const displayedRecentBuildingGroups = isCompactPlanView
    ? compactBuildingOrder.recentGroups
    : recentBuildingGroups;
  useEffect(() => {
    setSelectedPlanReserveId(null);
    setPlanReservePanelOpen(false);
    setFocusedPlanReserveId(null);
    setPinPlacementPreview(null);
    setPlanActionsOpen(false);
    setPinCreateMode(false);
  }, [selectedPlan?.id]);
  useEffect(() => {
    setPlanReserveNavigatorState(previous => syncPlanReserveNavigatorScope(
      previous,
      planReserveNavigatorScopeKey,
    ));
  }, [planReserveNavigatorScopeKey]);
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
  const openPlanFromNavigator = (planId: string) => {
    setSelectedPlanId(planId);
    if (isCompactPlanView) planWorkspace.openDetail();
  };
  const handleSelectBuildingGroup = (group: { key: string; plans: any[]; displayPlans?: any[] }) => {
    if (isCompactPlanView) {
      const nextExpandedKey = toggleCompactBuildingKey(compactExpandedBuildingKey, group.key);
      setCompactExpandedBuildingKey(nextExpandedKey);
      setSelectedBuildingKey(nextExpandedKey ?? 'all');
      return;
    }

    rememberBuildingGroup(group.key);
    setSelectedBuildingKey(group.key);
    setExpandedBuildingKeys(prev => {
      const next = new Set(prev);
      next.add(group.key);
      return next;
    });
    const sourcePlans = group.displayPlans?.length ? group.displayPlans : group.plans;
    if (!sourcePlans.some(plan => plan.id === selectedPlan?.id) && sourcePlans[0]) {
      openPlanFromNavigator(String(sourcePlans[0].id));
    }
  };
  const openReserveFromPin = (reserveId: string) => {
    onOpenReserve(reserveId);
  };
  const assignOrCreatePinAt = (x: number, y: number) => {
    if (!selectedPlan) return;
    setPinCreateMode(false);
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
    if (!planCanCreate) return;
    pinPlacementTimerRef.current = window.setTimeout(() => {
      setPinPlacementPreview(null);
      onCreateReserveAtPin(selectedPlan, { planId: selectedPlan.id, x: nextX, y: nextY });
    }, 520);
  };
  // Mode « placement » : localiser une réserve EXISTANTE sans épingle. Un clic
  // sur le plan pose sa pastille (aperçu bref, puis enregistrement via
  // onMoveReservePin qui écrit plan_id/plan_x/plan_y).
  const placementActive = Boolean(placementReserve && planCanMovePins && selectedPlan);
  const placeExistingPinAt = (x: number, y: number) => {
    if (!selectedPlan || !placementReserve) return;
    const nextX = Number(clampPercent(x).toFixed(2));
    const nextY = Number(clampPercent(y).toFixed(2));
    const preview: PinPlacementPreview = {
      id: `place-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      planId: selectedPlan.id,
      x: nextX,
      y: nextY,
      label: 'Pastille placée',
    };
    setPinPlacementPreview(preview);
    if (pinPlacementTimerRef.current) window.clearTimeout(pinPlacementTimerRef.current);
    const target = placementReserve;
    const targetPlan = selectedPlan;
    pinPlacementTimerRef.current = window.setTimeout(async () => {
      setPinPlacementPreview(null);
      // On sort du mode placement AVANT l'enregistrement async : un nouveau clic
      // pendant la sauvegarde ne peut donc pas relancer un second write. En cas
      // d'échec, moveReservePinWeb annule l'optimistic update et affiche l'erreur
      // (la réserve reste sans épingle, l'utilisateur peut relancer le flux).
      onPlacementDone?.();
      const ok = await onMoveReservePin?.(target, targetPlan, nextX, nextY);
      if (ok !== false) {
        setFocusedPlanReserveId(target.id);
        setSelectedPlanReserveId(target.id);
      }
    }, 450);
  };
  const planPins = displayPlanReserves
    .map((reserve: any) => {
      const rawX = Number(reserve.plan_x);
      const rawY = Number(reserve.plan_y);
      const color = getReservePinColor(reserve, companies ?? []);
      // Historical web pins could be saved as 0..1. Mobile pins are 0..100.
      const ratioMode = Number.isFinite(rawX) && Number.isFinite(rawY) && Math.abs(rawX) <= 1 && Math.abs(rawY) <= 1;
      return {
        reserve,
        number: getPlanPinNumber(planPinNumberMap, reserve) ?? 0,
        x: planCoordinateToPercent(reserve.plan_x, ratioMode),
        y: planCoordinateToPercent(reserve.plan_y, ratioMode),
        color,
        textColor: getPlanReserveMarkerTextColor(color),
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
    if (!planCanExport) return;
    if (plansPdfBusy || plansPdfTargetReserves.length === 0) return;
    await onGeneratePlansPdf(
      plansPdfTargetPlans,
      plansPdfTargetReserves,
      plansPdfLanguage,
      plansPdfCompanyLabel,
      plansPdfStatusLabel,
    );
  }

  function selectPlanReserve(reserveId: string) {
    setSelectedPlanReserveId(reserveId);
    setFocusedPlanReserveId(reserveId);
  }

  function clearPlanReserveSelection() {
    setSelectedPlanReserveId(null);
    setFocusedPlanReserveId(null);
  }

  function revealPlanReserveOnCanvas(reserveId: string) {
    selectPlanReserve(reserveId);
    if (!isCompactPlanView || typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const canvas = document.querySelector<HTMLElement>('[data-prw-plan-canvas]');
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      canvas?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    });
  }

  function getPlanReserveOperationalMeta(reserve: any) {
    const context = [
      reserveCompanies(reserve)[0] ?? reserve.company_name,
      reserve.zone ?? reserve.level,
      reserve.priority ? (PRIORITY_LABELS[reserve.priority] ?? reserve.priority) : null,
      reserve.deadline ? prettyDate(reserve.deadline) : null,
    ].filter(Boolean);
    return context.length > 0
      ? context.join(' · ')
      : (STATUS_LABELS[reserve.status] ?? reserve.status);
  }

  function renderPlanReserveQuickCard(reserve: any) {
    const markerColor = getReservePinColor(reserve, companies ?? []);
    return (
      <div className={styles.planReserveQuickCard} data-prw-plan-reserve-quick-card>
        <div className={styles.planReserveQuickHeader}>
          <span
            className={styles.planReserveNumber}
            style={{ background: markerColor, color: getPlanReserveMarkerTextColor(markerColor) }}
          >
            {getPlanPinNumber(planPinNumberMap, reserve) ?? '—'}
          </span>
          <div>
            <strong>{reserve.title}</strong>
            <small>{getPlanReserveOperationalMeta(reserve)}</small>
          </div>
          <button type="button" onClick={clearPlanReserveSelection} aria-label={t('plans.closeReservePreview')}>
            ×
          </button>
        </div>
        {reserve.description && <p>{reserve.description}</p>}
        <div className={styles.planReserveQuickActions}>
          <button type="button" onClick={() => onOpenReserve(reserve.id)}>
            {t('plans.openReserve')}
          </button>
          <button
            type="button"
            disabled={reserve.plan_x == null || reserve.plan_y == null}
            onClick={() => revealPlanReserveOnCanvas(reserve.id)}
          >
            {reserve.plan_x == null || reserve.plan_y == null
              ? t('plans.noPin')
              : t('plans.centerReserveOnPlan')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.twoCols} ${styles.plansLayout} ${workspaceStyles.planRoot}`}
      data-testid="web-plans-workspace"
    >
      <WorkspacePageHeader
        eyebrow={workspaceCopy.eyebrow}
        title={workspaceCopy.title}
        description={workspaceCopy.description}
        metrics={[
          { label: workspaceCopy.plans, value: planLibrary.planCount, tone: 'blue' },
          { label: workspaceCopy.buildings, value: planLibrary.groups.length, tone: 'orange' },
          { label: workspaceCopy.pins, value: planLibrary.pinnedCount, tone: 'green' },
        ]}
        actions={planCanCreate ? (
          <button type="button" data-primary="true" onClick={() => openPlanModal('create')}>
            <WorkspaceIcon name="plus" size={19} />
            <span>{workspaceCopy.newPlan}</span>
          </button>
        ) : null}
        compactDetail={isCompactPlanView && mobilePlanOpen}
      />
      {planWorkspace.showList && (
      <section className={`${styles.panel} ${styles.plansListPanel}`} data-prw-panel data-prw-plan-nav>
        <div className={styles.buildingRailHeaderWeb} data-prw-plan-nav-header>
          <div>
            <span>{t('plans.buildings')}</span>
            <strong>{buildingGroups.length}</strong>
          </div>
          <small>{t('plans.groupedHint')}</small>
        </div>
        <div className={styles.buildingRailStickyWeb} data-prw-plan-nav-sticky>
          <WorkspaceSearch
            value={buildingQuery}
            onChange={handleBuildingQueryChange}
            placeholder={t('plans.searchPlaceholder')}
            clearLabel={t('common.clearSearch')}
          />
        {buildingFamilies.useGrouping && !hasBuildingSearch && (
          <div className={styles.buildingFamilyToolbarWeb} data-prw-family-toolbar>
            <div className={styles.buildingFamilyRowWeb} data-prw-family-row>
              {primaryBuildingFamilyOptions.map(option => (
                <button
                  key={option.key}
                  type="button"
                  className={activeFamilyKey === option.key ? styles.buildingFamilyActiveWeb : ''}
                  data-active={activeFamilyKey === option.key}
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
        </div>
        <button
          type="button"
          className={`${styles.buildingAllRowWeb} ${selectedBuildingKey === 'all' ? styles.buildingGroupActiveWeb : ''}`}
          data-prw-all-buildings
          data-selected={selectedBuildingKey === 'all'}
          onClick={() => {
            setSelectedBuildingKey('all');
            setCompactExpandedBuildingKey(null);
          }}
        >
          <span><WorkspaceIcon name="building" size={19} /></span>
          <strong>{t('plans.allBuildings')}</strong>
          <small>{t('plans.plansCount', { count: plans.length })} · {t('plans.reservesCount', { count: totalReserveCount })}</small>
        </button>
        <p className={styles.buildingResultCountWeb} role="status" aria-live="polite" data-prw-building-result-count>
          {isCompactPlanView && visibleBuildingCount < filteredBuildingGroups.length ? (
            t('plans.shownOfBuildings', { visible: visibleBuildingCount, total: filteredBuildingGroups.length })
          ) : (
            filteredBuildingGroups.length === 1
              ? t('plans.oneBuilding')
              : t('plans.buildingCount', { count: filteredBuildingGroups.length })
          )}
        </p>
        <div className={`${styles.list} ${styles.plansList}`} data-prw-plan-list>
          {!hasBuildingSearch && displayedRecentBuildingGroups.length > 0 && !hasBuildingFamilyFilter ? (
            <div className={styles.buildingRecentBlockWeb} data-prw-recent-building-rail role="group" aria-label={t('plans.recentBuildings')}>
              <div className={styles.buildingMiniSectionTitleWeb}>{t('plans.recent')}</div>
              {displayedRecentBuildingGroups.map(group => (
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
          {visibleBuildingGroups.map((group: any) => {
            const isSelectedGroup = selectedBuildingKey === group.key || (selectedBuildingKey === 'all' && selectedPlanBuildingKey === group.key);
            const isExpanded = isCompactPlanView
              ? compactExpandedBuildingKey === group.key
              : hasBuildingSearch || isSelectedGroup || expandedBuildingKeys.has(group.key);
            const plansRegionId = `building-plans-${encodeURIComponent(group.key)}`;
            return (
              <article
                key={group.key}
                className={`${styles.buildingGroupWeb} ${isSelectedGroup ? styles.buildingGroupActiveWeb : ''}`}
                data-prw-building-group
                data-selected={isSelectedGroup}
              >
                <button
                  type="button"
                  className={styles.buildingGroupButtonWeb}
                  data-prw-building-button
                  id={`${plansRegionId}-trigger`}
                  aria-expanded={isExpanded}
                  aria-controls={plansRegionId}
                  onClick={() => handleSelectBuildingGroup(group)}
                >
                  <span className={styles.buildingGroupIconWeb}><WorkspaceIcon name={group.key === '__none__' ? 'plan' : 'building'} size={19} /></span>
                  <div>
                    <strong>{group.name}</strong>
                    <small>
                      {group.plans.length} plans
                      {group.levels.length ? ` · ${group.levels.slice(0, 3).join(', ')}${group.levels.length > 3 ? '…' : ''}` : ''}
                    </small>
                  </div>
                  <em>{group.reserveCount}</em>
                  <span className={styles.buildingGroupChevronWeb}><WorkspaceIcon name="chevron" size={18} /></span>
                </button>
                {isExpanded && (
                  <div
                    id={plansRegionId}
                    className={styles.buildingPlanListWeb}
                    data-prw-building-plans
                    role="region"
                    aria-labelledby={`${plansRegionId}-trigger`}
                  >
                    {group.displayPlans.map((plan: any) => {
                      const planReserveCount = reserveCountByPlanId.get(plan.id) ?? 0;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={`${styles.buildingPlanRowWeb} ${selectedPlan?.id === plan.id ? styles.selectedRow : ''}`}
                          data-prw-plan-row
                          data-selected={selectedPlan?.id === plan.id}
                          onClick={() => {
                            setSelectedBuildingKey(group.key);
                            rememberBuildingGroup(group.key);
                            openPlanFromNavigator(String(plan.id));
                          }}
                        >
                          <span><WorkspaceIcon name="document" size={18} /></span>
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
          {isCompactPlanView && hiddenBuildingGroupCount > 0 && (
            <button
              type="button"
              className={styles.buildingLoadMoreWeb}
              data-prw-building-load-more
              onClick={() => setMobileBuildingLimit(limit => limit + WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE)}
            >
              <strong>{hiddenBuildingGroupCount === 1
                ? t('plans.showOneMoreBuilding')
                : t('plans.showMoreBuildings', { count: Math.min(WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE, hiddenBuildingGroupCount) })}</strong>
              <span>{visibleBuildingCount} / {filteredBuildingGroups.length}</span>
            </button>
          )}
          {filteredBuildingGroups.length === 0 && (
            <p className={styles.empty}>Aucun bâtiment ou plan ne correspond à cette recherche.</p>
          )}
          {!plans.length && <p className={styles.empty}>Aucun plan dans ce périmètre.</p>}
        </div>
      </section>
      )}
      {planWorkspace.showDetail && (
      <section className={`${styles.panel} ${styles.plansPreviewPanel}`} data-prw-panel data-prw-plan-preview>
        {isCompactPlanView ? (
          <WorkspaceBackButton
            label={workspaceCopy.back}
            onClick={() => {
              setPinCreateMode(false);
              planWorkspace.closeDetail();
            }}
          />
        ) : null}
        {selectedPlan ? (
          <>
            <div className={`${styles.sectionHeader} ${styles.planPreviewHeader}`} data-prw-plan-preview-header>
              <div className={styles.planPreviewTitle}>
                <p className={styles.eyebrow}>{selectedPlan.file_type ?? 'plan'}</p>
                <h2>{selectedPlan.name}</h2>
                <span>{[getPlanBuildingName(selectedPlan), getPlanLevelName(selectedPlan), selectedPlan.revision_code].filter(Boolean).join(' · ')}</span>
              </div>
              <div className={styles.planHeaderActions} data-prw-plan-actions>
                {planCanExport ? (
                  <button
                    type="button"
                    className={styles.planActionPrimary}
                    onClick={() => setPlansPdfOpen(true)}
                    disabled={!selectedPlan || exportableProjectReserves.length === 0}
                  >
                    <WorkspaceIcon name="document" size={18} />
                    <span>PDF</span>
                  </button>
                ) : null}
                {planCanCreate ? (
                  <button type="button" className={styles.planActionPrimary} onClick={() => onCreateReserve(selectedPlan)}>
                    <WorkspaceIcon name="plus" size={18} />
                    <span>Créer une réserve</span>
                  </button>
                ) : null}
                {selectedPlanResolvedUri ? (
                  <a className={styles.planActionSecondary} href={selectedPlanResolvedUri} target="_blank" rel="noreferrer">
                    <WorkspaceIcon name="document" size={18} />
                    <span>{t('plans.openFile')}</span>
                  </a>
                ) : null}
                {hasPlanActions ? (
                  <div className={styles.planActionMenuWrap}>
                    <button
                      type="button"
                      className={styles.planActionMenuButton}
                      data-prw-more-action
                      aria-expanded={planActionsOpen}
                      onClick={() => setPlanActionsOpen(value => !value)}
                    >
                      <WorkspaceIcon name="more" size={19} />
                      <span>Actions</span>
                    </button>
                    {planActionsOpen && (
                      <div className={styles.planActionMenu}>
                        {planCanCreate ? (
                          <>
                            <button type="button" onClick={() => { setPlanActionsOpen(false); openPlanModal('edit', selectedPlan); }}>
                              <strong>Modifier</strong>
                              <span>Nom, bâtiment, fichier</span>
                            </button>
                            <button type="button" onClick={() => { setPlanActionsOpen(false); openPlanModal('revision', selectedPlan); }}>
                              <strong>Nouvelle révision</strong>
                              <span>Créer un nouvel indice</span>
                            </button>
                          </>
                        ) : null}
                        {planCanDelete && selectedPlan.uri ? (
                          <button type="button" onClick={() => { setPlanActionsOpen(false); handleDeleteSelectedPlanFile(); }}>
                            <strong>Supprimer le fichier</strong>
                            <span>Conserver le plan sans fichier</span>
                          </button>
                        ) : null}
                        {planCanDelete ? (
                          <button
                            type="button"
                            className={styles.planActionMenuDanger}
                            onClick={() => { setPlanActionsOpen(false); onDeletePlan?.(selectedPlan); }}
                          >
                            <strong>Supprimer le plan</strong>
                            <span>Action destructive</span>
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            {planCanCreate && (
              <div className={styles.pinToolbar} data-prw-pin-guidance>
                <div className={styles.pinToolbarIntro}>
                  <strong>Créer une réserve épinglée</strong>
                  <span>Activez le placement, puis touchez l’endroit exact sur le plan.</span>
                </div>
                <button
                  type="button"
                  className={`${styles.pinToolbarAction} ${pinCreateMode ? styles.pinToolbarActionActive : ''}`}
                  aria-pressed={pinCreateMode}
                  onClick={() => {
                    setPinCreateMode(active => !active);
                    setFocusedPlanReserveId(null);
                  }}
                >
                  <span><WorkspaceIcon name="pin" size={21} /></span>
                  <div>
                    <strong>{pinCreateMode ? 'Touchez le plan' : 'Placer une réserve'}</strong>
                    <small>{pinCreateMode ? 'Le prochain toucher ouvre le formulaire.' : 'Aucun toucher ne crée de réserve tant que ce mode est inactif.'}</small>
                  </div>
                </button>
              </div>
            )}
            {placementActive && (
              <div className={styles.planPlacementBanner} data-prw-placement-banner>
                <span className={styles.planPlacementBadge}><WorkspaceIcon name="pin" size={20} /></span>
                <div className={styles.planPlacementText}>
                  <strong>{placementReserve.id} — {placementReserve.title}</strong>
                  <small>Cliquez sur le plan pour placer sa pastille{selectedPlan?.name ? ` sur « ${selectedPlan.name} »` : ''}.</small>
                </div>
                <button type="button" className={styles.planPlacementCancel} onClick={() => onPlacementDone?.()}>
                  Annuler
                </button>
              </div>
            )}
            <div
              className={`${styles.planWorkArea} ${planReservePanelOpen ? styles.planWorkAreaWithReservePanel : styles.planWorkAreaReserveCollapsed}`}
              data-prw-plan-workarea
              data-reserves-open={planReservePanelOpen}
            >
              <div className={styles.planCanvas} data-prw-plan-canvas>
                {selectedPlan.file_type === 'pdf' && (selectedPlanResolvedUri || activeCachedPlanPreview) ? (
                  <WebPdfPlan
                    uri={selectedPlanResolvedUri}
                    name={selectedPlan.name}
                    cachedPreview={activeCachedPlanPreview}
                    previewCacheKey={selectedPlanPreviewKey}
                    mediaStatus={selectedPlanMedia.status}
                    onPreviewReady={cacheSelectedPlanPreview}
                    onRetryMedia={() => retryPrivateMedia(selectedPlanMediaSource, { priority: 'critical' })}
                    pins={planPins}
                    focusedReserveId={focusedPlanReserveId}
                    canCreate={planCanCreate}
                    canMovePins={planCanMovePins}
                    canAnnotate={planCanCreate}
                    annotations={Array.isArray(selectedPlan.annotations) ? selectedPlan.annotations : []}
                    placementPreview={activePlacementPreview}
                    placementActive={placementActive}
                    createModeActive={pinCreateMode}
                    openPinOnSingleTap={isCompactPlanView}
                    onPlacePin={placeExistingPinAt}
                    onCreateReserveAtPin={assignOrCreatePinAt}
                    onPinMove={(reserveId, x, y) => {
                      const reserve = planReserves.find((item: any) => item.id === reserveId);
                      if (!reserve) return false;
                      return onMoveReservePin?.(reserve, selectedPlan, x, y) ?? false;
                    }}
                    onAnnotationsChange={(nextAnnotations) => onUpdatePlanAnnotations?.(selectedPlan, nextAnnotations)}
                    onPinClick={selectPlanReserve}
                    onPinOpen={openReserveFromPin}
                    onClearFocus={() => setFocusedPlanReserveId(null)}
                  />
                ) : selectedPlanMediaSource && selectedPlanMedia.status === 'resolving' ? (
                  <div className={styles.planMediaState} role="status" aria-live="polite">
                    <span className={styles.webPdfLoadingSpinner} aria-hidden="true" />
                    <strong>{t('plans.resolvingMedia')}</strong>
                    <span>{t('plans.resolvingMediaBody')}</span>
                  </div>
                ) : selectedPlanMediaSource && selectedPlanMedia.status === 'error' ? (
                  <div className={styles.planMediaState} role="alert" aria-live="assertive">
                    <span className={styles.webPdfErrorIcon} aria-hidden="true">!</span>
                    <strong>{t('plans.pdfUnavailable')}</strong>
                    <span>{t('plans.pdfUnavailableBody')}</span>
                    <button type="button" onClick={() => retryPrivateMedia(selectedPlanMediaSource, { priority: 'critical' })}>
                      {t('plans.retry')}
                    </button>
                  </div>
                ) : selectedPlanResolvedUri && selectedPlan.file_type === 'image' ? (
                  <img src={selectedPlanResolvedUri} alt={selectedPlan.name} />
                ) : (
                  <div className={styles.planPlaceholder}>{t('plans.previewUnavailable')}</div>
                )}
                {selectedPlan.file_type !== 'pdf' && (pinCreateMode || placementActive) && (
                  <button
                    type="button"
                    className={`${styles.pinClickLayer} ${styles.pinCreateLayer}`}
                    aria-label={placementActive ? 'Toucher pour placer la pastille de la réserve' : 'Toucher pour créer une réserve à cet endroit'}
                    onClick={event => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const px = ((event.clientX - rect.left) / rect.width) * 100;
                      const py = ((event.clientY - rect.top) / rect.height) * 100;
                      if (placementActive) { placeExistingPinAt(px, py); return; }
                      if (focusedPlanReserveId) {
                        setFocusedPlanReserveId(null);
                        return;
                      }
                      if (pinCreateMode) assignOrCreatePinAt(px, py);
                    }}
                  />
                )}
                {selectedPlan.file_type !== 'pdf' && planPins.map((pin) => (
                    <button
                      key={pin.reserve.id}
                      className={`${styles.pin} ${focusedPlanReserveId === pin.reserve.id ? styles.pinFocused : ''}`}
                      style={{ left: `${pin.x}%`, top: `${pin.y}%`, '--plan-pin-color': pin.color, '--plan-pin-foreground': pin.textColor } as CSSProperties}
                      title={isCompactPlanView ? `${pin.reserve.title} · ouvrir la réserve` : `${pin.reserve.title} · double-clic pour ouvrir la réserve`}
                      aria-label={isCompactPlanView ? `Ouvrir la réserve de l'épingle ${pin.number}.` : `Sélectionner l'épingle ${pin.number}. Double-clic pour ouvrir la réserve.`}
                      onClick={event => {
                        event.stopPropagation();
                        selectPlanReserve(pin.reserve.id);
                        if (isCompactPlanView) openReserveFromPin(pin.reserve.id);
                      }}
                      onDoubleClick={event => {
                        event.stopPropagation();
                        if (!isCompactPlanView) openReserveFromPin(pin.reserve.id);
                      }}
                    >
                      <span>{pin.number}</span>
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
                <aside
                  id={planReservePanelId}
                  className={styles.planReservePanel}
                  data-prw-plan-reserves
                  aria-labelledby={planReserveHeadingId}
                >
                  <div className={styles.planReserveHeader}>
                    <div>
                      <h3 id={planReserveHeadingId}>
                        {t('plans.reservesPanel')}
                        <span className={styles.planReserveCount}>{planReserveNavigator.totalCount}</span>
                      </h3>
                      <span className={styles.planReserveProgress} role="status" aria-live="polite">
                        {isCompactPlanView
                          ? t('plans.visibleReserveCount', {
                              visible: planReserveNavigator.visibleCount,
                              total: planReserveNavigator.totalCount,
                            })
                          : t('plans.onPlanCount', { count: planReserveNavigator.totalCount })}
                      </span>
                    </div>
                    <div className={styles.planReserveHeaderActions}>
                      {planPins.length !== planReserveNavigator.totalCount && (
                        <strong>{t('plans.pinnedCount', { count: planPins.length })}</strong>
                      )}
                      <button
                        type="button"
                        onClick={() => setPlanReservePanelOpen(false)}
                        aria-expanded={true}
                        aria-controls={planReservePanelId}
                        aria-label={t('plans.collapseReservePanel')}
                      >
                        <span className={styles.planReserveDisclosureIcon} aria-hidden="true">
                          <WorkspaceIcon name="chevron" size={18} />
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className={styles.planReserveList} role="list" aria-label={t('plans.reservesPanel')}>
                    {planReserveNavigator.visibleRows.map((reserve: any) => {
                      const selected = selectedPlanReserveId === reserve.id;
                      const markerColor = getReservePinColor(reserve, companies ?? []);
                      return (
                        <div key={reserve.id} className={styles.planReserveListItem} role="listitem">
                          <button
                            className={`${styles.planReserveRow} ${selected ? styles.planReserveRowActive : ''}`}
                            data-prw-plan-reserve-row
                            aria-current={selected ? 'true' : undefined}
                            onClick={() => selectPlanReserve(reserve.id)}
                          >
                            <span
                              className={styles.planReserveNumber}
                              style={{ background: markerColor, color: getPlanReserveMarkerTextColor(markerColor) }}
                            >
                              {getPlanPinNumber(planPinNumberMap, reserve) ?? '—'}
                            </span>
                            <span>
                              <strong>{reserve.title}</strong>
                              <small>{getPlanReserveOperationalMeta(reserve)}</small>
                            </span>
                          </button>
                          {isCompactPlanView && selected && renderPlanReserveQuickCard(reserve)}
                        </div>
                      );
                    })}
                    {!planReserveNavigator.totalCount && (
                      <div className={styles.planReserveEmpty}>
                        <strong>{t('plans.noReserveOnPlan')}</strong>
                        <span>{t('plans.noReserveOnPlanBody')}</span>
                      </div>
                    )}
                  </div>
                  {planReserveNavigator.canLoadMore && (
                    <button
                      type="button"
                      className={styles.planReserveLoadMore}
                      data-prw-plan-reserve-load-more
                      onClick={() => setPlanReserveNavigatorState(previous => showNextPlanReserveBatch(
                        syncPlanReserveNavigatorScope(previous, planReserveNavigatorScopeKey),
                      ))}
                    >
                      <strong>{t('plans.showMoreReserves', { count: planReserveNavigator.nextBatchCount })}</strong>
                      <span>{t('plans.remainingReserveCount', { count: planReserveNavigator.hiddenCount })}</span>
                    </button>
                  )}
                  {!isCompactPlanView && selectedPlanReserve && renderPlanReserveQuickCard(selectedPlanReserve)}
                </aside>
              ) : (
                <button
                  type="button"
                  className={styles.planReserveCollapsedRail}
                  data-prw-plan-reserve-rail
                  onClick={() => setPlanReservePanelOpen(true)}
                  aria-expanded={false}
                  aria-controls={planReservePanelId}
                  aria-label={t('plans.expandReservePanel', { count: planReserveNavigator.totalCount })}
                >
                  <span>{t('plans.reservesPanel')}</span>
                  <strong>{planReserveNavigator.totalCount}</strong>
                  {planPins.length !== planReserveNavigator.totalCount && (
                    <em>{t('plans.pinnedCount', { count: planPins.length })}</em>
                  )}
                  <b aria-hidden="true"><WorkspaceIcon name="chevron" size={18} /></b>
                </button>
              )}
            </div>
          </>
        ) : <p className={styles.empty}>Sélectionnez un plan.</p>}
      </section>
      )}

      {planModalMode && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" onMouseDown={() => !saving && setPlanModalMode(null)}>
          <section className={styles.modalPanel} onMouseDown={event => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Plans</p>
                <h2>
                  {planModalMode === 'create'
                    ? 'Nouveau plan'
                    : planModalMode === 'revision'
                      ? 'Nouvelle révision'
                      : 'Modifier le plan'}
                </h2>
                <span>
                  {planModalMode === 'revision'
                    ? `Plan source : ${selectedPlan?.name ?? '—'}`
                    : 'Métadonnées, localisation et fichier du plan.'}
                </span>
              </div>
              <button type="button" onClick={() => setPlanModalMode(null)} disabled={saving}>Fermer</button>
            </div>
            <form className={styles.formGrid} onSubmit={submitPlanModal}>
              <label>
                <span>Chantier</span>
                <select
                  value={planDraft.chantier_id ?? ''}
                  onChange={event => updatePlanDraftProject(event.target.value)}
                  required
                  disabled={planModalMode !== 'create'}
                >
                  <option value="">Choisir un chantier</option>
                  {projects.map((project: any) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label>
                <span>Nom du plan</span>
                <input value={planDraft.name ?? ''} onChange={event => setPlanDraft((prev: any) => ({ ...prev, name: event.target.value }))} required />
              </label>
              <label>
                <span>Bâtiment</span>
                {draftBuildings.length ? (
                  <select value={planDraft.building_id ?? ''} onChange={event => updatePlanDraftBuilding(event.target.value)}>
                    <option value="">Sans bâtiment</option>
                    {draftBuildings.map((building: any) => <option key={building.id} value={building.id}>{building.name}</option>)}
                  </select>
                ) : (
                  <input value={planDraft.building ?? ''} onChange={event => setPlanDraft((prev: any) => ({ ...prev, building: event.target.value, building_id: '' }))} placeholder="Bâtiment" />
                )}
              </label>
              <label>
                <span>Niveau</span>
                {draftLevels.length ? (
                  <select value={planDraft.level_id ?? ''} onChange={event => updatePlanDraftLevel(event.target.value)}>
                    <option value="">Sans niveau</option>
                    {draftLevels.map((level: any) => <option key={level.id} value={level.id}>{level.name}</option>)}
                  </select>
                ) : (
                  <input value={planDraft.level ?? ''} onChange={event => setPlanDraft((prev: any) => ({ ...prev, level: event.target.value, level_id: '' }))} placeholder="RDC, R+1..." />
                )}
              </label>
              <label>
                <span>{planModalMode === 'revision' ? 'Code révision' : 'Révision'}</span>
                <input
                  value={planDraft.revision_code ?? ''}
                  onChange={event => setPlanDraft((prev: any) => ({ ...prev, revision_code: event.target.value }))}
                  placeholder={planModalMode === 'revision' ? 'Automatique si vide' : 'R01, A, Indice 0...'}
                />
              </label>
              <label>
                <span>Note</span>
                <input
                  value={planDraft.revision_note ?? ''}
                  onChange={event => setPlanDraft((prev: any) => ({ ...prev, revision_note: event.target.value }))}
                  placeholder="Motif, indice, commentaire..."
                />
              </label>
              <label className={styles.fullSpan}>
                <span>{planModalMode === 'edit' ? 'Remplacer le fichier (optionnel)' : 'Fichier du plan'}</span>
                <input
                  type="file"
                  accept="application/pdf,image/*,.dxf"
                  onChange={event => setPlanFile(event.target.files?.[0] ?? null)}
                />
              </label>
              {planModalMode === 'revision' && (
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={migrateRevisionReserves}
                    onChange={event => setMigrateRevisionReserves(event.target.checked)}
                  />
                  <span>Migrer les réserves non clôturées vers cette nouvelle révision</span>
                </label>
              )}
              {planActionMessage ? <p className={styles.successText}>{planActionMessage}</p> : null}
              <div className={styles.modalActions}>
                <button type="button" onClick={() => setPlanModalMode(null)} disabled={saving}>Annuler</button>
                <button type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {plansPdfOpen && planCanExport && (
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
                      onClick={() => {
                        setPlansPdfLanguage(option.value);
                        onReportLanguageChange(option.value);
                      }}
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
  canCreate,
  canDelete,
  canExport,
  reportLanguage,
  setReportLanguage,
}: any) {
  const [statusFilter, setStatusFilter] = useState<'all' | VisitDraft['status']>('all');
  const [selectedVisitId, setSelectedVisitId] = useState<string>('');
  const [attachVisitId, setAttachVisitId] = useState<string>('');
  const [attachSearch, setAttachSearch] = useState('');
  const [attachScopeOnly, setAttachScopeOnly] = useState(true);
  const [attachSelectedIds, setAttachSelectedIds] = useState<string[]>([]);
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
          {canCreate ? <button type="button" onClick={onCreateVisit}>Créer</button> : null}
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
                {canDelete ? <button type="button" onClick={() => onDeleteVisit(selectedVisit)}>Supprimer</button> : null}
              </div>
            </div>

            {selectedVisit.cover_photo_uri || selectedVisit.coverPhotoUri ? (
              <PrivateMediaImage
                className={styles.visitCoverHero}
                source={assetUrl({ uri: selectedVisit.cover_photo_uri ?? selectedVisit.coverPhotoUri }, 'photos')}
                alt="Photo de couverture de la visite"
              />
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
                {canCreate ? (
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
                    {(editable || canDelete) ? (
                      <div>
                        {editable ? <button type="button" onClick={() => onUnlinkReserve(selectedVisit, reserve)}>Délier</button> : null}
                        {editable ? <button type="button" onClick={() => onArchiveReserve(reserve)}>{reserve.archived_at ? 'Désarchiver' : 'Archiver'}</button> : null}
                        {canDelete ? <button type="button" onClick={() => onDeleteReserve(reserve)}>Supprimer</button> : null}
                      </div>
                    ) : null}
                  </article>
                ))}
                {!selectedVisitReserves.length && <p className={styles.empty}>Aucune réserve rattachée à cette visite.</p>}
              </div>
            </section>

            {canExport ? <section className={styles.visitReportCardWeb}>
              <div>
                <strong>Compte-rendu PDF</strong>
                 <span>Structure, checklist, réserves rattachées et signatures de la visite.</span>
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
            </section> : null}
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

function PlanningView({ tasks, visites, reserves, companies, profile, editable, canCreate, onUpdateTask, onCreateTask, onOpenReserve, onOpenVisites }: any) {
  const [mode, setMode] = useState<'week' | 'company' | 'late'>('week');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ title: '', deadline: '', company: '', assignee: '' });
  const [busy, setBusy] = useState(false);
  if (profile?.role === 'sous_traitant') return <RestrictedTool title="Planning" />;
  const weekStart = getWeekStart(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const sortedTasks = [...tasks].sort((a: any, b: any) => (parseDateSafe(a.deadline)?.getTime() ?? 0) - (parseDateSafe(b.deadline)?.getTime() ?? 0));
  const visibleTasks = sortedTasks.filter((task: any) => {
    if (mode === 'late') return isTaskLateWeb(task);
    if (mode === 'week') {
      const deadline = parseDateSafe(task.deadline);
      return deadline ? deadline >= weekStart && deadline < weekEnd : task.status !== 'done';
    }
    return true;
  });
  const grouped: Array<[string, any[]]> = mode === 'company'
    ? Object.entries(visibleTasks.reduce((acc: Record<string, any[]>, task: any) => {
        const key = companies.find((item: any) => item.id === task.company || item.name === task.company)?.name ?? task.company ?? 'Sans entreprise';
        acc[key] = [...(acc[key] ?? []), task];
        return acc;
      }, {}))
    : [['Tâches', visibleTasks]];
  const upcomingVisits = [...visites]
    .filter((visit: any) => {
      const date = parseDateSafe(visit.date);
      return date ? date >= new Date(new Date().setHours(0, 0, 0, 0)) : visit.status !== 'completed';
    })
    .sort((a: any, b: any) => (parseDateSafe(a.date)?.getTime() ?? 0) - (parseDateSafe(b.date)?.getTime() ?? 0));
  const reserveDeadlines = [...reserves]
    .filter((reserve: any) => reserve.deadline && reserve.status !== 'closed')
    .sort((a: any, b: any) => (parseDateSafe(a.deadline)?.getTime() ?? 0) - (parseDateSafe(b.deadline)?.getTime() ?? 0));

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Tâches" value={tasks.length} hint="Actions planifiées" />
        <Kpi title="En retard" value={tasks.filter(isTaskLateWeb).length} hint="À reprendre vite" tone="red" />
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
            {canCreate ? <button type="button" onClick={() => setShowForm(value => !value)}>{showForm ? 'Fermer' : 'Nouvelle tâche'}</button> : null}
          </div>
        </div>
        {showForm && canCreate ? (
          <form className={styles.formGrid} onSubmit={async event => {
            event.preventDefault();
            setBusy(true);
            const saved = await onCreateTask?.(draft);
            setBusy(false);
            if (saved) {
              setDraft({ title: '', deadline: '', company: '', assignee: '' });
              setShowForm(false);
            }
          }}>
            <label><span>Titre</span><input value={draft.title} onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))} required /></label>
            <label><span>Échéance</span><input type="date" value={draft.deadline} onChange={event => setDraft(prev => ({ ...prev, deadline: event.target.value }))} /></label>
            <label><span>Entreprise</span>
              <select value={draft.company} onChange={event => setDraft(prev => ({ ...prev, company: event.target.value }))}>
                <option value="">Sans entreprise</option>
                {companies.map((company: any) => <option key={company.id} value={company.name}>{company.name}</option>)}
              </select>
            </label>
            <label><span>Assigné</span><input value={draft.assignee} onChange={event => setDraft(prev => ({ ...prev, assignee: event.target.value }))} /></label>
            <div className={styles.modalActions}><button type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer'}</button></div>
          </form>
        ) : null}
        <div className={styles.timelineGrid}>
          <div>
            <h3>Tâches</h3>
            <div className={styles.timelineList}>
              {grouped.flatMap(([group, groupTasks]) => groupTasks.map((task: any) => {
                const company = companies.find((item: any) => item.id === task.company || item.name === task.company);
                return (
                  <article key={task.id} className={styles.timelineCard}>
                    <span className={`${styles.statusDot} ${task.status === 'done' ? styles.dotDone : isTaskLateWeb(task) ? styles.dotLate : ''}`} />
                    <div>
                      {mode === 'company' ? <small>{group}</small> : null}
                      <strong>{task.title ?? 'Tâche'}</strong>
                    <small>{company?.name ?? task.company ?? 'Sans entreprise'} · {task.assignee || 'Non assigné'} · {prettyDate(task.deadline)}</small>
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
              }))}
              {!visibleTasks.length && <p className={styles.empty}>Aucune tâche dans cette vue.</p>}
            </div>
          </div>
          <div>
            <h3>Visites et échéances</h3>
            <div className={styles.timelineList}>
              {upcomingVisits.map((visit: any) => (
                <button key={visit.id} type="button" className={styles.timelineCard} onClick={() => onOpenVisites?.()}>
                  <span className={styles.statusDot} />
                  <div>
                    <strong>{visit.title}</strong>
                    <small>{prettyDate(visit.date)} · {[visit.building, visit.level].filter(Boolean).join(' · ') || 'Périmètre chantier'}</small>
                  </div>
                  <em>{VISIT_STATUS_LABELS[visit.status as VisitDraft['status']] ?? visit.status}</em>
                </button>
              ))}
              {reserveDeadlines.map((reserve: any) => (
                <button key={reserve.id} type="button" className={styles.timelineCard} onClick={() => onOpenReserve?.(reserve.id)}>
                  <span className={`${styles.statusDot} ${styles.dotLate}`} />
                  <div>
                    <strong>{reserve.title}</strong>
                    <small>Échéance réserve · {prettyDate(reserve.deadline)}</small>
                  </div>
                  <em>{STATUS_LABELS[reserve.status] ?? reserve.status}</em>
                </button>
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
  // Recherche différée : la frappe reste fluide même avec des centaines de photos.
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim().toLowerCase();
  const filteredPhotos = useMemo(() => photos.filter(photo => !q || [photo.title, photo.name, photo.comment, photo.location, photo.taken_by, photo.takenBy].join(' ').toLowerCase().includes(q)), [photos, q]);
  const filteredDocuments = useMemo(() => documents.filter(document => !q || [document.title, document.name, document.file_name, document.category].join(' ').toLowerCase().includes(q)), [documents, q]);
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
            const ref = assetUrl(photo, 'photos');
            return (
              <PrivateMediaLink key={photo.id ?? ref} className={styles.mediaCard} source={ref}>
                {ref ? <PrivateMediaImage source={ref} alt={photo.comment ?? photo.title ?? 'Photo chantier'} /> : <span>Photo</span>}
                <strong>{photo.comment ?? photo.title ?? photo.name ?? 'Photo chantier'}</strong>
                <small>{photo.location ?? photo.building ?? 'Sans localisation'} · {prettyDate(photo.taken_at ?? photo.takenAt ?? photo.created_at, true)}</small>
              </PrivateMediaLink>
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
              const ref = assetUrl(document, 'documents');
              return (
                <PrivateMediaLink key={document.id ?? ref} className={styles.documentRow} source={ref}>
                  <span>{String(document.file_type ?? document.type ?? 'DOC').slice(0, 4).toUpperCase()}</span>
                  <div>
                    <strong>{document.title ?? document.name ?? document.file_name ?? 'Document'}</strong>
                    <small>{document.category ?? 'GED'} · {prettyDate(document.uploaded_at ?? document.created_at, true)}</small>
                  </div>
                </PrivateMediaLink>
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
  canExport,
  onGenerate,
}: any) {
  const disabled = Boolean(generatingReport) || !canExport;
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

function TerrainView({ scoped, data, profile, canViewTeams, setTab }: any) {
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
            { icon: 'warning', title: 'Mes réserves', subtitle: 'Réserves de mon entreprise', count: openReserves, tab: 'reserves', tone: 'amber' },
          ]
        : [
            { icon: 'eye', title: 'Visites chantier', subtitle: 'Compte-rendu visite', count: scoped.visites.length, tab: 'visites', tone: 'blue' },
            { icon: 'clipboard', title: 'OPR', subtitle: 'Opérations de réception', count: scoped.oprs.length, tab: 'opr', tone: 'blue' },
            { icon: 'document-text', title: 'Journal chantier', subtitle: 'Saisie quotidienne', count: scoped.journalEntries?.length ?? data.journalEntries?.length ?? 0, tab: 'journal', tone: 'green' },
            { icon: 'calendar', title: 'Pointage', subtitle: 'Arrivées et départs', count: scoped.timeEntries.filter((entry: any) => entry.date === todayISO()).length, tab: 'pointage', tone: 'blue' },
            ...((profile?.role === 'conducteur' || profile?.role === 'admin' || profile?.role === 'super_admin')
              ? [{ icon: 'people' as TerrainHubIconName, title: 'Messages', subtitle: 'Échanges chantier', tab: 'messages' as TabId, tone: 'blue' as const }]
              : []),
            { icon: 'shield', title: 'Incidents', subtitle: 'Signalements terrain', count: openIncidents, tab: 'incidents', tone: openIncidents ? 'red' : 'green' },
          ],
    },
    {
      title: 'Chantier',
      cards: isSubcontractor
        ? [
            { icon: 'shield-checkmark', title: 'Chantiers', subtitle: 'Changer de chantier', count: data.chantiers.length, tab: 'chantiers', tone: 'green' },
            { icon: 'settings', title: 'Recherche', subtitle: 'Recherche globale', tab: 'search', tone: 'blue' },
          ]
        : [
            { icon: 'shield-checkmark', title: 'Chantiers', subtitle: 'Création, structure, statut', count: data.chantiers.length, tab: 'chantiers', tone: 'green' },
            ...(resolveWebPermissions(profile).canViewInventory
              ? [{ icon: 'clipboard' as TerrainHubIconName, title: 'Stock', subtitle: 'Magasin et mouvements', tab: 'inventory' as TabId, tone: 'green' as const }]
              : []),
            { icon: 'calendar', title: 'Planning', subtitle: delayedTasks ? `${delayedTasks} tâche(s) en retard` : 'Tâches et échéances', count: scoped.tasks.length, tab: 'planning', tone: delayedTasks ? 'red' : 'green' },
            { icon: 'clipboard', title: 'Analytics', subtitle: 'Indicateurs détaillés', count: scoped.reserves.length, tab: 'analytics', tone: 'blue' },
            { icon: 'settings', title: 'Recherche', subtitle: 'Recherche globale', tab: 'search', tone: 'blue' },
            ...(canViewTeams
              ? [{ icon: 'people' as TerrainHubIconName, title: 'Équipes', subtitle: `${data.companies.length} entreprise(s)`, count: data.companies.length, tab: 'equipes' as TabId, tone: 'green' as const }]
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
          ? [
              { icon: 'document-text' as TerrainHubIconName, title: 'Documents', subtitle: 'Import et GED', count: scoped.documents.length, tab: 'documents' as TabId, tone: 'blue' as const },
              { icon: 'clipboard' as TerrainHubIconName, title: 'Checklists', subtitle: 'Contrôle qualité', count: data.checklists?.length ?? 0, tab: 'checklists' as TabId, tone: 'green' as const },
              { icon: 'shield-checkmark' as TerrainHubIconName, title: 'Réglementaire', subtitle: 'PPSPS, DICT, DOE', count: scoped.regulatoryDocs.length, tab: 'reglementaire' as TabId, tone: 'amber' as const },
              { icon: 'document-text' as TerrainHubIconName, title: 'Rapports', subtitle: 'Journalier, hebdo', count: scoped.visites.length + scoped.reserves.length, tab: 'rapports' as TabId, tone: 'blue' as const },
            ]
          : []),
      ],
    },
    {
      title: admin ? 'Administration' : 'Compte',
      cards: [
        ...(admin
          ? [{ icon: 'shield-checkmark' as TerrainHubIconName, title: 'Administration', subtitle: 'Utilisateurs & accès', count: data.profiles.length, tab: 'admin' as TabId, tone: 'amber' as const }]
          : []),
        { icon: 'settings', title: 'Paramètres', subtitle: 'Projet & présences', tab: 'settings', tone: 'blue' },
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

function moveArrayItem<T>(items: T[], fromIndex: number, direction: -1 | 1) {
  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function createStructureId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function ProjectStructureEditor({ buildings, onChange }: { buildings: any[]; onChange: (buildings: any[]) => void }) {
  const [buildingName, setBuildingName] = useState('');

  function updateBuilding(buildingId: string, patch: Record<string, any>) {
    onChange(buildings.map(building => building.id === buildingId ? { ...building, ...patch } : building));
  }

  function updateLevel(buildingId: string, levelId: string, patch: Record<string, any>) {
    onChange(buildings.map(building => {
      if (building.id !== buildingId) return building;
      return {
        ...building,
        levels: (building.levels ?? []).map((level: any) => level.id === levelId ? { ...level, ...patch } : level),
      };
    }));
  }

  function addBuilding() {
    const name = buildingName.trim();
    if (!name) return;
    onChange([
      ...buildings,
      {
        id: createStructureId('building'),
        name,
        levels: [{ id: createStructureId('level'), name: 'RDC', zones: [] }],
      },
    ]);
    setBuildingName('');
  }

  function addLevel(buildingId: string) {
    const building = buildings.find(item => item.id === buildingId);
    const nextIndex = (building?.levels?.length ?? 0) + 1;
    updateBuilding(buildingId, {
      levels: [
        ...(building?.levels ?? []),
        { id: createStructureId('level'), name: nextIndex === 1 ? 'RDC' : `R+${nextIndex - 1}`, zones: [] },
      ],
    });
  }

  async function addZone(buildingId: string, levelId: string) {
    const building = buildings.find(item => item.id === buildingId);
    const level = (building?.levels ?? []).find((item: any) => item.id === levelId);
    const zoneName = await askTextDialog('Nom de la zone');
    if (!zoneName?.trim()) return;
    updateLevel(buildingId, levelId, {
      zones: [...(level?.zones ?? []), { id: createStructureId('zone'), name: zoneName.trim() }],
    });
  }

  function updateZone(buildingId: string, levelId: string, zoneId: string, name: string) {
    const building = buildings.find(item => item.id === buildingId);
    const level = (building?.levels ?? []).find((item: any) => item.id === levelId);
    updateLevel(buildingId, levelId, {
      zones: (level?.zones ?? []).map((zone: any) => zone.id === zoneId ? { ...zone, name } : zone),
    });
  }

  return (
    <div className={styles.structureEditor}>
      <div className={styles.structureAddRow}>
        <input value={buildingName} onChange={event => setBuildingName(event.target.value)} placeholder="Nouveau bâtiment" />
        <button type="button" onClick={addBuilding}>Ajouter bâtiment</button>
      </div>
      <div className={styles.structureTree}>
        {buildings.map((building, buildingIndex) => (
          <article key={building.id} className={styles.structureBuilding}>
            <div className={styles.structureHeaderRow}>
              <input value={building.name ?? ''} onChange={event => updateBuilding(building.id, { name: event.target.value })} />
              <button type="button" onClick={() => onChange(moveArrayItem(buildings, buildingIndex, -1))} disabled={buildingIndex === 0}>↑</button>
              <button type="button" onClick={() => onChange(moveArrayItem(buildings, buildingIndex, 1))} disabled={buildingIndex === buildings.length - 1}>↓</button>
              <button type="button" onClick={() => addLevel(building.id)}>Niveau</button>
              <button type="button" onClick={() => onChange(buildings.filter(item => item.id !== building.id))}>Supprimer</button>
            </div>
            <div className={styles.structureLevels}>
              {(building.levels ?? []).map((level: any, levelIndex: number) => (
                <div key={level.id} className={styles.structureLevel}>
                  <div className={styles.structureHeaderRow}>
                    <input value={level.name ?? ''} onChange={event => updateLevel(building.id, level.id, { name: event.target.value })} />
                    <button
                      type="button"
                      onClick={() => updateBuilding(building.id, { levels: moveArrayItem(building.levels ?? [], levelIndex, -1) })}
                      disabled={levelIndex === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => updateBuilding(building.id, { levels: moveArrayItem(building.levels ?? [], levelIndex, 1) })}
                      disabled={levelIndex === (building.levels ?? []).length - 1}
                    >
                      ↓
                    </button>
                    <button type="button" onClick={() => addZone(building.id, level.id)}>Zone</button>
                    <button type="button" onClick={() => updateBuilding(building.id, { levels: (building.levels ?? []).filter((item: any) => item.id !== level.id) })}>Supprimer</button>
                  </div>
                  <div className={styles.structureZones}>
                    {(level.zones ?? []).map((zone: any, zoneIndex: number) => (
                      <span key={zone.id} className={styles.structureZone}>
                        <input value={zone.name ?? ''} onChange={event => updateZone(building.id, level.id, zone.id, event.target.value)} />
                        <button
                          type="button"
                          onClick={() => updateLevel(building.id, level.id, { zones: moveArrayItem(level.zones ?? [], zoneIndex, -1) })}
                          disabled={zoneIndex === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => updateLevel(building.id, level.id, { zones: moveArrayItem(level.zones ?? [], zoneIndex, 1) })}
                          disabled={zoneIndex === (level.zones ?? []).length - 1}
                        >
                          ↓
                        </button>
                        <button type="button" onClick={() => updateLevel(building.id, level.id, { zones: (level.zones ?? []).filter((item: any) => item.id !== zone.id) })}>×</button>
                      </span>
                    ))}
                    {!(level.zones ?? []).length ? <small>Aucune zone.</small> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
        {!buildings.length ? <p className={styles.empty}>Aucune structure. Ajoutez au moins un bâtiment pour lier les plans et visites précisément.</p> : null}
      </div>
    </div>
  );
}

function ChantiersView({ projects, companies, selectedProjectId, setSelectedProjectId, canCreateProject, canEditProject, canDeleteProject, saving, onSave, onDelete }: any) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<any>({});
  const selectedProject = projects.find((project: any) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const selectedBuildings = selectedProject ? projectBuildings(selectedProject) : [];
  const selectedLevels = selectedBuildings.reduce((sum: number, building: any) => sum + (building.levels?.length ?? 0), 0);
  const selectedZones = selectedBuildings.reduce((sum: number, building: any) => (
    sum + (building.levels ?? []).reduce((levelSum: number, level: any) => levelSum + (level.zones?.length ?? 0), 0)
  ), 0);
  const assignedCompanyIds = new Set([
    ...(Array.isArray(selectedProject?.company_ids) ? selectedProject.company_ids : []),
    ...(Array.isArray(selectedProject?.companyIds) ? selectedProject.companyIds : []),
  ].filter(Boolean));
  const assignedCompanies = assignedCompanyIds.size
    ? companies.filter((company: any) => assignedCompanyIds.has(company.id))
    : companies;

  function openModal(project?: any) {
    if (project ? !canEditProject : !canCreateProject) return;
    setDraft(project ? {
      id: project.id,
      name: project.name ?? '',
      address: project.address ?? '',
      description: project.description ?? '',
      start_date: project.start_date ?? '',
      end_date: project.end_date ?? '',
      status: project.status ?? 'active',
      company_ids: Array.isArray(project.company_ids) ? project.company_ids : Array.isArray(project.companyIds) ? project.companyIds : [],
      buildings: projectBuildings(project),
    } : {
      name: '',
      address: '',
      description: '',
      start_date: todayISO(),
      end_date: '',
      status: 'active',
      company_ids: [],
      buildings: [],
    });
    setModalOpen(true);
  }

  async function submitProject(event: React.FormEvent) {
    event.preventDefault();
    const saved = await onSave(draft);
    if (saved) setModalOpen(false);
  }

  function toggleCompany(companyId: string) {
    setDraft((prev: any) => {
      const current = new Set(Array.isArray(prev.company_ids) ? prev.company_ids : []);
      if (current.has(companyId)) current.delete(companyId);
      else current.add(companyId);
      return { ...prev, company_ids: Array.from(current) };
    });
  }

  return (
    <div className={styles.chantiersWorkspace}>
      <div className={styles.chantiersKpis}>
        <Kpi title="Chantiers" value={projects.length} hint="Total" />
        <Kpi title="Actifs" value={projects.filter((project: any) => project.status === 'active').length} hint="En cours" tone="green" />
        <Kpi title="Entreprises" value={companies.length} hint="Annuaire" tone="amber" />
        <Kpi title="Bâtiments" value={projects.reduce((sum: number, project: any) => sum + projectBuildings(project).length, 0)} hint="Structure" />
      </div>
      <div className={styles.chantiersLayout}>
        <section className={`${styles.panel} ${styles.chantiersRail}`}>
          <div className={styles.panelHeaderCompact}>
            <div>
              <h2>Chantiers</h2>
              <p>{projects.length} chantier(s)</p>
            </div>
            {canCreateProject ? <button type="button" onClick={() => openModal()}>Nouveau chantier</button> : null}
          </div>
          <div className={`${styles.compactList} ${styles.chantiersList}`}>
            {projects.map((project: any) => (
              <button
                key={project.id}
                type="button"
                className={selectedProject?.id === project.id ? styles.selectedRow : ''}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <span>{project.status ?? 'active'} · {projectBuildings(project).length} bâtiment(s)</span>
                <strong>{project.name}</strong>
              </button>
            ))}
            {!projects.length ? <p className={styles.empty}>Aucun chantier.</p> : null}
          </div>
        </section>
        <section className={`${styles.panel} ${styles.chantiersDetail}`}>
          {selectedProject ? (
            <>
              <div className={styles.panelHeaderCompact}>
                <div>
                  <h2>{selectedProject.name}</h2>
                  <p>{selectedProject.address || selectedProject.description || 'Sans adresse'}</p>
                </div>
                {(canEditProject || canDeleteProject) ? (
                  <div className={styles.inlineActions}>
                    {canEditProject ? <button type="button" onClick={() => openModal(selectedProject)}>Modifier</button> : null}
                    {canDeleteProject ? <button type="button" onClick={() => onDelete(selectedProject)}>Supprimer</button> : null}
                  </div>
                ) : null}
              </div>
              <div className={styles.chantierMetricGrid}>
                <span><strong>Statut</strong><em>{selectedProject.status ?? 'active'}</em></span>
                <span><strong>Début</strong><em>{prettyDate(selectedProject.start_date)}</em></span>
                <span><strong>Fin</strong><em>{prettyDate(selectedProject.end_date)}</em></span>
                <span><strong>Entreprises</strong><em>{assignedCompanies.length}</em></span>
                <span><strong>Bâtiments</strong><em>{selectedBuildings.length}</em></span>
                <span><strong>Niveaux</strong><em>{selectedLevels}</em></span>
                <span><strong>Zones</strong><em>{selectedZones}</em></span>
              </div>
              <div className={styles.chantierDetailGrid}>
                <section className={styles.chantierStructurePanel}>
                  <div className={styles.chantierSectionHeader}>
                    <strong>Structure</strong>
                    <span>{selectedBuildings.length} bâtiment(s)</span>
                  </div>
                  <div className={styles.chantierStructureRows}>
                    {selectedBuildings.map((building: any) => {
                      const levels = building.levels ?? [];
                      return (
                        <article key={building.id} className={styles.chantierStructureRow}>
                          <div>
                            <strong>{building.name}</strong>
                            <small>{levels.length} niveau(x)</small>
                          </div>
                          <div>
                            {levels.slice(0, 6).map((level: any) => <span key={level.id}>{level.name}</span>)}
                            {levels.length > 6 ? <em>+{levels.length - 6}</em> : null}
                          </div>
                        </article>
                      );
                    })}
                    {!selectedBuildings.length ? <p className={styles.empty}>Aucune structure enregistrée.</p> : null}
                  </div>
                </section>
                <section className={styles.chantierCompaniesPanel}>
                  <div className={styles.chantierSectionHeader}>
                    <strong>Entreprises</strong>
                    <span>{assignedCompanies.length}</span>
                  </div>
                  <div className={styles.chantierCompanyList}>
                    {assignedCompanies.slice(0, 18).map((company: any) => (
                      <span key={company.id}>
                        <i style={{ backgroundColor: company.color ?? '#003082' }} />
                        {company.short_name ?? company.shortName ?? company.name}
                      </span>
                    ))}
                    {assignedCompanies.length > 18 ? <em>+{assignedCompanies.length - 18}</em> : null}
                    {!assignedCompanies.length ? <p className={styles.empty}>Aucune entreprise affectée.</p> : null}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <p className={styles.empty}>Sélectionnez un chantier.</p>
          )}
        </section>
      </div>

      {modalOpen && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" onMouseDown={() => !saving && setModalOpen(false)}>
          <section className={`${styles.modalPanel} ${styles.wideModal}`} onMouseDown={event => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Chantiers</p>
                <h2>{draft.id ? 'Modifier le chantier' : 'Nouveau chantier'}</h2>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} disabled={saving}>Fermer</button>
            </div>
            <form className={styles.formGrid} onSubmit={submitProject}>
              <label>
                <span>Nom</span>
                <input value={draft.name ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, name: event.target.value }))} required />
              </label>
              <label>
                <span>Statut</span>
                <select value={draft.status ?? 'active'} onChange={event => setDraft((prev: any) => ({ ...prev, status: event.target.value }))}>
                  <option value="active">Actif</option>
                  <option value="paused">Suspendu</option>
                  <option value="completed">Terminé</option>
                </select>
              </label>
              <label>
                <span>Date début</span>
                <input type="date" value={draft.start_date ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, start_date: event.target.value }))} />
              </label>
              <label>
                <span>Date fin</span>
                <input type="date" value={draft.end_date ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, end_date: event.target.value }))} />
              </label>
              <label className={styles.fullSpan}>
                <span>Adresse</span>
                <input value={draft.address ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, address: event.target.value }))} />
              </label>
              <label className={styles.fullSpan}>
                <span>Description</span>
                <textarea rows={3} value={draft.description ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, description: event.target.value }))} />
              </label>
              <div className={styles.fullSpan}>
                <strong>Entreprises affectées</strong>
                <div className={styles.chipGrid}>
                  {companies.map((company: any) => {
                    const active = (draft.company_ids ?? []).includes(company.id);
                    return (
                      <button key={company.id} type="button" className={active ? styles.chipActive : styles.chip} onClick={() => toggleCompany(company.id)}>
                        {company.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className={styles.fullSpan}>
                <strong>Structure bâtiments / niveaux / zones</strong>
                <ProjectStructureEditor buildings={draft.buildings ?? []} onChange={next => setDraft((prev: any) => ({ ...prev, buildings: next }))} />
              </div>
              <div className={styles.modalActions}>
                <button type="button" onClick={() => setModalOpen(false)} disabled={saving}>Annuler</button>
                <button type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function IncidentsView({ incidents, profile, canCreate, canEdit, onCreate, onUpdate }: {
  incidents: any[];
  profile: any;
  canCreate?: boolean;
  canEdit?: boolean;
  onCreate?: (payload: Record<string, any>) => Promise<any>;
  onUpdate?: (incident: any, patch: Record<string, any>) => Promise<any>;
}) {
  const [filter, setFilter] = useState<'all' | 'open' | 'investigating' | 'resolved'>('all');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', location: '', severity: 'moderate', status: 'open' });
  const [busy, setBusy] = useState(false);
  const labels: Record<string, string> = { open: 'Ouvert', investigating: 'En cours', resolved: 'Résolu', minor: 'Mineur', moderate: 'Modéré', major: 'Majeur', critical: 'Critique' };
  if (profile?.role === 'sous_traitant') return <RestrictedTool title="Incidents" />;
  const openIncidents = incidents.filter(isIncidentOpenWeb);
  const visible = [...incidents]
    .filter(incident => filter === 'all' || incident.status === filter)
    .sort((a, b) => String(b.reported_at ?? b.created_at ?? '').localeCompare(String(a.reported_at ?? a.created_at ?? '')));
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Incidents ouverts" value={openIncidents.length} hint="À traiter" tone={openIncidents.length ? 'red' : 'green'} />
        <Kpi title="Total incidents" value={incidents.length} hint="Historique terrain" />
        <Kpi title="Critiques" value={incidents.filter((incident: any) => incident.severity === 'critical').length} hint="Gravité critique" tone="red" />
        <Kpi title="Clôturés" value={incidents.filter((incident: any) => incident.status === 'resolved').length} hint="Résolus" tone="green" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Incidents terrain</h2>
            <p>Signaler, suivre et clôturer les alertes sécurité.</p>
          </div>
          <div className={styles.inlineActions}>
            {(['all', 'open', 'investigating', 'resolved'] as const).map(value => (
              <button key={value} type="button" onClick={() => setFilter(value)}>{value === 'all' ? 'Tous' : labels[value]}</button>
            ))}
            {canCreate ? <button type="button" onClick={() => setShowForm(value => !value)}>{showForm ? 'Fermer' : 'Signaler'}</button> : null}
          </div>
        </div>
        {showForm && canCreate ? (
          <form className={styles.formGrid} onSubmit={async event => {
            event.preventDefault();
            setBusy(true);
            const saved = await onCreate?.(draft);
            setBusy(false);
            if (saved) {
              setDraft({ title: '', description: '', location: '', severity: 'moderate', status: 'open' });
              setShowForm(false);
            }
          }}>
            <label><span>Titre</span><input value={draft.title} onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))} required /></label>
            <label><span>Lieu</span><input value={draft.location} onChange={event => setDraft(prev => ({ ...prev, location: event.target.value }))} /></label>
            <label><span>Gravité</span>
              <select value={draft.severity} onChange={event => setDraft(prev => ({ ...prev, severity: event.target.value }))}>
                <option value="minor">Mineur</option>
                <option value="moderate">Modéré</option>
                <option value="major">Majeur</option>
                <option value="critical">Critique</option>
              </select>
            </label>
            <label className={styles.fullSpan}><span>Description</span><textarea rows={3} value={draft.description} onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))} /></label>
            <div className={styles.modalActions}><button type="submit" disabled={busy}>{busy ? 'Envoi…' : 'Signaler'}</button></div>
          </form>
        ) : null}
        <div className={styles.compactList}>
          {visible.map((incident: any) => (
            <article key={incident.id} className={styles.timelineCard}>
              <span>{labels[incident.status] ?? incident.status} · {labels[incident.severity] ?? incident.severity} · {prettyDate(incident.reported_at ?? incident.created_at)}</span>
              <strong>{incident.title ?? incident.description ?? incident.id}</strong>
              {incident.description ? <p>{incident.description}</p> : null}
              {incident.location ? <small>{incident.location}</small> : null}
              {canEdit && incident.status !== 'resolved' ? (
                <div className={styles.inlineActions}>
                  {incident.status === 'open' ? <button type="button" onClick={() => onUpdate?.(incident, { status: 'investigating' })}>En cours</button> : null}
                  <button type="button" onClick={() => onUpdate?.(incident, { status: 'resolved' })}>Clôturer</button>
                </div>
              ) : null}
            </article>
          ))}
          {!visible.length && <p className={styles.empty}>Aucun incident sur ce chantier.</p>}
        </div>
      </section>
    </div>
  );
}

function OprView({ oprs, reserves, onOpenReserve }: {
  oprs: any[];
  reserves: any[];
  onOpenReserve: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'draft' | 'in_progress' | 'signed'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = [...oprs].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  const visible = filter === 'all' ? sorted : sorted.filter(opr => opr.status === filter);
  const openOpr = sorted.find(opr => opr.status !== 'signed');
  const linkedIds = new Set(oprs.flatMap((opr: any) => (opr.items ?? []).map((item: any) => item.reserveId ?? item.reserve_id).filter(Boolean)));
  const oprReserves = reserves.filter((reserve: any) => linkedIds.has(reserve.id) || reserve.type === 'observation' || reserve.source === 'opr');
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="OPR" value={oprs.length} hint="Contrôles du chantier" />
        <Kpi title="Brouillons" value={oprs.filter((opr: any) => opr.status === 'draft').length} hint="À poursuivre" tone="amber" />
        <Kpi title="Signés" value={oprs.filter((opr: any) => opr.status === 'signed').length} hint="PV clos" tone="green" />
        <Kpi title="Réserves liées" value={oprReserves.filter((reserve: any) => reserve.status !== 'closed' && !isReserveArchived(reserve)).length} hint="Encore ouvertes" tone="red" />
      </div>
      {openOpr ? (
        <section className={styles.panel}>
          <div className={styles.panelHeaderCompact}>
            <div>
              <h2>Continuer l’OPR</h2>
              <p>{openOpr.title} · {openOpr.date}</p>
            </div>
            <button type="button" onClick={() => setOpenId(openOpr.id)}>Ouvrir</button>
          </div>
        </section>
      ) : null}
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>OPR chantier</h2>
            <p>PV, lots contrôlés et réserves rattachées.</p>
          </div>
          <div className={styles.inlineActions}>
            {(['all', 'draft', 'in_progress', 'signed'] as const).map(value => (
              <button key={value} type="button" onClick={() => setFilter(value)}>{value === 'all' ? 'Tous' : value === 'draft' ? 'Brouillon' : value === 'in_progress' ? 'En cours' : 'Signé'}</button>
            ))}
          </div>
        </div>
        <div className={styles.compactList}>
          {visible.map((opr: any) => {
            const items = Array.isArray(opr.items) ? opr.items : [];
            const reservesCount = items.filter((item: any) => item.status === 'reserve').length;
            const okCount = items.filter((item: any) => item.status === 'ok').length;
            const open = openId === opr.id;
            return (
              <article key={opr.id} className={styles.timelineCard}>
                <button type="button" onClick={() => setOpenId(open ? null : opr.id)}>
                  <span>{opr.status ?? 'draft'} · {opr.date} · {okCount} OK · {reservesCount} réserves</span>
                  <strong>{opr.title ?? opr.id}</strong>
                </button>
                {open ? (
                  <div>
                    {items.map((item: any) => (
                      <p key={item.id}>
                        {item.status === 'ok' ? '✓' : item.status === 'reserve' ? '⚠' : '–'} {item.lotName ?? item.lot_name} {item.reserveId || item.reserve_id ? (
                          <button type="button" onClick={() => onOpenReserve(item.reserveId ?? item.reserve_id)}>Voir réserve</button>
                        ) : null}
                      </p>
                    ))}
                    {!items.length ? <p className={styles.empty}>Aucun lot.</p> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {!visible.length ? <p className={styles.empty}>Aucun OPR sur ce chantier.</p> : null}
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

function RestrictedTool({ title }: { title: string }) {
  return (
    <section className={styles.panel}>
      <div className={styles.emptyState}>
        <strong>{title}</strong>
        <p>Accès non disponible pour le profil sous-traitant.</p>
      </div>
    </section>
  );
}

function JournalView({ profile, projectName, selectedProjectId, timeEntries, canCreate, canDelete, canExport, rows, onCreate, onUpdate, onDelete, onMigrate }: any) {
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<any>(() => ({
    date: todayISO(),
    weather: '',
    workerCount: '',
    workDone: '',
    materials: '',
    incidents: '',
    observations: '',
    visitors: '',
  }));

  // Migration one-shot des anciennes entrées localStorage vers Supabase.
  useEffect(() => {
    if (!profile || typeof window === 'undefined') return;
    const flagKey = makeWebLocalStorageKey('buildtrack-web-journal-migrated-v1', profile, selectedProjectId);
    if (window.localStorage.getItem(flagKey) === '1') return;
    const local = readWebLocalArray(makeWebLocalStorageKey('buildtrack-web-journal-v1', profile, selectedProjectId));
    if (!local.length) {
      window.localStorage.setItem(flagKey, '1');
      return;
    }
    Promise.resolve(onMigrate?.(local, selectedProjectId)).then(ok => {
      if (ok) window.localStorage.setItem(flagKey, '1');
    });
  }, [profile, selectedProjectId]);

  const entries = useMemo<any[]>(() => (rows ?? [])
    .map(journalRowToEntry)
    .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date))), [rows]);

  async function submitEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreate || !draft.workDone.trim() || busy) return;
    const duplicate = !draft.id && entries.some((entry: any) => entry.date === draft.date);
    if (duplicate && !window.confirm(`Une entrée existe déjà pour le ${draft.date}. Créer quand même ?`)) return;
    setBusy(true);
    try {
      const attendanceCount = new Set(timeEntries.filter((entry: any) => entry.date === draft.date).map((entry: any) => entry.worker_name)).size;
      const payload = {
        ...draft,
        workerCount: Number(draft.workerCount || attendanceCount || 0),
        chantier_id: selectedProjectId !== 'all' ? selectedProjectId : null,
      };
      const saved = draft.id
        ? await onUpdate?.(entries.find((entry: any) => entry.id === draft.id) ?? draft, payload)
        : await onCreate(payload);
      if (saved) {
        setDraft({ date: todayISO(), weather: '', workerCount: '', workDone: '', materials: '', incidents: '', observations: '', visitors: '' });
        setShowForm(false);
      }
    } finally {
      setBusy(false);
    }
  }

  function exportJournal() {
    const rows = entries.map(entry => `
      <tr>
        <td>${xmlEscape(entry.date)}</td>
        <td>${xmlEscape(entry.weather || '—')}</td>
        <td>${Number(entry.workerCount ?? 0)}</td>
        <td>${xmlEscape(entry.workDone)}</td>
        <td>${xmlEscape(entry.materials || '')}</td>
        <td>${xmlEscape(entry.incidents || '')}</td>
        <td>${xmlEscape(entry.visitors || '')}</td>
        <td>${xmlEscape(entry.author || '')}</td>
      </tr>
    `).join('');
    printHtmlReport(`
      <html><head><title>Journal ${xmlEscape(projectName)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#1e293b}h1{color:#003082}table{width:100%;border-collapse:collapse}th{background:#003082;color:#fff;padding:8px;text-align:left}td{padding:8px;border-bottom:1px solid #e2e8f0}</style>
      </head>
      <body>
        <h1>Journal de chantier — ${xmlEscape(projectName)}</h1>
        <p>${entries.length} entrée(s) · Export ${todayISO()}</p>
        <table>
          <thead><tr><th>Date</th><th>Météo</th><th>Effectif</th><th>Travaux</th><th>Matériaux</th><th>Incidents</th><th>Visiteurs</th><th>Auteur</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8">Aucune entrée</td></tr>'}</tbody>
        </table>
      </body></html>
    `, `BuildTrack_journal_${projectName}.pdf`);
  }

  if (profile?.role === 'sous_traitant') return <RestrictedTool title="Journal de chantier" />;

  const totalWorkers = entries.reduce((sum, entry) => sum + Number(entry.workerCount ?? 0), 0);
  const incidentDays = entries.filter(entry => String(entry.incidents ?? '').trim()).length;

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Entrées" value={entries.length} hint="Journal partagé (Supabase)" />
        <Kpi title="Effectif cumulé" value={totalWorkers} hint="Somme des jours" tone="green" />
        <Kpi title="Jours incident" value={incidentDays} hint="À contrôler" tone={incidentDays ? 'red' : 'green'} />
        <Kpi title="Pointage du jour" value={new Set(timeEntries.filter((entry: any) => entry.date === todayISO()).map((entry: any) => entry.worker_name)).size} hint="Depuis Supabase" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Journal de chantier</h2>
            <p>Saisie quotidienne, météo, effectifs, travaux, incidents, observations et visiteurs.</p>
          </div>
          <div className={styles.inlineActions}>
            {canExport ? <button type="button" onClick={exportJournal}>Exporter</button> : null}
            {canCreate ? <button type="button" onClick={() => { setDraft({ date: todayISO(), weather: '', workerCount: '', workDone: '', materials: '', incidents: '', observations: '', visitors: '' }); setShowForm(value => !value); }}>{showForm ? 'Fermer' : 'Journal du jour'}</button> : null}
          </div>
        </div>
        {canCreate && showForm && (
          <form className={styles.formGrid} onSubmit={submitEntry}>
            <label><span>Date</span><input type="date" value={draft.date} onChange={event => setDraft((prev: any) => ({ ...prev, date: event.target.value }))} /></label>
            <label><span>Météo</span><input value={draft.weather} onChange={event => setDraft((prev: any) => ({ ...prev, weather: event.target.value }))} placeholder="Soleil, pluie..." /></label>
            <label><span>Effectif</span><input type="number" min={0} value={draft.workerCount} onChange={event => setDraft((prev: any) => ({ ...prev, workerCount: event.target.value }))} placeholder="Auto depuis pointage si vide" /></label>
            <label className={styles.fullSpan}><span>Travaux réalisés</span><textarea rows={3} value={draft.workDone} onChange={event => setDraft((prev: any) => ({ ...prev, workDone: event.target.value }))} required /></label>
            <label><span>Matériaux</span><input value={draft.materials} onChange={event => setDraft((prev: any) => ({ ...prev, materials: event.target.value }))} /></label>
            <label><span>Visiteurs</span><input value={draft.visitors} onChange={event => setDraft((prev: any) => ({ ...prev, visitors: event.target.value }))} /></label>
            <label className={styles.fullSpan}><span>Incidents</span><textarea rows={2} value={draft.incidents} onChange={event => setDraft((prev: any) => ({ ...prev, incidents: event.target.value }))} /></label>
            <label className={styles.fullSpan}><span>Observations</span><textarea rows={2} value={draft.observations} onChange={event => setDraft((prev: any) => ({ ...prev, observations: event.target.value }))} /></label>
            <div className={styles.modalActions}><button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
          </form>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Entrées journal</h2>
        <div className={styles.compactList}>
          {entries.map(entry => (
            <article key={entry.id} className={styles.timelineCard}>
              <span className={styles.statusDot} />
              <div>
                <strong>{prettyDate(entry.date)} · {entry.workerCount || 0} présent(s)</strong>
                <small>{entry.weather || 'Météo non renseignée'} · {entry.author}</small>
                <p>{entry.workDone}</p>
                {entry.incidents ? <p style={{ color: '#b45309' }}>⚠ {entry.incidents}</p> : null}
              </div>
              {canCreate ? <button type="button" onClick={() => { setDraft({ id: entry.id, date: entry.date, weather: entry.weather ?? '', workerCount: String(entry.workerCount ?? ''), workDone: entry.workDone ?? '', materials: entry.materials ?? '', incidents: entry.incidents ?? '', observations: entry.observations ?? '', visitors: entry.visitors ?? '' }); setShowForm(true); }}>Modifier</button> : null}
              {canDelete ? <button type="button" onClick={() => onDelete(entry)}>Supprimer</button> : null}
            </article>
          ))}
          {!entries.length ? <p className={styles.empty}>Aucune entrée journal.</p> : null}
        </div>
      </section>
    </div>
  );
}

function PointageView({ entries, companies, profile, editable, canDelete, onCreate, onUpdate, onDelete }: any) {
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState<any>({ worker_name: '', company_id: companies[0]?.id ?? '', arrival_time: '08:00', departure_time: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const dayEntries = entries.filter((entry: any) => entry.date === date);
  const totalPresent = dayEntries.filter((entry: any) => !entry.departure_time).length;

  function selectedCompany(companyId: string) {
    return companies.find((company: any) => company.id === companyId) ?? null;
  }

  async function submitEntry(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!draft.company_id) return;
    if (draft.departure_time && draft.departure_time === draft.arrival_time) return;
    setBusy(true);
    try {
      const company = selectedCompany(draft.company_id);
      const saved = await onCreate({
        ...draft,
        date,
        company_name: company?.name ?? '',
        company_color: company?.color ?? '#10B981',
      });
      if (saved) {
        setDraft({ worker_name: '', company_id: draft.company_id, arrival_time: draft.arrival_time, departure_time: '', notes: '' });
      }
    } finally {
      setBusy(false);
    }
  }

  if (profile?.role === 'sous_traitant') return <RestrictedTool title="Pointage" />;

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Entrées du jour" value={dayEntries.length} hint={prettyDate(date)} />
        <Kpi title="Présents" value={totalPresent} hint="Sans départ" tone="green" />
        <Kpi title="Entreprises" value={new Set(dayEntries.map((entry: any) => entry.company_id || entry.company_name)).size} hint="Sur la journée" />
        <Kpi title="Historique" value={entries.length} hint="Pointages Supabase" tone="amber" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Pointage personnel</h2>
            <p>Arrivées, départs, entreprise, notes et historique.</p>
          </div>
          <input className={styles.compactSearch} type="date" value={date} onChange={event => setDate(event.target.value)} />
        </div>
        {editable && (
          <form className={styles.formGrid} onSubmit={submitEntry}>
            <label><span>Compagnon</span><input value={draft.worker_name} onChange={event => setDraft((prev: any) => ({ ...prev, worker_name: event.target.value }))} required /></label>
            <label>
              <span>Entreprise</span>
              <select value={draft.company_id} required onChange={event => setDraft((prev: any) => ({ ...prev, company_id: event.target.value }))}>
                <option value="">Entreprise *</option>
                {companies.map((company: any) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
            <label><span>Arrivée</span><input type="time" value={draft.arrival_time} onChange={event => setDraft((prev: any) => ({ ...prev, arrival_time: event.target.value }))} /></label>
            <label><span>Départ</span><input type="time" value={draft.departure_time} onChange={event => setDraft((prev: any) => ({ ...prev, departure_time: event.target.value }))} /></label>
            <label className={styles.fullSpan}><span>Notes</span><input value={draft.notes} onChange={event => setDraft((prev: any) => ({ ...prev, notes: event.target.value }))} /></label>
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setDraft((prev: any) => ({ ...prev, arrival_time: new Date().toTimeString().slice(0, 5) }))}>Arrivée maintenant</button>
              <button type="submit" disabled={busy}>{busy ? 'Ajout…' : 'Ajouter pointage'}</button>
            </div>
          </form>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Journée sélectionnée</h2>
        <div className={styles.tableLike}>
          {dayEntries.map((entry: any) => (
            <article key={entry.id} className={styles.tableRow}>
              <span>{entry.arrival_time} → {entry.departure_time || 'présent'}{entry.departure_time ? ` · ${(() => { const [ah, am] = String(entry.arrival_time).split(':').map(Number); const [dh, dm] = String(entry.departure_time).split(':').map(Number); let diff = dh * 60 + dm - (ah * 60 + am); if (diff <= 0) diff += 24 * 60; return `${Math.round(diff / 6) / 10}h`; })()}` : ''}</span>
              <strong>{entry.worker_name}</strong>
              <em>{entry.company_name || 'Sans entreprise'}{entry.notes ? ` · ${entry.notes}` : ''}</em>
              {(editable || canDelete) ? (
                <div className={styles.inlineActions}>
                  {editable && !entry.departure_time ? <button type="button" onClick={() => onUpdate(entry, { departure_time: new Date().toTimeString().slice(0, 5) })}>Départ</button> : null}
                  {canDelete ? <button type="button" onClick={() => onDelete(entry)}>Supprimer</button> : null}
                </div>
              ) : null}
            </article>
          ))}
          {!dayEntries.length ? <p className={styles.empty}>Aucun pointage pour cette journée.</p> : null}
        </div>
      </section>
    </div>
  );
}

function AnalyticsView({ scoped, companies, profile, setTab }: any) {
  if (profile?.role === 'sous_traitant') return <RestrictedTool title="Analytics" />;
  const reserves = scoped.reserves.filter((reserve: any) => !isReserveArchived(reserve));
  const closed = reserves.filter((reserve: any) => reserve.status === 'closed').length;
  const overdue = reserves.filter(isReserveOverdue).length;
  const closureRate = reserves.length ? Math.round((closed / reserves.length) * 100) : 0;
  const weekStats = (() => {
    const now = new Date();
    const weeks = new Map<string, { label: string; created: number; closed: number }>();
    for (let i = 7; i >= 0; i -= 1) {
      const date = new Date(now);
      date.setDate(date.getDate() - i * 7);
      weeks.set(getWeekKey(date), { label: getWeekLabel(date), created: 0, closed: 0 });
    }
    for (const reserve of reserves) {
      const created = getReserveCreatedDate(reserve);
      const closedDate = getReserveClosedDate(reserve);
      if (created) weeks.get(getWeekKey(created)) && (weeks.get(getWeekKey(created))!.created += 1);
      if (closedDate) weeks.get(getWeekKey(closedDate)) && (weeks.get(getWeekKey(closedDate))!.closed += 1);
    }
    return [...weeks.values()];
  })();
  const maxWeek = Math.max(1, ...weekStats.flatMap(item => [item.created, item.closed]));
  const companyStats = companies.map((company: any) => {
    const companyReserves = reserves.filter((reserve: any) => reserveMatchesCompanyName(reserve, company.name));
    const total = companyReserves.length;
    const companyClosed = companyReserves.filter((reserve: any) => reserve.status === 'closed').length;
    return {
      company,
      total,
      closed: companyClosed,
      overdue: companyReserves.filter(isReserveOverdue).length,
      rate: total ? Math.round((companyClosed / total) * 100) : 0,
    };
  }).sort((a: any, b: any) => b.total - a.total);

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Réserves" value={reserves.length} hint="Actives non archivées" />
        <Kpi title="Clôture" value={`${closureRate}%`} hint={`${closed} clôturées`} tone="green" />
        <Kpi title="Retards" value={overdue} hint="Échéance dépassée" tone={overdue ? 'red' : 'green'} />
        <Kpi title="Documents" value={(scoped.documents?.length ?? 0) + (scoped.regulatoryDocs?.length ?? 0)} hint="GED + réglementaire" tone="amber" />
      </div>
      <div className={styles.twoCols}>
        <section className={styles.panel}>
          <div className={styles.panelHeaderCompact}>
            <div>
              <h2>Tendance 8 semaines</h2>
              <p>Créations et clôtures de réserves.</p>
            </div>
          </div>
          <div className={styles.analyticsBars}>
            {weekStats.map(week => (
              <div key={week.label}>
                <span>{week.label}</span>
                <i style={{ height: `${Math.max(4, (week.created / maxWeek) * 100)}%` }} />
                <b style={{ height: `${Math.max(4, (week.closed / maxWeek) * 100)}%` }} />
              </div>
            ))}
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeaderCompact}>
            <div>
              <h2>Entreprises</h2>
              <p>Taux de clôture, volumes et retards.</p>
            </div>
            <button type="button" onClick={() => setTab('equipes')}>Équipes</button>
          </div>
          <div className={styles.compactList}>
            {companyStats.map((item: any) => (
              <article key={item.company.id} className={styles.timelineCard}>
                <span className={styles.statusDot} style={{ background: item.company.color ?? '#003082' }} />
                <div>
                  <strong>{item.company.name}</strong>
                  <small>{item.closed}/{item.total} clôturées · {item.overdue} retard(s)</small>
                  <div className={styles.progressMini}><span style={{ width: `${item.rate}%`, background: item.company.color ?? '#003082' }} /></div>
                </div>
                <em>{item.rate}%</em>
              </article>
            ))}
            {!companyStats.length ? <p className={styles.empty}>Aucune donnée entreprise.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function DocumentsView({ documents, projects, selectedProjectId, profile, canCreate, canDelete, saving, onCreate, onDelete }: any) {
  const [query, setQuery] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<any>({ name: '', category: 'Documents', chantier_id: selectedProjectId !== 'all' ? selectedProjectId : '' });
  const filtered = documents.filter((document: any) => {
    const q = normalizeSearchText(query);
    if (!q) return true;
    return normalizeSearchText([document.name, document.category, document.type].join(' ')).includes(q);
  });

  async function submitDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    const saved = await onCreate({ ...draft, name: draft.name || file.name, type: detectWebDocumentType(file) }, file);
    if (saved) {
      setFile(null);
      setDraft({ name: '', category: 'Documents', chantier_id: selectedProjectId !== 'all' ? selectedProjectId : '' });
    }
  }

  if (profile?.role === 'sous_traitant') return <RestrictedTool title="Documents" />;

  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Documents</h2>
            <p>Import, classement, ouverture et suppression des fichiers chantier.</p>
          </div>
          <input className={styles.compactSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher document..." />
        </div>
        {canCreate && (
          <form className={styles.formGrid} onSubmit={submitDocument}>
            <label><span>Nom</span><input value={draft.name} onChange={event => setDraft((prev: any) => ({ ...prev, name: event.target.value }))} placeholder={file?.name ?? 'Nom du document'} /></label>
            <label><span>Catégorie</span><input value={draft.category} onChange={event => setDraft((prev: any) => ({ ...prev, category: event.target.value }))} /></label>
            <label>
              <span>Chantier</span>
              <select value={draft.chantier_id} onChange={event => setDraft((prev: any) => ({ ...prev, chantier_id: event.target.value }))}>
                <option value="">Organisation</option>
                {projects.map((project: any) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label><span>Fichier</span><input type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} required /></label>
            <div className={styles.modalActions}><button type="submit" disabled={saving}>{saving ? 'Upload...' : 'Importer'}</button></div>
          </form>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Bibliothèque</h2>
        <div className={styles.documentList}>
          {filtered.map((document: any) => {
            const url = assetUrl(document, 'documents');
            return (
              <article key={document.id} className={styles.documentRow}>
                <span>{String(document.type ?? 'DOC').slice(0, 4).toUpperCase()}</span>
                <div>
                  <strong>{document.name ?? 'Document'}</strong>
                  <small>{document.category ?? 'Documents'} · {document.size ?? '—'} · {prettyDate(document.uploaded_at ?? document.created_at, true)}</small>
                </div>
                <div className={styles.inlineActions}>
                  {url ? <PrivateMediaLink className={styles.linkButton} source={url}>Ouvrir</PrivateMediaLink> : null}
                  {canDelete ? <button type="button" onClick={() => onDelete(document)}>Supprimer</button> : null}
                </div>
              </article>
            );
          })}
          {!filtered.length ? <p className={styles.empty}>Aucun document.</p> : null}
        </div>
      </section>
    </div>
  );
}

function ChecklistsView({ profile, selectedProjectId, canCreate, canEdit, canDelete, rows, onSave, onToggle, onDelete, onMigrate }: any) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [itemsText, setItemsText] = useState('EPI conformes\nAccès sécurisé\nSignalisation en place\nZone propre\nRéserves levées');

  // Migration one-shot des anciennes checklists localStorage vers Supabase.
  useEffect(() => {
    if (!profile || typeof window === 'undefined') return;
    const flagKey = makeWebLocalStorageKey('buildtrack-web-checklists-migrated-v1', profile, selectedProjectId);
    if (window.localStorage.getItem(flagKey) === '1') return;
    const local = readWebLocalArray(makeWebLocalStorageKey('buildtrack-web-checklists-v1', profile, selectedProjectId));
    if (!local.length) {
      window.localStorage.setItem(flagKey, '1');
      return;
    }
    Promise.resolve(onMigrate?.(local, selectedProjectId)).then(ok => {
      if (ok) window.localStorage.setItem(flagKey, '1');
    });
  }, [profile, selectedProjectId]);

  const checklists = useMemo<any[]>(() => (rows ?? [])
    .filter((row: any) => selectedProjectId === 'all' || !row.chantier_id || row.chantier_id === selectedProjectId)
    .map(checklistRowToView)
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))), [rows, selectedProjectId]);

  async function createChecklist(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const saved = await onSave({
        title: title.trim(),
        chantier_id: selectedProjectId !== 'all' ? selectedProjectId : null,
        items: itemsText.split('\n').map(label => label.trim()).filter(Boolean).map(label => ({ id: crypto.randomUUID(), label, done: false })),
      });
      if (saved) setTitle('');
    } finally {
      setBusy(false);
    }
  }

  function toggleItem(checklistId: string, itemId: string) {
    if (!canEdit) return;
    const checklist = checklists.find((item: any) => item.id === checklistId);
    if (!checklist) return;
    const items = checklist.items.map((item: any) => item.id === itemId ? { ...item, checked: !item.checked } : item);
    onToggle(checklistId, items);
  }

  if (profile?.role === 'sous_traitant') return <RestrictedTool title="Checklists" />;

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Checklists" value={checklists.length} hint="Partagées (Supabase)" />
        <Kpi title="Terminées" value={checklists.filter(item => item.status === 'completed').length} hint="100% validées" tone="green" />
        <Kpi title="En cours" value={checklists.filter(item => item.status === 'in_progress').length} hint="Contrôles ouverts" tone="amber" />
        <Kpi title="Points" value={checklists.reduce((sum, item) => sum + item.items.length, 0)} hint="À contrôler" />
      </div>
      {canCreate && (
        <section className={styles.panel}>
          <div className={styles.panelHeaderCompact}><div><h2>Nouvelle checklist</h2><p>Créer un contrôle qualité personnalisé.</p></div></div>
          <form className={styles.formGrid} onSubmit={createChecklist}>
            <label><span>Titre</span><input value={title} onChange={event => setTitle(event.target.value)} required /></label>
            <label className={styles.fullSpan}><span>Points à contrôler</span><textarea rows={5} value={itemsText} onChange={event => setItemsText(event.target.value)} /></label>
            <div className={styles.modalActions}><button type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer checklist'}</button></div>
          </form>
        </section>
      )}
      <section className={styles.panel}>
        <h2>Contrôles</h2>
        <div className={styles.checklistGrid}>
          {checklists.map(checklist => {
            const done = checklist.items.filter((item: any) => item.checked).length;
            const pct = checklist.items.length ? Math.round((done / checklist.items.length) * 100) : 0;
            return (
              <article key={checklist.id} className={styles.checklistCard}>
                <div className={styles.panelHeaderCompact}>
                  <div><h3>{checklist.title}</h3><p>{done}/{checklist.items.length} · {pct}%</p></div>
                  {canDelete ? <button type="button" onClick={() => onDelete(checklist)}>Supprimer</button> : null}
                </div>
                <div className={styles.progressMini}><span style={{ width: `${pct}%` }} /></div>
                {checklist.items.map((item: any) => (
                  <button key={item.id} type="button" className={item.checked ? styles.checklistItemDone : styles.checklistItem} disabled={!canEdit} onClick={() => toggleItem(checklist.id, item.id)}>
                    <span>{item.checked ? '✓' : ''}</span>{item.label}
                  </button>
                ))}
              </article>
            );
          })}
          {!checklists.length ? <p className={styles.empty}>Aucune checklist.</p> : null}
        </div>
      </section>
    </div>
  );
}

const REGULATORY_TYPES = [
  ['ppsps', 'PPSPS'],
  ['dict', 'DICT'],
  ['doe', 'DOE'],
  ['plan_prevention', 'Plan de prévention'],
  ['declaration_prealable', 'Déclaration préalable'],
  ['dpae', 'DPAE'],
  ['autre', 'Autre'],
] as const;

const REGULATORY_STATUS_LABELS: Record<string, string> = {
  valid: 'Valide',
  expiring: 'Expire bientôt',
  expired: 'Expiré',
  missing: 'Manquant',
  in_progress: 'En cours',
};

function ReglementaireView({ docs, companies, profile, canCreate, canEdit, canDelete, saving, onSave, onDelete }: any) {
  const [filter, setFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<any>({});
  const [file, setFile] = useState<File | null>(null);
  const filtered = docs.filter((doc: any) => !filter || doc.status === filter);

  function openDoc(doc?: any) {
    if (doc ? !canEdit : !canCreate) return;
    setDraft(doc ? {
      id: doc.id,
      type: doc.type ?? 'autre',
      title: doc.title ?? '',
      company: doc.company ?? '',
      reference: doc.reference ?? '',
      issue_date: doc.issue_date ?? '',
      expiry_date: doc.expiry_date ?? '',
      status: doc.status ?? 'missing',
      notes: doc.notes ?? '',
      uri: doc.uri ?? null,
      created_by: doc.created_by,
    } : { type: 'ppsps', title: '', company: '', reference: '', issue_date: '', expiry_date: '', status: 'missing', notes: '' });
    setFile(null);
    setModalOpen(true);
  }

  async function submitDoc(event: React.FormEvent) {
    event.preventDefault();
    const saved = await onSave(draft, file);
    if (saved) setModalOpen(false);
  }

  if (profile?.role === 'sous_traitant') return <RestrictedTool title="Réglementaire" />;

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Documents" value={docs.length} hint="Réglementaire" />
        <Kpi title="Alertes" value={docs.filter((doc: any) => ['expired', 'missing'].includes(doc.status)).length} hint="Expirés ou manquants" tone="red" />
        <Kpi title="Valides" value={docs.filter((doc: any) => doc.status === 'valid').length} hint="À jour" tone="green" />
        <Kpi title="En cours" value={docs.filter((doc: any) => doc.status === 'in_progress').length} hint="À compléter" tone="amber" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div><h2>Documents réglementaires</h2><p>PPSPS, DICT, DOE, prévention, DPAE et autres documents obligatoires.</p></div>
          <div className={styles.inlineActions}>
            <select value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="">Tous statuts</option>
              {Object.entries(REGULATORY_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            {canCreate ? <button type="button" onClick={() => openDoc()}>Ajouter</button> : null}
          </div>
        </div>
        <div className={styles.compactList}>
          {filtered.map((doc: any) => (
            <article key={doc.id} className={styles.timelineCard}>
              <span className={`${styles.statusDot} ${doc.status === 'valid' ? styles.dotDone : ['expired', 'missing'].includes(doc.status) ? styles.dotLate : ''}`} />
              <div>
                <strong>{doc.title}</strong>
                <small>{REGULATORY_STATUS_LABELS[doc.status] ?? doc.status} · {doc.company || 'Toutes entreprises'} · échéance {prettyDate(doc.expiry_date)}</small>
                {doc.notes ? <p>{doc.notes}</p> : null}
              </div>
              <div className={styles.inlineActions}>
                {assetUrl(doc, 'documents') ? <PrivateMediaLink className={styles.linkButton} source={assetUrl(doc, 'documents')}>Ouvrir</PrivateMediaLink> : null}
                {canEdit ? <button type="button" onClick={() => openDoc(doc)}>Modifier</button> : null}
                {canDelete ? <button type="button" onClick={() => onDelete(doc)}>Supprimer</button> : null}
              </div>
            </article>
          ))}
          {!filtered.length ? <p className={styles.empty}>Aucun document réglementaire.</p> : null}
        </div>
      </section>
      {modalOpen && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" onMouseDown={() => !saving && setModalOpen(false)}>
          <section className={styles.modalPanel} onMouseDown={event => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div><p className={styles.eyebrow}>Réglementaire</p><h2>{draft.id ? 'Modifier document' : 'Nouveau document'}</h2></div>
              <button type="button" onClick={() => setModalOpen(false)} disabled={saving}>Fermer</button>
            </div>
            <form className={styles.formGrid} onSubmit={submitDoc}>
              <label><span>Type</span><select value={draft.type} onChange={event => setDraft((prev: any) => ({ ...prev, type: event.target.value }))}>{REGULATORY_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label><span>Statut</span><select value={draft.status} onChange={event => setDraft((prev: any) => ({ ...prev, status: event.target.value }))}>{Object.entries(REGULATORY_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className={styles.fullSpan}><span>Titre</span><input value={draft.title ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, title: event.target.value }))} required /></label>
              <label><span>Entreprise</span><input list="reg-companies" value={draft.company ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, company: event.target.value }))} /></label>
              <datalist id="reg-companies">{companies.map((company: any) => <option key={company.id} value={company.name} />)}</datalist>
              <label><span>Référence</span><input value={draft.reference ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, reference: event.target.value }))} /></label>
              <label><span>Date émission</span><input type="date" value={draft.issue_date ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, issue_date: event.target.value }))} /></label>
              <label><span>Date expiration</span><input type="date" value={draft.expiry_date ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, expiry_date: event.target.value }))} /></label>
              <label className={styles.fullSpan}><span>Notes</span><textarea rows={3} value={draft.notes ?? ''} onChange={event => setDraft((prev: any) => ({ ...prev, notes: event.target.value }))} /></label>
              <label className={styles.fullSpan}><span>Fichier optionnel</span><input type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
              <div className={styles.modalActions}><button type="button" onClick={() => setModalOpen(false)} disabled={saving}>Annuler</button><button type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function SearchView({ scoped, data, setTab, onOpenReserve, setSelectedPlanId }: any) {
  const [query, setQuery] = useState('');
  // Recherche différée + mémoïsée : 7 collections scannées seulement quand la frappe se stabilise.
  const deferredQuery = useDeferredValue(query);
  const q = normalizeSearchText(deferredQuery);
  const results = useMemo(() => q.length < 2 ? [] : [
    ...scoped.reserves.filter((item: any) => normalizeSearchText([item.id, item.title, item.description, item.building, item.level, item.zone, reserveCompanies(item).join(' ')].join(' ')).includes(q)).map((item: any) => ({ type: 'Réserve', title: item.title, meta: item.id, action: () => onOpenReserve(item.id) })),
    ...scoped.plans.filter((item: any) => normalizeSearchText([item.name, item.building, item.level, item.revision_code].join(' ')).includes(q)).map((item: any) => ({ type: 'Plan', title: item.name, meta: getPlanDisplayLocation(item, data.chantiers.find((project: any) => project.id === item.chantier_id)).building, action: () => { setSelectedPlanId(item.id); setTab('plans'); } })),
    ...scoped.documents.filter((item: any) => normalizeSearchText([item.name, item.category, item.type].join(' ')).includes(q)).map((item: any) => ({ type: 'Document', title: item.name, meta: item.category, action: () => setTab('documents') })),
    ...scoped.incidents.filter((item: any) => normalizeSearchText([item.title, item.description, item.location, item.status].join(' ')).includes(q)).map((item: any) => ({ type: 'Incident', title: item.title, meta: item.status, action: () => setTab('incidents') })),
    ...scoped.visites.filter((item: any) => normalizeSearchText([item.title, item.notes, item.building, item.level].join(' ')).includes(q)).map((item: any) => ({ type: 'Visite', title: item.title, meta: prettyDate(item.date), action: () => setTab('visites') })),
    ...scoped.tasks.filter((item: any) => normalizeSearchText([item.title, item.description, item.company, item.status].join(' ')).includes(q)).map((item: any) => ({ type: 'Tâche', title: item.title, meta: item.company, action: () => setTab('planning') })),
    ...scoped.regulatoryDocs.filter((item: any) => normalizeSearchText([item.title, item.company, item.reference, item.status].join(' ')).includes(q)).map((item: any) => ({ type: 'Réglementaire', title: item.title, meta: REGULATORY_STATUS_LABELS[item.status] ?? item.status, action: () => setTab('reglementaire') })),
  ].slice(0, 80), [q, scoped, data.chantiers, onOpenReserve, setTab, setSelectedPlanId]);

  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div><h2>Recherche globale</h2><p>Réserves, plans, visites, tâches, incidents, documents et réglementaire.</p></div>
          <input className={styles.compactSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="Tapez au moins 2 caractères..." autoFocus />
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Résultats</h2>
        <div className={styles.compactList}>
          {results.map((item: any, index: number) => (
            <button key={`${item.type}-${index}`} type="button" onClick={item.action}>
              <span>{item.type} · {item.meta || '—'}</span>
              <strong>{item.title || 'Sans titre'}</strong>
            </button>
          ))}
          {q.length < 2 ? <p className={styles.empty}>Tapez au moins 2 caractères pour lancer la recherche.</p> : null}
          {q.length >= 2 && !results.length ? <p className={styles.empty}>Aucun résultat.</p> : null}
        </div>
      </section>
    </div>
  );
}

function prefValue(preferences: any[], authUser: SupabaseUser | null, field: string, fallback: any = true) {
  const row = preferences.find(item => item.user_id === authUser?.id);
  return row?.[field] ?? fallback;
}

type SettingsTabId = 'compte' | 'notifications' | 'project' | 'attendance' | 'integrations';
type IonIconName =
  | 'albums-outline'
  | 'alert-circle-outline'
  | 'apps-outline'
  | 'at-outline'
  | 'business-outline'
  | 'chatbubble-outline'
  | 'chatbubbles-outline'
  | 'checkmark-circle'
  | 'checkmark-circle-outline'
  | 'chevron-down'
  | 'chevron-forward'
  | 'chevron-up'
  | 'construct-outline'
  | 'ellipse'
  | 'language-outline'
  | 'lock-closed-outline'
  | 'log-out-outline'
  | 'notifications-outline'
  | 'options-outline'
  | 'people-outline'
  | 'person-circle-outline'
  | 'person-outline'
  | 'phone-portrait-outline'
  | 'pulse-outline'
  | 'radio-button-on'
  | 'refresh'
  | 'search-outline'
  | 'send'
  | 'send-outline'
  | 'shield'
  | 'shield-checkmark-outline'
  | 'shield-outline'
  | 'time-outline'
  | 'warning'
  | 'warning-outline';

const IONICON_CODEPOINTS: Record<IonIconName, string> = {
  'albums-outline': '\uEA11',
  'alert-circle-outline': '\uEA15',
  'apps-outline': '\uEA23',
  'at-outline': '\uEA50',
  'business-outline': '\uEAC8',
  'chatbubble-outline': '\uEB16',
  'chatbubbles-outline': '\uEB19',
  'checkmark-circle': '\uEB1F',
  'checkmark-circle-outline': '\uEB20',
  'chevron-down': '\uEB33',
  'chevron-forward': '\uEB3C',
  'chevron-up': '\uEB42',
  'construct-outline': '\uEB88',
  'ellipse': '\uEBCC',
  'language-outline': '\uECAB',
  'lock-closed-outline': '\uECC9',
  'log-out-outline': '\uECD2',
  'notifications-outline': '\uED80',
  'options-outline': '\uED8C',
  'people-outline': '\uEDA4',
  'person-circle-outline': '\uEDAB',
  'person-outline': '\uEDAD',
  'phone-portrait-outline': '\uEDB6',
  'pulse-outline': '\uEDF8',
  'radio-button-on': '\uEE04',
  'refresh': '\uEE15',
  'search-outline': '\uEE64',
  'send': '\uEE66',
  'send-outline': '\uEE67',
  'shield': '\uEE78',
  'shield-checkmark-outline': '\uEE7A',
  'shield-outline': '\uEE7F',
  'time-outline': '\uEEDF',
  'warning': '\uEF29',
  'warning-outline': '\uEF2A',
};

function IonIcon({ name }: { name: IonIconName }) {
  return <i aria-hidden="true" className={styles.ionIcon}>{IONICON_CODEPOINTS[name]}</i>;
}

function SettingsView({ profile, authUser, data, scoped, selectedProjectId, preferences, languagePreference, deviceLanguage, onUpdateLanguagePreference, exportLanguage, onUpdateExportLanguage, onUpdateOwnProfile, onUpdateNotificationField, onUpdateProject, onUpdateCompanyField, onOpenTab, onOpenAdmin, onLogout }: {
  profile: Profile | null;
  authUser: SupabaseUser | null;
  data: WebState;
  scoped: any;
  selectedProjectId: string;
  preferences: any[];
  languagePreference: WebLanguagePreference;
  deviceLanguage: SupportedLang;
  onUpdateLanguagePreference: (preference: WebLanguagePreference) => void | Promise<void>;
  exportLanguage: SupportedLang;
  onUpdateExportLanguage: (language: SupportedLang) => void;
  onUpdateOwnProfile: (patch: Partial<Profile>) => Promise<void>;
  onUpdateNotificationField: (field: string, value: boolean | string) => void;
  onUpdateProject: (projectId: string, patch: Record<string, any>) => Promise<void>;
  onUpdateCompanyField: (companyId: string, field: 'planned_workers' | 'actual_workers' | 'hours_worked', value: number) => void | Promise<void>;
  onOpenTab: (tab: TabId) => void;
  onOpenAdmin: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const { lang, t } = useWebI18n();
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('compte');
  const activeLanguage = WEB_LANGUAGES.find(item => item.code === lang) ?? WEB_LANGUAGES[0];
  const activeExportLanguage = WEB_LANGUAGES.find(item => item.code === exportLanguage) ?? WEB_LANGUAGES[0];
  const [displayName, setDisplayName] = useState(profile?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const selectedProject = selectedProjectId === 'all' ? null : data.chantiers.find(project => project.id === selectedProjectId) ?? null;
  const [projectNameDraft, setProjectNameDraft] = useState(selectedProject?.name ?? '');
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState(selectedProject?.description ?? '');
  const [savingProject, setSavingProject] = useState(false);
  const [projectMessage, setProjectMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [defaultArrivalTime, setDefaultArrivalTime] = useState('08:00');
  const [standardDayHours, setStandardDayHours] = useState(8);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const profileInitials = initials(profile?.name ?? authUser?.email);
  const accountEmail = profile?.email ?? authUser?.email ?? '';
  const roleLabel = profile?.role_label ?? profile?.role ?? t('common.user');
  const organization = profile?.organization_id
    ? data.organizations.find(item => String(item.id) === String(profile.organization_id)) ?? null
    : null;
  const organizationName = organization?.name ?? profile?.organization_id ?? '';
  const organizationSlug = organization?.slug
    ? `/${organization.slug}`
    : profile?.organization_id ?? '';
  const canManageProject = isAdmin(profile) || Boolean(resolveWebPermissions(profile).canEditChantier);
  const canEditAttendance = canUpdateAttendance(profile);
  const isSubcontractor = profile?.role === 'sous_traitant';
  const isWarehouseUser = profile?.role === 'magasinier';
  const settingsTabs: Array<{ id: SettingsTabId; label: string; icon: IonIconName }> = [
    { id: 'compte', label: t('settings.account'), icon: 'person-circle-outline' },
    { id: 'notifications', label: t('settings.notifications'), icon: 'notifications-outline' },
    ...(!isWarehouseUser ? [
      { id: 'project' as const, label: t('settings.project'), icon: 'construct-outline' as const },
      ...(!isSubcontractor ? [{ id: 'attendance' as const, label: t('settings.attendance'), icon: 'people-outline' as const }] : []),
      { id: 'integrations' as const, label: t('settings.integrations'), icon: 'apps-outline' as const },
    ] : []),
  ];
  const visibleCompanies = data.companies;
  const projectDisplayName = selectedProject?.name ?? (selectedProjectId === 'all' ? 'Tous les chantiers' : 'Chantier');
  const quietHoursStart = String(prefValue(preferences, authUser, 'quiet_hours_start', '19:00'));
  const quietHoursEnd = String(prefValue(preferences, authUser, 'quiet_hours_end', '07:00'));
  const projectDocumentCount = (scoped.documents?.length ?? 0) + (scoped.photos?.length ?? 0);
  const diagnosticOk = Boolean(profile && authUser);

  useEffect(() => {
    setDisplayName(profile?.name ?? '');
  }, [profile?.name]);

  useEffect(() => {
    if ((settingsTab === 'attendance' && isSubcontractor) || (isWarehouseUser && settingsTab !== 'compte' && settingsTab !== 'notifications')) {
      setSettingsTab('compte');
    }
  }, [isSubcontractor, isWarehouseUser, settingsTab]);

  useEffect(() => {
    setProjectNameDraft(selectedProject?.name ?? '');
    setProjectDescriptionDraft(selectedProject?.description ?? '');
    setProjectMessage(null);
  }, [selectedProject?.id, selectedProject?.name, selectedProject?.description]);

  async function handleSaveName(event: React.FormEvent) {
    event.preventDefault();
    const nextName = displayName.trim();
    if (!nextName || nextName === profile?.name) return;
    setSavingName(true);
    setNameMessage(null);
    try {
      await onUpdateOwnProfile({ name: nextName });
      setNameMessage({ ok: true, text: t('settings.profile.nameSaved') });
    } catch (err: any) {
      setNameMessage({ ok: false, text: err?.message ?? t('settings.profile.nameSaveError') });
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < 6) {
      setPasswordMessage({ ok: false, text: t('settings.profile.passwordTooShort') });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ ok: false, text: t('settings.profile.passwordMismatch') });
      return;
    }
    if (!accountEmail) {
      setPasswordMessage({ ok: false, text: t('settings.profile.passwordChangeError') });
      return;
    }
    setSavingPassword(true);
    setPasswordMessage(null);
    try {
      const { error: signInError } = await supabaseBrowser.auth.signInWithPassword({ email: accountEmail, password: currentPassword });
      if (signInError) {
        setPasswordMessage({ ok: false, text: t('settings.profile.currentPasswordInvalid') });
        return;
      }
      const { error: updateError } = await supabaseBrowser.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage({ ok: true, text: t('settings.profile.passwordChanged') });
    } catch (err: any) {
      setPasswordMessage({ ok: false, text: err?.message ?? t('settings.profile.passwordChangeError') });
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleSaveProject(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProject) {
      setProjectMessage({ ok: false, text: t('settings.projectTab.selectProjectFirst') });
      return;
    }
    const nextName = projectNameDraft.trim();
    if (!nextName) {
      setProjectMessage({ ok: false, text: t('settings.projectTab.nameRequired') });
      return;
    }
    setSavingProject(true);
    setProjectMessage(null);
    try {
      await onUpdateProject(selectedProject.id, {
        name: nextName,
        description: projectDescriptionDraft.trim(),
      });
      setProjectMessage({ ok: true, text: t('settings.projectTab.savedText') });
    } catch (err: any) {
      setProjectMessage({ ok: false, text: err?.message ?? t('settings.profile.nameSaveError') });
    } finally {
      setSavingProject(false);
    }
  }

  const renderNotificationToggle = (field: string, titleKey: string, textKey: string, fallback = true) => (
    <ToggleRow
      label={t(titleKey)}
      hint={t(textKey)}
      checked={!!prefValue(preferences, authUser, field, fallback)}
      onChange={value => onUpdateNotificationField(field, value)}
    />
  );

  return (
    <div className={styles.settingsShell}>
      <div className={styles.settingsTabs} role="tablist" aria-label={t('nav.settings')}>
        {settingsTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={settingsTab === tab.id}
            className={settingsTab === tab.id ? styles.settingsTabActive : ''}
            onClick={() => setSettingsTab(tab.id)}
          >
            <span><IonIcon name={tab.icon} /></span>
            <strong>{tab.label}</strong>
          </button>
        ))}
      </div>

      {settingsTab === 'compte' && (
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{t('settings.account')}</p>
            <h2>{profile?.name ?? authUser?.email}</h2>
            <p>{profile?.role_label ?? profile?.role} · {profile?.email ?? authUser?.email}</p>
          </div>
        </div>
        {profile?.organization_id ? (
          <div className={styles.accountInfoCard}>
            <div className={styles.accountInfoIcon}><IonIcon name="business-outline" /></div>
            <div>
              <strong>{t('settings.organization')}</strong>
              <b>{organizationName}</b>
              <span>{organizationSlug}</span>
            </div>
          </div>
        ) : null}
        <div className={styles.languageManager}>
          <div className={styles.languageManagerTitle}>
            <span><IonIcon name="language-outline" /></span>
            <strong>{t('settings.language')}</strong>
          </div>
          <p>{t('settings.languageDescription')}</p>
          <div className={styles.languageSummary}>
            <span>{activeLanguage.shortLabel}</span>
            <div>
              <strong>{activeLanguage.nativeName}</strong>
              <small>
                {languagePreference === 'auto'
                  ? `${t('common.automatic')} · ${t('settings.languageDevice')} ${deviceLanguage.toUpperCase()}`
                  : t('settings.languageSaved')}
              </small>
            </div>
          </div>
          <div className={styles.languageOptions}>
            <button
              type="button"
              className={languagePreference === 'auto' ? styles.languageOptionActive : ''}
              onClick={() => { void onUpdateLanguagePreference('auto'); }}
            >
              <span><IonIcon name="phone-portrait-outline" /></span>
              <strong>{t('common.automatic')}</strong>
            </button>
            {WEB_LANGUAGES.map(option => {
              const active = languagePreference === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  className={active ? styles.languageOptionActive : ''}
                  onClick={() => { void onUpdateLanguagePreference(option.code); }}
                >
                  <span>{option.shortLabel}</span>
                  <strong>{option.nativeName}</strong>
                </button>
              );
            })}
          </div>
          <small className={styles.languageHint}>{t('settings.languageAutoHint')}</small>
        </div>
        <div className={styles.languageManager}>
          <div className={styles.languageManagerTitle}>
            <span><IonIcon name="albums-outline" /></span>
            <strong>{t('settings.exportLanguage')}</strong>
          </div>
          <p>{t('settings.exportLanguageDescription')}</p>
          <div className={styles.languageSummary}>
            <span>{activeExportLanguage.shortLabel}</span>
            <div>
              <strong>{activeExportLanguage.nativeName}</strong>
              <small>{t('settings.exportLanguageSaved')}</small>
            </div>
          </div>
          <div className={styles.languageOptions} role="radiogroup" aria-label={t('settings.exportLanguage')}>
            {WEB_LANGUAGES.map(option => {
              const active = exportLanguage === option.code;
              return (
                <button
                  key={`export-${option.code}`}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={active ? styles.languageOptionActive : ''}
                  onClick={() => onUpdateExportLanguage(option.code)}
                >
                  <span>{option.shortLabel}</span>
                  <strong>{option.nativeName}</strong>
                </button>
              );
            })}
          </div>
        </div>
        <div className={styles.accountProfileCard}>
          <div className={styles.accountAvatar}>{profileInitials}</div>
          <div>
            <strong>{profile?.name ?? authUser?.email ?? '—'}</strong>
            <span>{accountEmail || '—'}</span>
          </div>
          <em>{roleLabel}</em>
        </div>
        <div className={styles.accountFormCard}>
          <div className={styles.accountFormTitle}>
            <span><IonIcon name="person-outline" /></span>
            <strong>{t('settings.profile.title')}</strong>
          </div>
          <form onSubmit={handleSaveName}>
            <label>
              {t('settings.profile.displayName')}
              <input
                value={displayName}
                onChange={event => {
                  setDisplayName(event.target.value);
                  setNameMessage(null);
                }}
                placeholder={t('settings.profile.displayNamePlaceholder')}
                autoComplete="name"
              />
            </label>
            {nameMessage ? <p className={nameMessage.ok ? styles.accountMessageOk : styles.accountMessageError}>{nameMessage.text}</p> : null}
            <button type="submit" disabled={savingName || !displayName.trim() || displayName.trim() === profile?.name}>
              <IonIcon name={savingName ? 'refresh' : 'checkmark-circle-outline'} />
              {savingName ? t('settings.profile.saving') : t('settings.profile.saveName')}
            </button>
          </form>
          <div className={styles.accountDivider} />
          <div className={styles.accountFormTitle}>
            <span><IonIcon name="lock-closed-outline" /></span>
            <strong>{t('settings.profile.changePassword')}</strong>
          </div>
          <form onSubmit={handleChangePassword}>
            <label>
              {t('settings.profile.currentPassword')}
              <input
                value={currentPassword}
                onChange={event => {
                  setCurrentPassword(event.target.value);
                  setPasswordMessage(null);
                }}
                type="password"
                autoComplete="current-password"
              />
            </label>
            <label>
              {t('settings.profile.newPassword')}
              <input
                value={newPassword}
                onChange={event => {
                  setNewPassword(event.target.value);
                  setPasswordMessage(null);
                }}
                type="password"
                autoComplete="new-password"
              />
            </label>
            <label>
              {t('settings.profile.confirmPassword')}
              <input
                value={confirmPassword}
                onChange={event => {
                  setConfirmPassword(event.target.value);
                  setPasswordMessage(null);
                }}
                type="password"
                autoComplete="new-password"
              />
            </label>
            {passwordMessage ? <p className={passwordMessage.ok ? styles.accountMessageOk : styles.accountMessageError}>{passwordMessage.text}</p> : null}
            <button type="submit" disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}>
              <IonIcon name={savingPassword ? 'refresh' : 'shield-checkmark-outline'} />
              {savingPassword ? t('settings.profile.checking') : t('settings.profile.changePasswordAction')}
            </button>
          </form>
        </div>
        {profile?.role === 'super_admin' ? (
          <button type="button" className={styles.accountActionButton} onClick={onOpenAdmin}>
            <span><IonIcon name="shield" /></span>
            <div>
              <strong>{t('settings.superAdmin.title')}</strong>
              <small>{t('settings.superAdmin.subtitle')}</small>
            </div>
            <em><IonIcon name="chevron-forward" /></em>
          </button>
        ) : null}
        <button
          type="button"
          className={styles.accountDiagnosticToggle}
          onClick={() => setDiagnosticOpen(open => !open)}
          aria-expanded={diagnosticOpen}
        >
          <span className={diagnosticOk ? styles.diagnosticIconOk : ''}>
            <IonIcon name={diagnosticOk ? 'checkmark-circle' : 'pulse-outline'} />
          </span>
          <div>
            <strong>{t('settings.diagnostic.title')}</strong>
            <small>{diagnosticOk ? t('settings.diagnostic.allSynced') : t('settings.diagnostic.checkConsistency')}</small>
          </div>
          <em><IonIcon name={diagnosticOpen ? 'chevron-up' : 'chevron-down'} /></em>
        </button>
        {diagnosticOpen ? (
          <div className={styles.accountDiagnosticCard}>
            <dl>
              <div><dt>{t('settings.diagnostic.userId')}</dt><dd>{profile?.id ?? authUser?.id ?? '—'}</dd></div>
              <div><dt>{t('settings.diagnostic.localRole')}</dt><dd>{roleLabel}</dd></div>
              <div><dt>{t('settings.diagnostic.serverRole')}</dt><dd>{roleLabel}</dd></div>
              <div><dt>{t('settings.diagnostic.localOrg')}</dt><dd>{profile?.organization_id ?? '—'}</dd></div>
              <div><dt>{t('settings.diagnostic.serverOrg')}</dt><dd>{profile?.organization_id ?? '—'}</dd></div>
              <div><dt>{t('settings.diagnostic.session')}</dt><dd>{authUser ? t('settings.diagnostic.sessionActive') : t('settings.diagnostic.none')}</dd></div>
            </dl>
            <p className={styles.diagnosticOkBox}>
              <IonIcon name="checkmark-circle" />
              <span>{t('settings.diagnostic.profileSynced')}</span>
            </p>
            <button type="button" className={styles.diagnosticRefreshButton}>
              <IonIcon name="refresh" />
              <strong>{t('settings.diagnostic.refresh')}</strong>
            </button>
          </div>
        ) : null}
        <button type="button" className={styles.accountLogoutButton} onClick={() => { void onLogout(); }}>
          <span><IonIcon name="log-out-outline" /></span>
          <strong>{t('settings.logoutAction')}</strong>
          <em><IonIcon name="chevron-forward" /></em>
        </button>
      </section>
      )}

      {settingsTab === 'notifications' && (
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{t('settings.notifications')}</p>
            <h2>{t('settings.channels')}</h2>
            <p>{t('settings.notifications.subtitle')}</p>
          </div>
        </div>
        <div className={styles.settingsSectionStack}>
          <div className={styles.settingsCard}>
            <div className={styles.accountFormTitle}>
              <span><IonIcon name="phone-portrait-outline" /></span>
              <strong>{t('settings.deviceState')}</strong>
            </div>
            <p className={styles.settingsMuted}>{t('settings.pushStatus.webUnavailable')}</p>
          </div>
          <div className={styles.settingsCard}>
            <div className={styles.accountFormTitle}>
              <span><IonIcon name="options-outline" /></span>
              <strong>{t('settings.channels')}</strong>
            </div>
            <div className={styles.toggleList}>
              {renderNotificationToggle('in_app_enabled', 'settings.notificationSwitches.inAppTitle', 'settings.notificationSwitches.inAppText')}
              {renderNotificationToggle('push_enabled', 'settings.notificationSwitches.pushTitle', 'settings.notificationSwitches.pushText')}
              {renderNotificationToggle('email_enabled', 'settings.notificationSwitches.emailTitle', 'settings.notificationSwitches.emailText')}
              {renderNotificationToggle('quiet_hours_enabled', 'settings.notificationSwitches.quietHoursTitle', 'settings.notificationSwitches.quietHoursText', false)}
            </div>
            {!!prefValue(preferences, authUser, 'quiet_hours_enabled', false) && (
              <div className={styles.settingsInlineFields}>
                <label>
                  {t('settings.quietHoursStart')}
                  <input type="time" value={quietHoursStart} onChange={event => onUpdateNotificationField('quiet_hours_start', event.target.value)} />
                </label>
                <label>
                  {t('settings.quietHoursEnd')}
                  <input type="time" value={quietHoursEnd} onChange={event => onUpdateNotificationField('quiet_hours_end', event.target.value)} />
                </label>
              </div>
            )}
          </div>
          <div className={styles.settingsCard}>
            <div className={styles.accountFormTitle}>
              <span><IonIcon name="chatbubbles-outline" /></span>
              <strong>{t('settings.messages')}</strong>
            </div>
            <div className={styles.toggleList}>
              {renderNotificationToggle('messages_in_app', 'settings.notificationSwitches.messagesInAppTitle', 'settings.notificationSwitches.messagesInAppText')}
              {renderNotificationToggle('messages_push', 'settings.notificationSwitches.messagesPushTitle', 'settings.notificationSwitches.messagesPushText')}
              {renderNotificationToggle('messages_email', 'settings.notificationSwitches.messagesEmailTitle', 'settings.notificationSwitches.messagesEmailText', false)}
            </div>
          </div>
          <div className={styles.settingsCard}>
            <div className={styles.accountFormTitle}>
              <span><IonIcon name="warning-outline" /></span>
              <strong>{t('settings.reserves')}</strong>
            </div>
            <div className={styles.toggleList}>
              {renderNotificationToggle('reserve_created_push', 'settings.notificationSwitches.reserveCreatedPushTitle', 'settings.notificationSwitches.reserveCreatedPushText')}
              {renderNotificationToggle('reserve_created_email', 'settings.notificationSwitches.reserveCreatedEmailTitle', 'settings.notificationSwitches.reserveCreatedEmailText')}
              {renderNotificationToggle('reserve_status_push', 'settings.notificationSwitches.reserveStatusPushTitle', 'settings.notificationSwitches.reserveStatusPushText')}
              {renderNotificationToggle('reserve_status_email', 'settings.notificationSwitches.reserveStatusEmailTitle', 'settings.notificationSwitches.reserveStatusEmailText')}
              {renderNotificationToggle('reserve_critical_in_app', 'settings.notificationSwitches.reserveCriticalInAppTitle', 'settings.notificationSwitches.reserveCriticalInAppText')}
              {renderNotificationToggle('reserve_critical_push', 'settings.notificationSwitches.reserveCriticalPushTitle', 'settings.notificationSwitches.reserveCriticalPushText')}
              {renderNotificationToggle('reserve_critical_email', 'settings.notificationSwitches.reserveCriticalEmailTitle', 'settings.notificationSwitches.reserveCriticalEmailText')}
              {renderNotificationToggle('critical_always_push', 'settings.notificationSwitches.criticalAlwaysPushTitle', 'settings.notificationSwitches.criticalAlwaysPushText')}
            </div>
          </div>
          <div className={styles.settingsCard}>
            <div className={styles.accountFormTitle}>
              <span><IonIcon name="time-outline" /></span>
              <strong>{t('settings.dueDatesAndOverdues')}</strong>
            </div>
            <div className={styles.toggleList}>
              {renderNotificationToggle('due_soon_in_app', 'settings.notificationSwitches.dueSoonInAppTitle', 'settings.notificationSwitches.dueSoonInAppText')}
              {renderNotificationToggle('reserve_overdue_in_app', 'settings.notificationSwitches.reserveOverdueInAppTitle', 'settings.notificationSwitches.reserveOverdueInAppText')}
              {renderNotificationToggle('reserve_overdue_push', 'settings.notificationSwitches.reserveOverduePushTitle', 'settings.notificationSwitches.reserveOverduePushText')}
              {renderNotificationToggle('reserve_overdue_email', 'settings.notificationSwitches.reserveOverdueEmailTitle', 'settings.notificationSwitches.reserveOverdueEmailText')}
              {renderNotificationToggle('task_late_in_app', 'settings.notificationSwitches.taskLateInAppTitle', 'settings.notificationSwitches.taskLateInAppText')}
            </div>
            <p className={styles.settingsNotice}>{t('settings.notificationSwitches.overdueEmailInfo')}</p>
          </div>
          <p className={styles.settingsNotice}>{t('settings.securityEmailsNotice')}</p>
        </div>
      </section>
      )}

      {settingsTab === 'project' && (
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{t('settings.project')}</p>
            <h2>{projectDisplayName}</h2>
            <p>{t('settings.projectTab.projectNameInfo')}</p>
          </div>
        </div>
        <div className={styles.settingsStats}>
          <div><strong>{scoped.reserves.length}</strong><span>{t('settings.projectTab.stats.reserves')}</span></div>
          <div><strong>{visibleCompanies.length}</strong><span>{t('settings.projectTab.stats.companies')}</span></div>
          <div><strong>{projectDocumentCount}</strong><span>{t('settings.projectTab.stats.documents')}</span></div>
          <div><strong>{scoped.incidents.length}</strong><span>{t('settings.projectTab.stats.incidents')}</span></div>
        </div>
        <div className={styles.settingsSectionStack}>
          <div className={styles.settingsCard}>
            <div className={styles.accountFormTitle}>
              <span><IonIcon name="options-outline" /></span>
              <strong>{t('settings.projectTab.quickAccess')}</strong>
            </div>
            <div className={styles.settingsQuickGrid}>
              <button type="button" onClick={() => onOpenTab('equipes')}>{t('settings.projectTab.quickTeams')}</button>
              <button type="button" onClick={() => onOpenTab('rapports')}>{t('settings.projectTab.quickReports')}</button>
              <button type="button" onClick={() => onOpenTab('plans')}>{t('settings.projectTab.quickPlans')}</button>
              <button type="button" onClick={() => onOpenTab('planning')}>{t('settings.projectTab.quickPlanning')}</button>
            </div>
          </div>
          <div className={styles.accountFormCard}>
            <div className={styles.accountFormTitle}>
              <span><IonIcon name="construct-outline" /></span>
              <strong>{t('settings.projectTab.projectInfo')}</strong>
            </div>
            {canManageProject && selectedProject ? (
              <form onSubmit={handleSaveProject}>
                <label>
                  {t('settings.projectTab.projectName')}
                  <input value={projectNameDraft} onChange={event => { setProjectNameDraft(event.target.value); setProjectMessage(null); }} placeholder={t('settings.projectTab.projectNamePlaceholder')} />
                </label>
                <label>
                  {t('settings.projectTab.description')}
                  <textarea value={projectDescriptionDraft} onChange={event => { setProjectDescriptionDraft(event.target.value); setProjectMessage(null); }} placeholder={t('settings.projectTab.descriptionPlaceholder')} rows={4} />
                </label>
                {projectMessage ? <p className={projectMessage.ok ? styles.accountMessageOk : styles.accountMessageError}>{projectMessage.text}</p> : null}
                <button type="submit" disabled={savingProject || !projectNameDraft.trim()}>
                  {savingProject ? t('settings.projectTab.saving') : t('common.save')}
                </button>
              </form>
            ) : (
              <p className={styles.settingsNotice}>
                {canManageProject ? t('settings.projectTab.selectProjectFirst') : t('settings.projectTab.adminOnly')}
              </p>
            )}
          </div>
        </div>
      </section>
      )}

      {settingsTab === 'attendance' && !isSubcontractor && (
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{t('settings.attendance')}</p>
            <h2>{t('settings.attendanceTab.todayAttendance')}</h2>
            <p>{t('settings.attendanceTab.standardDayHint')}</p>
          </div>
        </div>
        <div className={styles.settingsSectionStack}>
          <div className={styles.settingsCard}>
            <div className={styles.accountFormTitle}>
              <span><IonIcon name="time-outline" /></span>
              <strong>{t('settings.attendanceTab.preferences')}</strong>
            </div>
            <div className={styles.settingsChipBlock}>
              <span>{t('settings.attendanceTab.defaultArrival')}</span>
              <div>
                {['06:30', '07:00', '07:30', '08:00', '08:30'].map(time => (
                  <button key={time} type="button" className={defaultArrivalTime === time ? styles.settingsChipActive : ''} onClick={() => setDefaultArrivalTime(time)}>{time}</button>
                ))}
              </div>
              <small>{t('settings.attendanceTab.defaultArrivalHint')}</small>
            </div>
            <div className={styles.accountDivider} />
            <div className={styles.settingsChipBlock}>
              <span>{t('settings.attendanceTab.standardDay')}</span>
              <div>
                {[6, 7, 8, 9, 10].map(hours => (
                  <button key={hours} type="button" className={standardDayHours === hours ? styles.settingsChipActive : ''} onClick={() => setStandardDayHours(hours)}>{hours}h</button>
                ))}
              </div>
            </div>
          </div>
          <div className={styles.settingsCard}>
            <div className={styles.accountFormTitle}>
              <span><IonIcon name="people-outline" /></span>
              <strong>{t('settings.attendanceTab.todayAttendance')}</strong>
            </div>
            {visibleCompanies.length ? (
              <div className={styles.attendanceTable}>
                {visibleCompanies.map(company => {
                  const actual = Number(company.actual_workers ?? company.actualWorkers ?? 0);
                  const planned = Number(company.planned_workers ?? company.plannedWorkers ?? 0);
                  const hours = Number(company.hours_worked ?? company.hoursWorked ?? actual * standardDayHours);
                  return (
                    <div key={company.id} className={styles.attendanceRow}>
                      <span style={{ backgroundColor: company.color ?? '#003082' }} />
                      <strong>{company.name}</strong>
                      <label>
                        Présents
                        <input type="number" min={0} value={actual} disabled={!canEditAttendance} onChange={event => onUpdateCompanyField(company.id, 'actual_workers', Number(event.target.value))} />
                      </label>
                      <label>
                        Planifiés
                        <input type="number" min={0} value={planned} disabled={!canEditAttendance} onChange={event => onUpdateCompanyField(company.id, 'planned_workers', Number(event.target.value))} />
                      </label>
                      <em>{hours}h</em>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.settingsNotice}>{t('settings.attendanceTab.noConfiguredCompany')}</p>
            )}
            <button type="button" className={styles.settingsGhostButton} disabled>{t('settings.attendanceTab.saveSnapshotActionFull')}</button>
            <p className={styles.settingsMuted}>{t('settings.attendanceTab.noHistoryText')}</p>
          </div>
        </div>
      </section>
      )}

      {settingsTab === 'integrations' && (
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{t('settings.integrations')}</p>
            <h2>{t('settings.integrationsTab.title')}</h2>
            <p>{t('settings.integrationsTab.subtitle')}</p>
          </div>
        </div>
        {!canManageProject ? (
          <p className={styles.settingsNotice}>{t('settings.integrationsTab.adminOnlyText')}</p>
        ) : (
          <div className={styles.integrationGrid}>
            {[
              t('settings.integrationsTab.projectManagement'),
              t('settings.integrationsTab.bim'),
              t('settings.integrationsTab.regulatoryDocs'),
              t('settings.integrationsTab.geolocation'),
              t('settings.integrationsTab.fieldForms'),
              t('settings.integrationsTab.documentsSignature'),
              t('settings.integrationsTab.weatherHr'),
            ].map((label, index) => (
              <div key={label} className={styles.integrationCard}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{label}</strong>
                <small>{t('settings.integrationsTab.manage')}</small>
              </div>
            ))}
          </div>
        )}
      </section>
      )}
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

type PhotoAnnotationLayerFit = 'stretch' | 'contain' | 'cover';

// Rectangle réellement occupé par l'image dans son cadre (en % du cadre),
// selon le object-fit du contexte d'affichage : contain (éditeur, bandes de
// letterbox centrées) ou cover (vignettes, débordement clippé par le cadre).
function computePhotoImageRect(
  fit: 'contain' | 'cover',
  natural: { width: number; height: number },
  box: { width: number; height: number },
) {
  const scale = fit === 'contain'
    ? Math.min(box.width / natural.width, box.height / natural.height)
    : Math.max(box.width / natural.width, box.height / natural.height);
  const width = ((natural.width * scale) / box.width) * 100;
  const height = ((natural.height * scale) / box.height) * 100;
  return { left: (100 - width) / 2, top: (100 - height) / 2, width, height };
}

function PhotoAnnotationLayer({
  annotations,
  compact = false,
  fit = 'stretch',
  imageSrc,
}: {
  annotations?: WebPhotoAnnotation[];
  compact?: boolean;
  // 'stretch' : le cadre moule l'image (lightbox), les % s'appliquent à toute
  // la boîte. 'contain'/'cover' : recale les annotations coordSpace 'image'
  // dans le rectangle réel de l'image du cadre.
  fit?: PhotoAnnotationLayerFit;
  imageSrc?: string;
}) {
  const layerRef = useRef<HTMLSpanElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [boxSize, setBoxSize] = useState<{ width: number; height: number } | null>(null);
  const normalized = normalizePhotoAnnotations(annotations);
  // Seules les annotations coordSpace 'image' nécessitent le rectangle réel de
  // l'image ; les annotations legacy restent rendues sur toute la surface du
  // cadre, exactement comme avant.
  const needsImageRect = fit !== 'stretch' && normalized.some(annotation => annotation.coordSpace === 'image');

  useEffect(() => {
    if (!needsImageRect || !imageSrc) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    image.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [needsImageRect, imageSrc]);

  useEffect(() => {
    if (!needsImageRect || typeof ResizeObserver === 'undefined') return;
    const node = layerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setBoxSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [needsImageRect]);

  if (!normalized.length) return null;

  const imageRect = needsImageRect && naturalSize && boxSize && boxSize.width > 0 && boxSize.height > 0
    ? computePhotoImageRect(fit, naturalSize, boxSize)
    : null;
  // Projette un point annoté (%) vers le cadre : identité pour le legacy (et
  // tant que les mesures ne sont pas disponibles), recalage dans le rectangle
  // réel de l'image pour coordSpace 'image'.
  const projectPoint = (point: WebPhotoAnnotationPoint, coordSpace?: 'image') =>
    coordSpace === 'image' && imageRect
      ? {
          x: imageRect.left + (point.x * imageRect.width) / 100,
          y: imageRect.top + (point.y * imageRect.height) / 100,
        }
      : point;
  // Convention commune web/mobile : la valeur du sélecteur (2/8/18) est
  // l'épaisseur à l'écran (non-scaling-stroke) dans l'éditeur et la lightbox,
  // réduite dans les vignettes compactes.
  const penScreenWidth = (strokeWidth?: number) => {
    const width = strokeWidth ?? 8;
    return compact ? Math.max(1.5, Math.min(8, width * 0.45)) : width;
  };

  return (
    <span ref={layerRef} className={styles.photoAnnotationLayer} aria-hidden="true">
      <svg className={styles.photoAnnotationSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        {normalized
          .filter(annotation => annotation.tool === 'pen' && (annotation.points?.length ?? 0) >= 1)
          .map(annotation => {
            const projected = (annotation.points ?? []).map(point => projectPoint(point, annotation.coordSpace));
            // Un trait d'un seul point = pastille de diamètre strokeWidth
            // (comme mobile) : point dupliqué + bouts arrondis = disque.
            const points = projected.length === 1
              ? [projected[0], { x: projected[0].x + 0.01, y: projected[0].y }]
              : projected;
            return (
              <polyline
                key={annotation.id}
                points={points.map(point => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke={annotation.color}
                strokeWidth={penScreenWidth(annotation.strokeWidth)}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
      </svg>
      {normalized
        .filter(annotation => annotation.tool !== 'pen')
        .map(annotation => {
          const position = projectPoint({ x: annotation.x, y: annotation.y }, annotation.coordSpace);
          return (
            <span
              key={annotation.id}
              className={[
                styles.photoAnnotationMarker,
                annotation.tool === 'text' ? styles.photoAnnotationMarkerText : '',
                annotation.tool === 'rect' ? styles.photoAnnotationMarkerRect : '',
                annotation.tool === 'measure' ? styles.photoAnnotationMarkerMeasure : '',
              ].filter(Boolean).join(' ')}
              style={{
                left: `${position.x}%`,
                top: `${position.y}%`,
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
          );
        })}
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
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const photoMedia = usePrivateMediaAccess(photo.uri, { priority: 'critical' });
  const photoSrc = photoMedia.url || EMPTY_MEDIA_IMAGE;

  // Rectangle réellement occupé par l'image (object-fit: contain) dans le
  // stage, en pixels viewport : les bandes de letterbox n'en font pas partie.
  function stageImageRect() {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    // Tant que les dimensions naturelles sont inconnues, on retombe sur le cadre entier.
    if (!imageNaturalSize) return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const scale = Math.min(rect.width / imageNaturalSize.width, rect.height / imageNaturalSize.height);
    const width = imageNaturalSize.width * scale;
    const height = imageNaturalSize.height * scale;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    };
  }

  function pointFromEvent(event: PointerEvent<HTMLButtonElement>): WebPhotoAnnotationPoint {
    const rect = stageImageRect();
    if (!rect) return { x: 50, y: 50 };
    return {
      x: Number(clampPercent(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100).toFixed(2)),
      y: Number(clampPercent(((event.clientY - rect.top) / Math.max(1, rect.height)) * 100).toFixed(2)),
    };
  }

  function eventInsideImage(event: PointerEvent<HTMLButtonElement>) {
    const rect = stageImageRect();
    if (!rect) return false;
    return event.clientX >= rect.left && event.clientX <= rect.left + rect.width
      && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
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
      coordSpace: 'image',
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
    // Un seul point suffit : un tap = pastille de diamètre strokeWidth (comme
    // mobile), et un pointercancel (geste tactile intercepté par le
    // navigateur) committe le trait en cours plutôt que de le perdre.
    if ((stroke.points?.length ?? 0) >= 1) {
      setAnnotations(prev => [...prev, stroke]);
    }
    currentStrokeRef.current = null;
    setCurrentStroke(null);
  }

  async function addAnnotation(point: WebPhotoAnnotationPoint) {
    if (activeTool === 'text') {
      const text = await askTextDialog("Texte de l'annotation");
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
          coordSpace: 'image',
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
        coordSpace: 'image',
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
    // Les clics de placement dans les bandes de letterbox (hors photo) sont ignorés.
    if (!eventInsideImage(event)) return;
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
          <img
            src={photoSrc}
            alt={photo.name ?? 'Photo réserve'}
            draggable={false}
            aria-busy={photoMedia.status === 'resolving' || photoMedia.status === 'idle'}
            onLoad={event => {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                setImageNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
              }
            }}
          />
          {photoMedia.url ? (
            <PhotoAnnotationLayer annotations={[...annotations, ...(currentStroke ? [currentStroke] : [])]} fit="contain" imageSrc={photoMedia.url} />
          ) : null}
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
  useEscapeClose(!saving && !annotatingPhoto, onClose);
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
                        <PrivatePhotoFrame photo={photo} compact fit="cover" />
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
  const { lang } = useWebI18n();
  useEscapeClose(!saving, onClose);
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
  const suggestedTitle = autoVisitTitle(draft.visitType, draft.date || todayISO(), lang);
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
      const previousAutoTitle = autoVisitTitle(prev.visitType, prev.date || todayISO(), lang);
      const shouldRefreshTitle = !prev.title.trim() || prev.title.trim() === previousAutoTitle;
      return {
        ...prev,
        visitType: type,
        title: shouldRefreshTitle ? autoVisitTitle(type, prev.date || todayISO(), lang) : prev.title,
        checklistItems: makeVisitChecklist(type, lang),
      };
    });
  }

  function updateVisitDate(date: string) {
    setDraft(prev => {
      const previousAutoTitle = autoVisitTitle(prev.visitType, prev.date || todayISO(), lang);
      const shouldRefreshTitle = !prev.title.trim() || prev.title.trim() === previousAutoTitle;
      return {
        ...prev,
        date,
        title: shouldRefreshTitle ? autoVisitTitle(prev.visitType, date || todayISO(), lang) : prev.title,
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
                      <PrivateMediaImage source={draft.coverPhoto.uri} alt="Photo de couverture" immediate />
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
              <button type="button" className={styles.secondaryBtn} onClick={() => setDraft(prev => ({ ...prev, checklistItems: makeVisitChecklist(prev.visitType, lang) }))}>
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

function OperatorCockpit({ data, onEnterSupport }: { data: WebState; onEnterSupport?: (org: { id: string; name: string }) => void }) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const orgs = (data.organizations ?? []).filter(org => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return String(org.name ?? '').toLowerCase().includes(needle) || String(org.slug ?? '').toLowerCase().includes(needle);
  });
  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Clients BuildTrack</h2>
            <p>Cockpit plateforme. Les données chantier ne sont plus mélangées ici.</p>
          </div>
          <input className={styles.compactSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher un client..." />
        </div>
        <form
          className={styles.formGrid}
          onSubmit={async event => {
            event.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            setNotice('');
            const { error } = await supabaseBrowser.rpc('platform_create_organization', {
              p_name: name.trim(),
              p_admin_email: adminEmail.trim() || null,
            });
            setBusy(false);
            if (error) return setNotice(error.message);
            setName('');
            setAdminEmail('');
            setNotice('Organisation créée.');
          }}
        >
          <label>Nouveau client<input value={name} onChange={event => setName(event.target.value)} required /></label>
          <label>Admin (email)<input value={adminEmail} onChange={event => setAdminEmail(event.target.value)} type="email" placeholder="optionnel" /></label>
          <button type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer'}</button>
        </form>
        {notice ? <p className={styles.empty}>{notice}</p> : null}
        <div className={styles.dataTable} style={{ marginTop: 16 }}>
          <div className={styles.tableHead}><span>Client</span><span>Slug</span><span>Action</span></div>
          {orgs.map(org => (
            <div key={org.id} className={styles.tableRow}>
              <strong>{org.name}</strong>
              <span>{org.slug}</span>
              <button type="button" onClick={() => onEnterSupport?.({ id: String(org.id), name: String(org.name ?? org.slug ?? org.id) })}>Support</button>
            </div>
          ))}
          {orgs.length === 0 ? <p className={styles.empty}>Aucun client.</p> : null}
        </div>
      </section>
    </div>
  );
}

function AdminView({ data, profile, onUpdateProfile, onEnterSupport, onCreateCompany, onUpdateCompany, onDeleteCompany, onRemoveUser }: {
  data: WebState;
  profile: Profile | null;
  onUpdateProfile: (userId: string, patch: Partial<Profile>) => Promise<void> | void;
  onEnterSupport?: (org: { id: string; name: string }) => void;
  onCreateCompany?: (payload: { name: string; email?: string; contact?: string; siret?: string; short_name?: string; insurance?: string; lots?: string[] }) => Promise<any>;
  onUpdateCompany?: (companyId: string, payload: Record<string, any>) => Promise<void> | void;
  onDeleteCompany?: (companyId: string) => Promise<void> | void;
  onRemoveUser?: (userId: string) => Promise<void> | void;
}) {
  const [query, setQuery] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [pilotageTab, setPilotageTab] = useState<'users' | 'companies' | 'license'>('users');
  const [roleFilter, setRoleFilter] = useState('all');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('observateur');
  const [inviteCompanyId, setInviteCompanyId] = useState('');
  const [inviteStep, setInviteStep] = useState<1 | 2 | 3>(1);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteNotice, setInviteNotice] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [companyDraft, setCompanyDraft] = useState({ name: '', short_name: '', email: '', contact: '', siret: '', insurance: '', lots: [] as string[] });
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [rightsUserId, setRightsUserId] = useState<string | null>(null);
  const [license, setLicense] = useState<{ status: string; planName: string; maxUsers: number; trialEndsAt?: string | null; startedAt?: string | null } | null>(null);
  const [pendingInvites, setPendingInvites] = useState<Array<{ id: string; email: string; role: string; expires_at?: string; company_id?: string | null; resend_count?: number; last_resent_at?: string | null }>>([]);
  const loadInvites = useCallback(async () => {
    const { data: rows } = await supabaseBrowser.from('invitations').select('id,email,role,expires_at,company_id,status,resend_count,last_resent_at').eq('status', 'pending').order('created_at', { ascending: false });
    setPendingInvites((rows ?? []).map((row: any) => ({
      id: String(row.id),
      email: String(row.email ?? ''),
      role: String(row.role ?? 'observateur'),
      expires_at: row.expires_at,
      company_id: row.company_id ?? null,
      resend_count: Number(row.resend_count ?? 0),
      last_resent_at: row.last_resent_at ?? null,
    })));
  }, []);
  useEffect(() => { void loadInvites(); }, [loadInvites]);
  useEffect(() => {
    if (!profile?.organization_id) return;
    void (async () => {
      const { data: sub } = await supabaseBrowser.from('subscriptions').select('status, plan_id, started_at, trial_ends_at').eq('organization_id', profile.organization_id).maybeSingle();
      if (!sub) return;
      const { data: plan } = await supabaseBrowser.from('plans').select('name, max_users').eq('id', sub.plan_id).maybeSingle();
      setLicense({
        status: String(sub.status ?? 'active'),
        planName: String(plan?.name ?? 'Entreprise'),
        maxUsers: Number(plan?.max_users ?? -1),
        trialEndsAt: sub.trial_ends_at ?? null,
        startedAt: sub.started_at ?? null,
      });
    })();
  }, [profile?.organization_id]);
  if (profile?.role === 'super_admin') {
    return <OperatorCockpit data={data} onEnterSupport={onEnterSupport} />;
  }
  if (!isAdmin(profile)) {
    return <section className={styles.panel}><p className={styles.empty}>Accès réservé aux administrateurs.</p></section>;
  }
  const q = query.trim().toLowerCase();
  const users = data.profiles.filter(user => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false;
    return !q || [user.name, user.email, user.role, user.role_label].join(' ').toLowerCase().includes(q);
  });
  const editorIsSuperAdmin = profile?.role === 'super_admin';
  const roleCounts = data.profiles.reduce((acc: Record<string, number>, user) => {
    const role = String(user.role ?? 'observateur');
    acc[role] = (acc[role] ?? 0) + 1;
    return acc;
  }, {});
  const seatUsed = data.profiles.filter(user => user.role && user.role !== 'observateur').length;
  const seatMax = license?.maxUsers ?? -1;
  const seatsLabel = seatMax === -1 ? `${data.profiles.length}` : `${seatUsed}/${seatMax}`;

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <button type="button" className={styles.pilotageKpiBtn} onClick={() => setPilotageTab('users')}>
          <Kpi title="Invitations" value={pendingInvites.length} hint="À traiter" tone={pendingInvites.length ? 'amber' : undefined} />
        </button>
        <button type="button" className={styles.pilotageKpiBtn} onClick={() => setPilotageTab('license')}>
          <Kpi title="Sièges" value={seatsLabel} hint={license?.planName ?? 'Licence'} />
        </button>
        <button type="button" className={styles.pilotageKpiBtn} onClick={() => setPilotageTab('companies')}>
          <Kpi title="Entreprises" value={data.companies.length} hint="Fiches orga" tone="green" />
        </button>
        <button type="button" className={styles.pilotageKpiBtn} onClick={() => setPilotageTab('license')}>
          <Kpi title="Licence" value={license?.status === 'active' ? 'Active' : license?.status ?? '—'} hint={`${data.chantiers.length} chantier(s)`} tone={license?.status === 'suspended' ? 'red' : undefined} />
        </button>
      </div>
      <div className={styles.pilotageTabs}>
        <button type="button" data-active={pilotageTab === 'users' ? 'true' : 'false'} onClick={() => setPilotageTab('users')}>Membres</button>
        <button type="button" data-active={pilotageTab === 'companies' ? 'true' : 'false'} onClick={() => setPilotageTab('companies')}>Entreprises</button>
        <button type="button" data-active={pilotageTab === 'license' ? 'true' : 'false'} onClick={() => setPilotageTab('license')}>Licence</button>
      </div>
      {pilotageTab === 'users' ? <>
      <section className={`${styles.panel} ${styles.pilotagePanel}`}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Inviter un membre</h2>
            <p>Email, rôle, entreprise. Trois étapes, un seul bouton.</p>
          </div>
          <ol className={styles.pilotageSteps}>
            <li data-active={inviteStep === 1 ? 'true' : 'false'}>Email</li>
            <li data-active={inviteStep === 2 ? 'true' : 'false'}>Rôle</li>
            <li data-active={inviteStep === 3 ? 'true' : 'false'}>Entreprise</li>
          </ol>
        </div>
        <form
          className={styles.pilotageInviteForm}
          onSubmit={async event => {
            event.preventDefault();
            if (inviteStep === 1) {
              if (!inviteEmail.includes('@')) return setInviteNotice('Email invalide.');
              setInviteNotice('');
              setInviteStep(2);
              return;
            }
            if (inviteStep === 2) {
              setInviteStep(inviteRole === 'admin' ? 3 : 3);
              return;
            }
            const email = inviteEmail.trim().toLowerCase();
            if (!email.includes('@')) return setInviteNotice('Email invalide.');
            if (inviteRole === 'sous_traitant' && !inviteCompanyId) return setInviteNotice('Une entreprise est obligatoire pour un sous-traitant.');
            if (seatMax !== -1 && seatUsed >= seatMax) return setInviteNotice(`Quota de sièges atteint (${seatUsed}/${seatMax}).`);
            setInviteBusy(true);
            setInviteNotice('');
            setInviteLink('');
            const { data, error } = await supabaseBrowser.rpc('admin_create_invitation', {
              p_email: email,
              p_role: inviteRole,
              p_company_id: inviteCompanyId || null,
              p_expires_at: null,
            });
            if (error || !data) {
              setInviteBusy(false);
              return setInviteNotice(error?.message ?? 'Impossible de créer l’invitation.');
            }
            const { data: authData } = await supabaseBrowser.auth.getSession();
            const mail = await fetch('/api/send-email', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(authData.session?.access_token ? { Authorization: `Bearer ${authData.session.access_token}` } : {}),
              },
              body: JSON.stringify({
                type: 'invitation',
                email,
                invitedByName: profile?.name ?? 'Admin',
                organizationName: 'BuildTrack',
                role: inviteRole,
                token: data.token,
                expiresAt: data.expires_at,
              }),
            }).catch(() => undefined);
            const link = `${window.location.origin}/invite?token=${encodeURIComponent(data.token)}`;
            setInviteEmail('');
            setInviteBusy(false);
            setInviteStep(1);
            if (!mail || !mail.ok) {
              setInviteLink(link);
              setInviteNotice('Invitation créée, mais l’e-mail n’est pas parti. Copiez le lien.');
            } else {
              setInviteLink(link);
              setInviteNotice(`Invitation envoyée à ${email}.`);
            }
            void loadInvites();
          }}
        >
          <div className={styles.pilotageInviteRow}>
            {inviteStep === 1 ? (
              <label>Email<input value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} type="email" required placeholder="prenom.nom@exemple.fr" /></label>
            ) : null}
            {inviteStep === 2 ? (
              <label>Rôle
                <select value={inviteRole} onChange={event => setInviteRole(event.target.value)}>
                  {Object.entries(ROLE_LABELS).filter(([value]) => value !== 'super_admin').map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {inviteStep === 3 ? (
              <label>Entreprise
                <select value={inviteCompanyId} onChange={event => setInviteCompanyId(event.target.value)}>
                  <option value="">Aucune</option>
                  {data.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            ) : null}
            <div className={styles.pilotageInviteActions}>
              {inviteStep > 1 ? <button type="button" className={styles.pilotageGhost} onClick={() => setInviteStep(inviteStep === 3 ? 2 : 1)}>Retour</button> : null}
              <button type="submit" className={styles.pilotagePrimary} disabled={inviteBusy}>{inviteBusy ? 'Envoi…' : inviteStep < 3 ? 'Continuer' : 'Inviter'}</button>
            </div>
          </div>
        </form>
        {inviteNotice ? <p className={styles.pilotageNotice}>{inviteNotice}</p> : null}
        {inviteLink ? (
          <div className={styles.pilotageInviteLink}>
            <input readOnly value={inviteLink} />
            <button type="button" className={styles.pilotageGhost} onClick={() => void navigator.clipboard.writeText(inviteLink)}>Copier le lien</button>
          </div>
        ) : null}
        {pendingInvites.length ? (
          <div className={styles.pilotageInviteList}>
            {pendingInvites.map(invite => (
              <article key={invite.id} className={styles.pilotageInviteCard}>
                <div>
                  <strong>{invite.email}</strong>
                  <span>
                    {ROLE_LABELS[invite.role] ?? invite.role}
                    {invite.expires_at ? ` · expire ${prettyDate(invite.expires_at)}` : ''}
                    {invite.resend_count ? ` · ${invite.resend_count} relance${invite.resend_count > 1 ? 's' : ''}` : ''}
                  </span>
                </div>
                <div className={styles.pilotageInviteActions}>
                  <button type="button" className={styles.pilotageGhost} onClick={async () => {
                    await supabaseBrowser.rpc('admin_resend_invitation', { p_invitation_id: invite.id });
                    void loadInvites();
                  }}>Relancer</button>
                  <button type="button" className={styles.pilotageDanger} onClick={async () => {
                    await supabaseBrowser.rpc('admin_delete_invitation', { p_invitation_id: invite.id });
                    void loadInvites();
                  }}>Annuler</button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
      <section className={`${styles.panel} ${styles.pilotagePanel}`}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Membres</h2>
            <p>Rôle, entreprise, puis les droits si besoin.</p>
          </div>
          <input className={styles.compactSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher un membre…" />
        </div>
        <div className={styles.pilotageRoleChips} role="tablist" aria-label="Filtrer par rôle">
          <button type="button" data-active={roleFilter === 'all' ? 'true' : 'false'} onClick={() => setRoleFilter('all')}>
            Tous <b>{data.profiles.length}</b>
          </button>
          {Object.entries(ROLE_LABELS).filter(([value]) => value !== 'super_admin').map(([value, label]) => (
            <button key={value} type="button" data-active={roleFilter === value ? 'true' : 'false'} onClick={() => setRoleFilter(value)}>
              {label} <b>{roleCounts[value] ?? 0}</b>
            </button>
          ))}
        </div>
        <div className={styles.adminPermissionLegend}>
          <span><i className={styles.permissionDefaultDot} /> Défaut du rôle</span>
          <span><i className={styles.permissionEnabledDot} /> Accord manuel</span>
          <span><i className={styles.permissionDisabledDot} /> Retrait manuel</span>
        </div>
        <div className={styles.pilotageMembers}>
          {users.map(user => {
            const targetEditable = editorIsSuperAdmin || (user.role !== 'admin' && user.role !== 'super_admin');
            const permissionsEditable = targetEditable && user.role !== 'super_admin';
            const overrides = profilePermissionsOverride(user) ?? {};
            const overrideCount = Object.keys(overrides).length;
            const roleDefaults = WEB_ROLE_PERMISSIONS[String(user.role)] ?? WEB_ROLE_PERMISSIONS.observateur;
            const expanded = expandedUserId === user.id;
            const roleOptions = Object.entries(ROLE_LABELS).filter(([value]) => editorIsSuperAdmin || (value !== 'admin' && value !== 'super_admin'));

            const updatePermission = (key: keyof WebPermissions) => {
              if (!permissionsEditable) return;
              const next = { ...overrides };
              const nextValue = cyclePermissionOverride(next[key]);
              if (nextValue === undefined) delete next[key];
              else next[key] = nextValue;
              void onUpdateProfile(user.id, { permissions_override: next });
            };

            return (
              <div key={user.id} className={styles.pilotageMember}>
                <div className={styles.pilotageMemberMain} role="button" tabIndex={0} onClick={() => setExpandedUserId(expanded ? null : user.id)} onKeyDown={event => { if (event.key === 'Enter') setExpandedUserId(expanded ? null : user.id); }}>
                  <span className={styles.pilotageAvatar}>{(user.name || user.email || '?').slice(0, 1).toUpperCase()}</span>
                  <div className={styles.pilotageMemberId}>
                    <strong>{user.name || 'Sans nom'}</strong>
                    <span>{user.email}</span>
                  </div>
                  <select disabled={!targetEditable} value={user.role ?? ''} onClick={event => event.stopPropagation()} onChange={event => void onUpdateProfile(user.id, { role: event.target.value })}>
                    {roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <select disabled={!targetEditable} value={user.company_id ?? ''} onClick={event => event.stopPropagation()} onChange={event => void onUpdateProfile(user.id, { company_id: event.target.value || null })}>
                    <option value="">Aucune entreprise</option>
                    {data.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <button
                    type="button"
                    className={styles.adminPermissionsButton}
                    onClick={event => { event.stopPropagation(); setRightsUserId(user.id); }}
                  >
                    {user.role === 'super_admin' ? 'Droits fixes' : 'Droits'}
                  </button>
                  {targetEditable && user.id !== profile?.id ? (
                    <button type="button" className={styles.pilotageDanger} onClick={event => {
                      event.stopPropagation();
                      if (window.confirm(`Retirer ${user.name || user.email} ?`)) void onRemoveUser?.(user.id);
                    }}>Retirer</button>
                  ) : null}
                </div>
                {false && expanded ? (
                  <div className={styles.adminPermissionsPanel}>
                    <div className={styles.adminPermissionsHeader}>
                      <div><strong>Permissions de {user.name}</strong><span>Cliquer : défaut → accordé → retiré → défaut</span></div>
                      {permissionsEditable && overrideCount > 0 ? <button type="button" onClick={() => void onUpdateProfile(user.id, { permissions_override: {} })}>Réinitialiser</button> : null}
                    </div>
                    <h3>Module Stock</h3>
                    <div className={styles.adminPermissionsGrid}>
                      {WEB_PERMISSION_DEFS.filter(item => item.inventory).map(item => {
                        const override = overrides[item.key];
                        const effective = override ?? roleDefaults[item.key];
                        return (
                          <button key={item.key} type="button" disabled={!permissionsEditable} className={override === true ? styles.permissionOverrideEnabled : override === false ? styles.permissionOverrideDisabled : styles.permissionRoleDefault} onClick={() => updatePermission(item.key)}>
                            <i className={effective ? styles.permissionEffectiveOn : styles.permissionEffectiveOff} />
                            <span><strong>{item.label}</strong><small>{item.description}</small></span>
                            <b>{override === true ? 'Accordé' : override === false ? 'Retiré' : roleDefaults[item.key] ? 'Par le rôle' : 'Désactivé'}</b>
                          </button>
                        );
                      })}
                    </div>
                    <h3>Autres modules BuildTrack</h3>
                    <div className={styles.adminPermissionsGrid}>
                      {WEB_PERMISSION_DEFS.filter(item => !item.inventory).map(item => {
                        const override = overrides[item.key];
                        const effective = override ?? roleDefaults[item.key];
                        return (
                          <button key={item.key} type="button" disabled={!permissionsEditable} className={override === true ? styles.permissionOverrideEnabled : override === false ? styles.permissionOverrideDisabled : styles.permissionRoleDefault} onClick={() => updatePermission(item.key)}>
                            <i className={effective ? styles.permissionEffectiveOn : styles.permissionEffectiveOff} />
                            <span><strong>{item.label}</strong><small>{item.description}</small></span>
                            <b>{override === true ? 'Accordé' : override === false ? 'Retiré' : roleDefaults[item.key] ? 'Par le rôle' : 'Désactivé'}</b>
                          </button>
                        );
                      })}
                    </div>
                    {user.role === 'magasinier' ? <p className={styles.adminWarehouseNote}>L’interface magasinier reste limitée au Stock et aux paramètres personnels, même si une permission d’un autre module est accordée par erreur.</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!users.length && <p className={styles.empty}>Aucun membre trouvé.</p>}
        </div>
      </section>
      </> : null}
      {rightsUserId ? (() => {
        const user = data.profiles.find(item => item.id === rightsUserId);
        if (!user) return null;
        const targetEditable = editorIsSuperAdmin || (user.role !== 'admin' && user.role !== 'super_admin');
        const permissionsEditable = targetEditable && user.role !== 'super_admin';
        const overrides = profilePermissionsOverride(user) ?? {};
        const overrideCount = Object.keys(overrides).length;
        const roleDefaults = WEB_ROLE_PERMISSIONS[String(user.role)] ?? WEB_ROLE_PERMISSIONS.observateur;
        const updatePermission = (key: keyof WebPermissions) => {
          if (!permissionsEditable) return;
          const next = { ...overrides };
          const nextValue = cyclePermissionOverride(next[key]);
          if (nextValue === undefined) delete next[key];
          else next[key] = nextValue;
          void onUpdateProfile(user.id, { permissions_override: next });
        };
        return (
          <div className={styles.pilotageRightsOverlay} role="dialog" aria-modal="true">
            <section className={styles.pilotageRightsSheet}>
              <header>
                <div>
                  <h2>Droits de {user.name || user.email}</h2>
                  <p>Cliquer : défaut → accordé → retiré → défaut</p>
                </div>
                <div className={styles.pilotageInviteActions}>
                  {permissionsEditable && overrideCount > 0 ? <button type="button" className={styles.pilotageGhost} onClick={() => void onUpdateProfile(user.id, { permissions_override: {} })}>Réinitialiser</button> : null}
                  <button type="button" className={styles.pilotagePrimary} onClick={() => setRightsUserId(null)}>Fermer</button>
                </div>
              </header>
              <h3>Module Stock</h3>
              <div className={styles.adminPermissionsGrid}>
                {WEB_PERMISSION_DEFS.filter(item => item.inventory).map(item => {
                  const override = overrides[item.key];
                  const effective = override ?? roleDefaults[item.key];
                  return (
                    <button key={item.key} type="button" disabled={!permissionsEditable} className={override === true ? styles.permissionOverrideEnabled : override === false ? styles.permissionOverrideDisabled : styles.permissionRoleDefault} onClick={() => updatePermission(item.key)}>
                      <i className={effective ? styles.permissionEffectiveOn : styles.permissionEffectiveOff} />
                      <span><strong>{item.label}</strong><small>{item.description}</small></span>
                      <b>{override === true ? 'Accordé' : override === false ? 'Retiré' : roleDefaults[item.key] ? 'Par le rôle' : 'Désactivé'}</b>
                    </button>
                  );
                })}
              </div>
              <h3>Autres modules BuildTrack</h3>
              <div className={styles.adminPermissionsGrid}>
                {WEB_PERMISSION_DEFS.filter(item => !item.inventory).map(item => {
                  const override = overrides[item.key];
                  const effective = override ?? roleDefaults[item.key];
                  return (
                    <button key={item.key} type="button" disabled={!permissionsEditable} className={override === true ? styles.permissionOverrideEnabled : override === false ? styles.permissionOverrideDisabled : styles.permissionRoleDefault} onClick={() => updatePermission(item.key)}>
                      <i className={effective ? styles.permissionEffectiveOn : styles.permissionEffectiveOff} />
                      <span><strong>{item.label}</strong><small>{item.description}</small></span>
                      <b>{override === true ? 'Accordé' : override === false ? 'Retiré' : roleDefaults[item.key] ? 'Par le rôle' : 'Désactivé'}</b>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        );
      })() : null}

      {pilotageTab === 'companies' ? (
        <section className={`${styles.panel} ${styles.pilotagePanel}`}>
          <div className={styles.panelHeaderCompact}>
            <div>
              <h2>Entreprises</h2>
              <p>Fiches orga : nom, contact, SIRET. Sans pointage ici.</p>
            </div>
          </div>
          <form className={styles.pilotageInviteForm} onSubmit={async event => {
            event.preventDefault();
            if (!companyDraft.name.trim()) return;
            if (editingCompanyId) {
              await onUpdateCompany?.(editingCompanyId, {
                name: companyDraft.name.trim(),
                short_name: companyDraft.short_name.trim() || companyDraft.name.trim().slice(0, 4).toUpperCase(),
                email: companyDraft.email || null,
                contact: companyDraft.contact,
                siret: companyDraft.siret || null,
                insurance: companyDraft.insurance || null,
                lots: companyDraft.lots,
              });
              setEditingCompanyId(null);
            } else {
              await onCreateCompany?.(companyDraft);
            }
            setCompanyDraft({ name: '', short_name: '', email: '', contact: '', siret: '', insurance: '', lots: [] });
          }}>
            <div className={styles.pilotageCompanyForm}>
              <label>Nom<input value={companyDraft.name} onChange={event => setCompanyDraft(prev => ({ ...prev, name: event.target.value }))} required /></label>
              <label>Sigle<input value={companyDraft.short_name} onChange={event => setCompanyDraft(prev => ({ ...prev, short_name: event.target.value }))} placeholder="ABC" /></label>
              <label>Email<input value={companyDraft.email} onChange={event => setCompanyDraft(prev => ({ ...prev, email: event.target.value }))} type="email" /></label>
              <label>Téléphone<input value={companyDraft.contact} onChange={event => setCompanyDraft(prev => ({ ...prev, contact: event.target.value }))} /></label>
              <label>SIRET<input value={companyDraft.siret} onChange={event => setCompanyDraft(prev => ({ ...prev, siret: event.target.value }))} /></label>
              <label>Assurance<input value={companyDraft.insurance} onChange={event => setCompanyDraft(prev => ({ ...prev, insurance: event.target.value }))} /></label>
              <button type="submit" className={styles.pilotagePrimary}>{editingCompanyId ? 'Enregistrer' : 'Ajouter'}</button>
            </div>
            {data.lots.length ? (
              <div className={styles.pilotageLotPicker}>
                {data.lots.map((lot: any) => {
                  const id = String(lot.id);
                  const active = companyDraft.lots.includes(id);
                  return (
                    <button key={id} type="button" data-active={active ? 'true' : 'false'} onClick={() => setCompanyDraft(prev => ({
                      ...prev,
                      lots: active ? prev.lots.filter(item => item !== id) : [...prev.lots, id],
                    }))}>{lot.code ? `${lot.code} · ${lot.name}` : lot.name}</button>
                  );
                })}
              </div>
            ) : null}
          </form>
          <div className={styles.pilotageInviteList}>
            {data.companies.map(company => (
              <article key={company.id} className={styles.pilotageInviteCard}>
                <div>
                  <strong>{company.name}</strong>
                  <span>{[company.short_name, company.email, company.contact, company.siret, company.insurance].filter(Boolean).join(' · ') || 'Sans contact'}</span>
                </div>
                <div className={styles.pilotageInviteActions}>
                  <button type="button" className={styles.pilotageGhost} onClick={() => {
                    setEditingCompanyId(company.id);
                    setCompanyDraft({
                      name: company.name ?? '',
                      short_name: company.short_name ?? '',
                      email: company.email ?? '',
                      contact: company.contact ?? '',
                      siret: company.siret ?? '',
                      insurance: company.insurance ?? '',
                      lots: Array.isArray(company.lots) ? company.lots.map(String) : [],
                    });
                  }}>Modifier</button>
                  <button type="button" className={styles.pilotageDanger} onClick={() => {
                    if (window.confirm(`Supprimer ${company.name} ?`)) void onDeleteCompany?.(company.id);
                  }}>Supprimer</button>
                </div>
              </article>
            ))}
            {!data.companies.length ? <p className={styles.empty}>Aucune entreprise.</p> : null}
          </div>
        </section>
      ) : null}

      {pilotageTab === 'license' ? (
        <section className={`${styles.panel} ${styles.pilotagePanel}`}>
          <div className={styles.panelHeaderCompact}>
            <div>
              <h2>Licence</h2>
              <p>{license?.planName ?? 'Plan'} · {license?.status ?? 'inconnu'}</p>
            </div>
          </div>
          {license?.status === 'trial' || license?.status === 'suspended' || license?.status === 'expired' ? (
            <div className={styles.pilotageLicenseBanner} data-tone={license.status}>
              <strong>{license.status === 'trial' ? 'Essai en cours' : license.status === 'suspended' ? 'Licence suspendue' : 'Licence expirée'}</strong>
              <span>
                {license.status === 'trial' && license.trialEndsAt
                  ? `Fin d’essai le ${prettyDate(license.trialEndsAt)}.`
                  : license.status === 'suspended'
                    ? 'Les invitations et certains accès peuvent être bloqués. Contactez le support.'
                    : 'Renouvelez la licence pour continuer à inviter des membres.'}
              </span>
            </div>
          ) : null}
          <div className={styles.pilotageLicense}>
            <article>
              <span>Sièges</span>
              <strong>{seatsLabel}</strong>
              <small>Observateurs hors quota</small>
            </article>
            <article>
              <span>Membres</span>
              <strong>{data.profiles.length}</strong>
              <small>{data.companies.length} entreprises</small>
            </article>
            <article>
              <span>Application</span>
              <a href="https://github.com/Admin-Adher/ApplicationMobile/releases/latest/download/buildtrack-release.apk">Télécharger l’APK</a>
            </article>
          </div>
        </section>
      ) : null}
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
