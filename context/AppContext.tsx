import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Reserve, Company, Task, Document, Photo, Message, Channel, Profile, Comment, ReserveStatus, ReservePriority, TaskStatus, Chantier, SitePlan, ChantierStatus, Visite, Lot, Opr, VisiteStatus, OprStatus, UserRole } from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { globalSeedingRef } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { initStorageBuckets } from '@/lib/storage';
import { C } from '@/constants/colors';
import { genId, nowTimestampFR, formatDateFR } from '@/lib/utils';
import { genReserveId } from '@/lib/reserveUtils';
import { ROLE_LABELS } from '@/constants/roles';
import { debugLog, debugLogOk, debugLogWarn, debugLogError } from '@/lib/debugLog';

export const STATIC_CHANNELS: Channel[] = [];

const CUSTOM_CHANNELS_KEY = 'customChannels_v1';
const GROUP_CHANNELS_KEY = 'groupChannels_v1';
const PINNED_CHANNELS_KEY = 'pinnedChannels_v1';
const CHANNEL_MEMBERS_OVERRIDE_KEY = 'channelMembersOverride_v1';
const MOCK_RESERVES_KEY = 'buildtrack_mock_reserves_v3';
const MOCK_TASKS_KEY = 'buildtrack_mock_tasks_v3';
const MOCK_PHOTOS_KEY = 'buildtrack_mock_photos_v4';
const MOCK_MESSAGES_KEY = 'buildtrack_mock_messages_v2';
const MOCK_CHANTIERS_KEY = 'buildtrack_mock_chantiers_v2';
const MOCK_SITE_PLANS_KEY = 'buildtrack_mock_site_plans_v2';
const MOCK_VISITES_KEY = 'buildtrack_mock_visites_v2';
const MOCK_LOTS_KEY = 'buildtrack_mock_lots_v2';
const MOCK_OPRS_KEY = 'buildtrack_mock_oprs_v2';
const MOCK_COMPANIES_KEY = 'buildtrack_mock_companies_v1';
const ACTIVE_CHANTIER_KEY = 'buildtrack_active_chantier_v2';
const PENDING_DM_KEY = 'buildtrack_pending_dm_channels_v1';
const MAX_PINNED = 5;

interface AppState {
  reserves: Reserve[];
  companies: Company[];
  tasks: Task[];
  documents: Document[];
  photos: Photo[];
  messages: Message[];
  lastReadByChannel: Record<string, string>;
  isLoading: boolean;
  profiles: Profile[];
  generalChannels: Channel[];
  customChannels: Channel[];
  groupChannels: Channel[];
  persistedDmChannels: Channel[];
  pinnedChannelIds: string[];
  channelMembersOverride: Record<string, string[]>;
  chantiers: Chantier[];
  sitePlans: SitePlan[];
  activeChantierId: string | null;
  visites: Visite[];
  lots: Lot[];
  oprs: Opr[];
}

type Action =
  | { type: 'INIT'; payload: Omit<AppState, 'isLoading' | 'lastReadByChannel' | 'generalChannels' | 'customChannels' | 'groupChannels' | 'persistedDmChannels' | 'pinnedChannelIds' | 'channelMembersOverride' | 'chantiers' | 'sitePlans' | 'activeChantierId' | 'visites' | 'lots' | 'oprs'> }
  | { type: 'SET_VISITES'; payload: Visite[] }
  | { type: 'ADD_VISITE'; payload: Visite }
  | { type: 'UPDATE_VISITE'; payload: Visite }
  | { type: 'DELETE_VISITE'; payload: string }
  | { type: 'SET_LOTS'; payload: Lot[] }
  | { type: 'ADD_LOT'; payload: Lot }
  | { type: 'UPDATE_LOT'; payload: Lot }
  | { type: 'DELETE_LOT'; payload: string }
  | { type: 'SET_OPRS'; payload: Opr[] }
  | { type: 'ADD_OPR'; payload: Opr }
  | { type: 'UPDATE_OPR'; payload: Opr }
  | { type: 'DELETE_OPR'; payload: string }
  | { type: 'ADD_CHANTIER'; payload: Chantier }
  | { type: 'UPDATE_CHANTIER'; payload: Chantier }
  | { type: 'DELETE_CHANTIER'; payload: string }
  | { type: 'ADD_SITE_PLAN'; payload: SitePlan }
  | { type: 'UPDATE_SITE_PLAN'; payload: SitePlan }
  | { type: 'DELETE_SITE_PLAN'; payload: string }
  | { type: 'SET_ACTIVE_CHANTIER'; payload: string | null }
  | { type: 'SET_CHANTIERS'; payload: Chantier[] }
  | { type: 'SET_SITE_PLANS'; payload: SitePlan[] }
  | { type: 'ADD_RESERVE'; payload: Reserve }
  | { type: 'UPDATE_RESERVE'; payload: Reserve }
  | { type: 'UPDATE_RESERVE_STATUS'; payload: Reserve }
  | { type: 'ADD_COMMENT'; payload: { reserveId: string; comment: Comment } }
  | { type: 'ADD_COMPANY'; payload: Company }
  | { type: 'UPDATE_COMPANY'; payload: { id: string; actualWorkers: number } }
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'INCOMING_MESSAGE'; payload: Message }
  | { type: 'DELETE_MESSAGE'; payload: string }
  | { type: 'RESTORE_MESSAGES'; payload: Message[] }
  | { type: 'UPDATE_MESSAGE'; payload: Message }
  | { type: 'MARK_MESSAGES_READ' }
  | { type: 'MARK_CHANNEL_READ_BY'; payload: { channelId: string; userName: string } }
  | { type: 'SET_CHANNEL_READ'; payload: { channelId: string; timestamp: string } }
  | { type: 'SET_LAST_READ'; payload: Record<string, string> }
  | { type: 'ADD_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: Task }
  | { type: 'DELETE_TASK'; payload: string }
  | { type: 'ADD_TASK_COMMENT'; payload: { taskId: string; comment: Comment } }
  | { type: 'ADD_PHOTO'; payload: Photo }
  | { type: 'ADD_DOCUMENT'; payload: Document }
  | { type: 'DELETE_DOCUMENT'; payload: string }
  | { type: 'DELETE_PHOTO'; payload: string }
  | { type: 'DELETE_RESERVE'; payload: string }
  | { type: 'UPDATE_RESERVE_FIELDS'; payload: Reserve }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_GENERAL_CHANNELS'; payload: Channel[] }
  | { type: 'ADD_CUSTOM_CHANNEL'; payload: Channel }
  | { type: 'SET_CUSTOM_CHANNELS'; payload: Channel[] }
  | { type: 'REMOVE_CUSTOM_CHANNEL'; payload: string }
  | { type: 'ADD_GROUP_CHANNEL'; payload: Channel }
  | { type: 'SET_GROUP_CHANNELS'; payload: Channel[] }
  | { type: 'REMOVE_GROUP_CHANNEL'; payload: string }
  | { type: 'SET_PERSISTED_DM_CHANNELS'; payload: Channel[] }
  | { type: 'ADD_PERSISTED_DM_CHANNEL'; payload: Channel }
  | { type: 'UPDATE_CHANNEL'; payload: Channel }
  | { type: 'SET_PINNED_CHANNELS'; payload: string[] }
  | { type: 'UPDATE_COMPANY_FULL'; payload: Company }
  | { type: 'DELETE_COMPANY'; payload: string }
  | { type: 'UPDATE_COMPANY_HOURS'; payload: { id: string; hours: number } }
  | { type: 'SET_CHANNEL_MEMBERS_OVERRIDE'; payload: Record<string, string[]> }
  | { type: 'BATCH_UPDATE_RESERVES'; payload: Reserve[] }
  | { type: 'PREPEND_MESSAGES'; payload: Message[] }
  | { type: 'SET_CHANNEL_MESSAGES'; payload: { channelId: string; messages: Message[] } }
  | { type: 'REMAP_DM_CHANNEL'; payload: { fromId: string; toId: string } };

function toReserve(row: any): Reserve {
  const companies: string[] = Array.isArray(row.companies) && row.companies.length > 0
    ? row.companies
    : row.company
      ? [row.company]
      : [];
  return {
    id: row.id, title: row.title, description: row.description, building: row.building,
    zone: row.zone, level: row.level,
    companies,
    company: companies[0] ?? row.company,
    priority: row.priority as ReservePriority,
    status: row.status as ReserveStatus, createdAt: row.created_at, deadline: row.deadline,
    comments: row.comments ?? [], history: row.history ?? [],
    planX: row.plan_x, planY: row.plan_y, photoUri: row.photo_uri ?? undefined,
    photoAnnotations: row.photo_annotations ?? undefined,
    closedAt: row.closed_at ?? undefined, closedBy: row.closed_by ?? undefined,
    photos: row.photos ?? undefined,
    lotId: row.lot_id ?? undefined,
    kind: row.kind ?? undefined,
    chantierId: row.chantier_id ?? undefined,
    planId: row.plan_id ?? undefined,
    visiteId: row.visite_id ?? undefined,
    linkedTaskId: row.linked_task_id ?? undefined,
    enterpriseSignature: row.enterprise_signature ?? undefined,
    enterpriseSignataire: row.enterprise_signataire ?? undefined,
    enterpriseAcknowledgedAt: row.enterprise_acknowledged_at ?? undefined,
    companySignatures: row.company_signatures ?? undefined,
  };
}

function toCompany(row: any): Company {
  return {
    id: row.id, name: row.name, shortName: row.short_name, color: row.color,
    plannedWorkers: row.planned_workers, actualWorkers: row.actual_workers,
    hoursWorked: row.hours_worked, zone: row.zone, phone: row.contact ?? undefined,
    email: row.email ?? undefined,
    lots: Array.isArray(row.lots) ? row.lots : (row.lots ? [row.lots] : undefined),
    siret: row.siret ?? undefined,
    insurance: row.insurance ?? undefined,
    qualifications: row.qualifications ?? undefined,
  };
}

function toTask(row: any): Task {
  return {
    id: row.id, title: row.title, description: row.description, status: row.status as TaskStatus,
    priority: row.priority as ReservePriority, startDate: row.start_date ?? undefined,
    deadline: row.deadline, assignee: row.assignee, progress: row.progress, company: row.company,
    reserveId: row.reserve_id ?? row.reserveId ?? undefined,
    comments: row.comments ?? [],
    history: row.history ?? [],
    chantierId: row.chantier_id ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

function toDocument(row: any): Document {
  return {
    id: row.id, name: row.name, type: row.type, category: row.category,
    uploadedAt: row.uploaded_at, size: row.size, version: row.version, uri: row.uri ?? undefined,
  };
}

function toPhoto(row: any): Photo {
  return {
    id: row.id, comment: row.comment, location: row.location,
    takenAt: row.taken_at, takenBy: row.taken_by, colorCode: row.color_code, uri: row.uri ?? undefined,
    reserveId: row.reserve_id ?? undefined,
  };
}

function toVisite(row: any): Visite {
  return {
    id: row.id,
    chantierId: row.chantier_id,
    title: row.title,
    date: row.date,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    conducteur: row.conducteur,
    status: row.status as VisiteStatus,
    visitType: row.visit_type ?? undefined,
    concernedCompanyIds: row.concerned_company_ids ?? undefined,
    building: row.building ?? undefined,
    level: row.level ?? undefined,
    zone: row.zone ?? undefined,
    notes: row.notes ?? undefined,
    tags: row.tags ?? undefined,
    coverPhotoUri: row.cover_photo_uri ?? undefined,
    defaultPlanId: row.default_plan_id ?? undefined,
    checklistItems: row.checklist_items ?? undefined,
    reserveDeadlineDate: row.reserve_deadline_date ?? undefined,
    reserveIds: row.reserve_ids ?? [],
    createdAt: row.created_at,
    conducteurSignature: row.conducteur_signature ?? undefined,
    entrepriseSignature: row.entreprise_signature ?? undefined,
    signedAt: row.signed_at ?? undefined,
    entrepriseSignataire: row.entreprise_signataire ?? undefined,
    participants: row.participants ?? undefined,
  };
}

function fromVisite(v: Visite, orgId?: string | null): Record<string, any> {
  return {
    id: v.id, chantier_id: v.chantierId, title: v.title, date: v.date,
    start_time: v.startTime ?? null,
    end_time: v.endTime ?? null,
    conducteur: v.conducteur, status: v.status,
    visit_type: v.visitType ?? null,
    concerned_company_ids: v.concernedCompanyIds ?? null,
    building: v.building ?? null, level: v.level ?? null, zone: v.zone ?? null,
    notes: v.notes ?? null,
    tags: v.tags ?? null,
    cover_photo_uri: v.coverPhotoUri ?? null,
    default_plan_id: v.defaultPlanId ?? null,
    checklist_items: v.checklistItems ?? null,
    reserve_deadline_date: v.reserveDeadlineDate ?? null,
    reserve_ids: v.reserveIds, created_at: v.createdAt,
    conducteur_signature: v.conducteurSignature ?? null,
    entreprise_signature: v.entrepriseSignature ?? null,
    signed_at: v.signedAt ?? null,
    entreprise_signataire: v.entrepriseSignataire ?? null,
    participants: v.participants ?? null,
    organization_id: orgId ?? null,
  };
}

function toLot(row: any): Lot {
  return {
    id: row.id, code: row.code, name: row.name, color: row.color,
    chantierId: row.chantier_id ?? undefined,
    companyId: row.company_id ?? undefined,
    cctpRef: row.cctp_ref ?? undefined,
    number: row.number ?? undefined,
  };
}

function fromLot(l: Lot, orgId?: string | null): Record<string, any> {
  return {
    id: l.id, code: l.code, name: l.name, color: l.color,
    chantier_id: l.chantierId ?? null,
    company_id: l.companyId ?? null,
    cctp_ref: l.cctpRef ?? null,
    number: l.number ?? null,
    organization_id: orgId ?? null,
  };
}

function toOpr(row: any): Opr {
  return {
    id: row.id, chantierId: row.chantier_id, title: row.title,
    date: row.date, building: row.building, level: row.level,
    zone: row.zone ?? undefined,
    conducteur: row.conducteur, status: row.status as OprStatus,
    items: row.items ?? [],
    signedBy: row.signed_by ?? undefined,
    signedAt: row.signed_at ?? undefined,
    maireOuvrage: row.maire_ouvrage ?? undefined,
    conducteurSignature: row.conducteur_signature ?? undefined,
    moSignature: row.mo_signature ?? undefined,
    createdAt: row.created_at,
    visitContradictoire: row.visit_contradictoire ?? undefined,
    visitParticipants: row.visit_participants ?? undefined,
    signatories: row.signatories ?? undefined,
    invitedEmails: row.invited_emails ?? undefined,
    sessionToken: row.session_token ?? undefined,
  };
}

function fromOpr(o: Opr, orgId?: string | null): Record<string, any> {
  return {
    id: o.id, chantier_id: o.chantierId, title: o.title,
    date: o.date, building: o.building, level: o.level,
    zone: o.zone ?? null,
    conducteur: o.conducteur, status: o.status,
    items: o.items, signed_by: o.signedBy ?? null, signed_at: o.signedAt ?? null,
    maire_ouvrage: o.maireOuvrage ?? null,
    conducteur_signature: o.conducteurSignature ?? null,
    mo_signature: o.moSignature ?? null,
    created_at: o.createdAt,
    visit_contradictoire: o.visitContradictoire ?? null,
    visit_participants: o.visitParticipants ?? null,
    signatories: o.signatories ?? null,
    invited_emails: o.invitedEmails ?? null,
    session_token: o.sessionToken ?? null,
    organization_id: orgId ?? null,
  };
}

function toChantier(row: any): Chantier {
  let buildings = undefined;
  if (row.buildings) {
    try {
      buildings = typeof row.buildings === 'string' ? JSON.parse(row.buildings) : row.buildings;
    } catch { buildings = undefined; }
  }
  return {
    id: row.id,
    name: row.name,
    address: row.address ?? undefined,
    description: row.description ?? undefined,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    status: row.status as ChantierStatus,
    createdAt: row.created_at,
    createdBy: row.created_by ?? '',
    companyIds: Array.isArray(row.company_ids) ? row.company_ids : undefined,
    buildings: Array.isArray(buildings) ? buildings : undefined,
  };
}

function toSitePlan(row: any): SitePlan {
  return {
    id: row.id,
    chantierId: row.chantier_id,
    name: row.name,
    building: row.building ?? undefined,
    level: row.level ?? undefined,
    buildingId: row.building_id ?? undefined,
    levelId: row.level_id ?? undefined,
    uri: row.uri ?? undefined,
    fileType: row.file_type ?? undefined,
    dxfName: row.dxf_name ?? undefined,
    uploadedAt: row.uploaded_at ?? row.created_at,
    size: row.size ?? undefined,
    revisionCode: row.revision_code ?? undefined,
    revisionNumber: row.revision_number ?? undefined,
    parentPlanId: row.parent_plan_id ?? undefined,
    isLatestRevision: row.is_latest_revision ?? undefined,
    revisionNote: row.revision_note ?? undefined,
    annotations: row.annotations ?? undefined,
    pdfPageCount: row.pdf_page_count ?? undefined,
  };
}

/**
 * Réconciliation des plans legacy : assigne buildingId / levelId aux plans
 * qui n'ont que les noms textuels (building / level) en les faisant correspondre
 * à la hiérarchie du chantier. Exécuté une seule fois au chargement.
 * Retourne la liste complète mise à jour + les seuls plans modifiés.
 */
function reconcilePlanIds(
  plans: SitePlan[],
  chantiersList: Chantier[]
): { plans: SitePlan[]; changed: SitePlan[] } {
  const changed: SitePlan[] = [];
  const reconciled = plans.map(p => {
    const chantier = chantiersList.find(c => c.id === p.chantierId);
    if (!chantier?.buildings?.length) return p;

    let updated = { ...p };
    let dirty = false;

    if (!p.buildingId && p.building) {
      const matchedBuilding = chantier.buildings.find(b => b.name === p.building);
      if (matchedBuilding) {
        updated.buildingId = matchedBuilding.id;
        dirty = true;
        if (!p.levelId && p.level) {
          const matchedLevel = matchedBuilding.levels.find(l => l.name === p.level);
          if (matchedLevel) updated.levelId = matchedLevel.id;
        }
      }
    } else if (p.buildingId && !p.levelId && p.level) {
      const matchedBuilding = chantier.buildings.find(b => b.id === p.buildingId);
      if (matchedBuilding) {
        const matchedLevel = matchedBuilding.levels.find(l => l.name === p.level);
        if (matchedLevel) {
          updated.levelId = matchedLevel.id;
          dirty = true;
        }
      }
    }

    if (dirty) changed.push(updated);
    return dirty ? updated : p;
  });
  return { plans: reconciled, changed };
}

export function toMessage(row: any, currentUserName?: string): Message {
  const isMe = currentUserName
    ? row.sender === currentUserName
    : (row.is_me ?? false);
  return {
    id: row.id,
    channelId: row.channel_id ?? 'general',
    sender: row.sender,
    content: row.content,
    timestamp: row.timestamp,
    type: row.type,
    read: row.read,
    isMe,
    replyToId: row.reply_to_id ?? undefined,
    replyToContent: row.reply_to_content ?? undefined,
    replyToSender: row.reply_to_sender ?? undefined,
    attachmentUri: row.attachment_uri ?? undefined,
    reactions: row.reactions ?? {},
    isPinned: row.is_pinned ?? false,
    readBy: row.read_by ?? [],
    mentions: row.mentions ?? [],
    reserveId: row.reserve_id ?? undefined,
    linkedItemType: row.linked_item_type ?? undefined,
    linkedItemId: row.linked_item_id ?? undefined,
    linkedItemTitle: row.linked_item_title ?? undefined,
    dbCreatedAt: row.created_at ?? undefined,
  };
}

function fromMessage(m: Message): Record<string, any> {
  const row: Record<string, any> = {
    id: m.id, channel_id: m.channelId, sender: m.sender, content: m.content,
    timestamp: m.timestamp, type: m.type, read: m.read,
    reply_to_id: m.replyToId ?? null, reply_to_content: m.replyToContent ?? null,
    reply_to_sender: m.replyToSender ?? null, attachment_uri: m.attachmentUri ?? null,
    reactions: m.reactions, is_pinned: m.isPinned, read_by: m.readBy,
    mentions: m.mentions, reserve_id: m.reserveId ?? null,
  };
  if (m.linkedItemType != null) row.linked_item_type = m.linkedItemType;
  if (m.linkedItemId != null) row.linked_item_id = m.linkedItemId;
  if (m.linkedItemTitle != null) row.linked_item_title = m.linkedItemTitle;
  return row;
}

export function dmChannelId(nameA: string, nameB: string): string {
  return 'dm-' + [nameA, nameB].sort().join('__');
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT': {
      const seenCompanyIds = new Set<string>();
      const seenCompanyNames = new Set<string>();
      const dedupedCompanies = (action.payload.companies ?? []).filter(c => {
        const nameKey = c.name.trim().toLowerCase();
        if (seenCompanyIds.has(c.id) || seenCompanyNames.has(nameKey)) return false;
        seenCompanyIds.add(c.id);
        seenCompanyNames.add(nameKey);
        return true;
      });
      return {
        ...action.payload,
        companies: dedupedCompanies,
        lastReadByChannel: state.lastReadByChannel,
        generalChannels: state.generalChannels ?? [],
        persistedDmChannels: state.persistedDmChannels ?? [],
        customChannels: state.customChannels ?? [],
        groupChannels: state.groupChannels ?? [],
        pinnedChannelIds: state.pinnedChannelIds ?? [],
        channelMembersOverride: state.channelMembersOverride ?? {},
        chantiers: state.chantiers ?? [],
        sitePlans: state.sitePlans ?? [],
        activeChantierId: state.activeChantierId,
        visites: state.visites ?? [],
        lots: state.lots ?? [],
        oprs: state.oprs ?? [],
        isLoading: false,
      };
    }

    case 'SET_VISITES': return { ...state, visites: action.payload ?? [] };
    case 'ADD_VISITE':
      if ((state.visites ?? []).some(v => v.id === action.payload.id)) return state;
      return { ...state, visites: [action.payload, ...(state.visites ?? [])] };
    case 'UPDATE_VISITE': return { ...state, visites: (state.visites ?? []).map(v => v.id === action.payload.id ? action.payload : v) };
    case 'DELETE_VISITE': return { ...state, visites: (state.visites ?? []).filter(v => v.id !== action.payload) };

    case 'SET_LOTS': return { ...state, lots: action.payload ?? [] };
    case 'ADD_LOT':
      if ((state.lots ?? []).some(l => l.id === action.payload.id)) return state;
      return { ...state, lots: [...(state.lots ?? []), action.payload] };
    case 'UPDATE_LOT': return { ...state, lots: (state.lots ?? []).map(l => l.id === action.payload.id ? action.payload : l) };
    case 'DELETE_LOT': return { ...state, lots: (state.lots ?? []).filter(l => l.id !== action.payload) };

    case 'SET_OPRS': return { ...state, oprs: action.payload ?? [] };
    case 'ADD_OPR':
      if ((state.oprs ?? []).some(o => o.id === action.payload.id)) return state;
      return { ...state, oprs: [action.payload, ...(state.oprs ?? [])] };
    case 'UPDATE_OPR': return { ...state, oprs: (state.oprs ?? []).map(o => o.id === action.payload.id ? action.payload : o) };
    case 'DELETE_OPR': return { ...state, oprs: (state.oprs ?? []).filter(o => o.id !== action.payload) };

    case 'ADD_CHANTIER':
      if (state.chantiers.some(c => c.id === action.payload.id)) return state;
      return { ...state, chantiers: [...state.chantiers, action.payload] };

    case 'UPDATE_CHANTIER':
      return { ...state, chantiers: state.chantiers.map(c => c.id === action.payload.id ? action.payload : c) };

    case 'DELETE_CHANTIER': {
      const deletedReserveIds = new Set(
        state.reserves.filter(r => r.chantierId === action.payload).map(r => r.id)
      );
      return {
        ...state,
        chantiers: state.chantiers.filter(c => c.id !== action.payload),
        sitePlans: state.sitePlans.filter(p => p.chantierId !== action.payload),
        reserves: state.reserves.filter(r => r.chantierId !== action.payload),
        tasks: state.tasks.filter(t => t.chantierId !== action.payload),
        visites: (state.visites ?? []).filter(v => v.chantierId !== action.payload),
        lots: (state.lots ?? []).filter(l => l.chantierId !== action.payload),
        oprs: (state.oprs ?? []).filter(o => o.chantierId !== action.payload),
        photos: state.photos.filter(p => !deletedReserveIds.has(p.reserveId ?? '')),
        activeChantierId: state.activeChantierId === action.payload
          ? (state.chantiers.find(c => c.id !== action.payload)?.id ?? null)
          : state.activeChantierId,
      };
    }

    case 'ADD_SITE_PLAN':
      if (state.sitePlans.some(p => p.id === action.payload.id)) return state;
      return { ...state, sitePlans: [...state.sitePlans, action.payload] };

    case 'UPDATE_SITE_PLAN':
      return { ...state, sitePlans: state.sitePlans.map(p => p.id === action.payload.id ? action.payload : p) };

    case 'DELETE_SITE_PLAN':
      return { ...state, sitePlans: state.sitePlans.filter(p => p.id !== action.payload) };

    case 'SET_ACTIVE_CHANTIER':
      return { ...state, activeChantierId: action.payload };

    case 'SET_CHANTIERS':
      return { ...state, chantiers: action.payload ?? [] };

    case 'SET_SITE_PLANS':
      return { ...state, sitePlans: action.payload ?? [] };

    case 'ADD_RESERVE':
      if (state.reserves.some(r => r.id === action.payload.id)) return state;
      return { ...state, reserves: [action.payload, ...state.reserves] };

    case 'UPDATE_RESERVE':
    case 'UPDATE_RESERVE_STATUS':
    case 'UPDATE_RESERVE_FIELDS':
      return { ...state, reserves: state.reserves.map(r => r.id === action.payload.id ? action.payload : r) };

    case 'DELETE_RESERVE':
      return { ...state, reserves: state.reserves.filter(r => r.id !== action.payload) };

    case 'ADD_COMMENT': {
      const { reserveId, comment } = action.payload;
      return {
        ...state,
        reserves: state.reserves.map(r =>
          r.id === reserveId ? { ...r, comments: [...r.comments, comment] } : r
        ),
      };
    }

    case 'ADD_COMPANY': {
      const nameKey = action.payload.name.trim().toLowerCase();
      if (state.companies.some(c => c.id === action.payload.id || c.name.trim().toLowerCase() === nameKey)) return state;
      return { ...state, companies: [...state.companies, action.payload] };
    }

    case 'UPDATE_COMPANY':
      return {
        ...state,
        companies: state.companies.map(c =>
          c.id === action.payload.id ? { ...c, actualWorkers: action.payload.actualWorkers } : c
        ),
      };

    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };

    case 'INCOMING_MESSAGE':
      if (state.messages.find(m => m.id === action.payload.id)) return state;
      return { ...state, messages: [...state.messages, action.payload] };

    case 'DELETE_MESSAGE':
      return { ...state, messages: state.messages.filter(m => m.id !== action.payload) };

    case 'RESTORE_MESSAGES':
      return { ...state, messages: action.payload };

    case 'PREPEND_MESSAGES': {
      const existingIds = new Set(state.messages.map(m => m.id));
      const newOnes = action.payload.filter(m => !existingIds.has(m.id));
      if (newOnes.length === 0) return state;
      return { ...state, messages: [...newOnes, ...state.messages] };
    }

    case 'SET_CHANNEL_MESSAGES': {
      const { channelId, messages: newMsgs } = action.payload;
      const otherChannelMsgs = state.messages.filter(m => m.channelId !== channelId);
      const newIds = new Set(newMsgs.map(m => m.id));
      const realtimeExtras = state.messages.filter(m => m.channelId === channelId && !newIds.has(m.id));
      return { ...state, messages: [...otherChannelMsgs, ...newMsgs, ...realtimeExtras] };
    }

    case 'REMAP_DM_CHANNEL': {
      const { fromId, toId } = action.payload;
      if (!state.messages.some(m => m.channelId === fromId)) return state;
      return {
        ...state,
        messages: state.messages.map(m =>
          m.channelId === fromId ? { ...m, channelId: toId } : m
        ),
      };
    }

    case 'UPDATE_MESSAGE':
      return { ...state, messages: state.messages.map(m => m.id === action.payload.id ? action.payload : m) };

    case 'MARK_MESSAGES_READ':
      return { ...state, messages: state.messages.map(m => ({ ...m, read: true })) };
    case 'MARK_CHANNEL_READ_BY': {
      const { channelId: cId, userName: uName } = action.payload;
      return {
        ...state,
        messages: state.messages.map(m => {
          if (m.channelId !== cId || m.isMe) return m;
          if (m.readBy.includes(uName)) return m;
          return { ...m, readBy: [...m.readBy, uName] };
        }),
      };
    }

    case 'SET_CHANNEL_READ': {
      const newLastRead = { ...state.lastReadByChannel, [action.payload.channelId]: action.payload.timestamp };
      AsyncStorage.setItem('lastReadByChannel', JSON.stringify(newLastRead)).catch(() => {});
      return { ...state, lastReadByChannel: newLastRead };
    }

    case 'SET_LAST_READ':
      return { ...state, lastReadByChannel: action.payload };

    case 'ADD_TASK':
      if (state.tasks.some(t => t.id === action.payload.id)) return state;
      return { ...state, tasks: [action.payload, ...state.tasks] };

    case 'UPDATE_TASK':
      return { ...state, tasks: state.tasks.map(t => t.id === action.payload.id ? action.payload : t) };

    case 'DELETE_TASK':
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.payload) };

    case 'ADD_TASK_COMMENT': {
      const { taskId, comment } = action.payload;
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === taskId ? { ...t, comments: [...(t.comments ?? []), comment] } : t
        ),
      };
    }

    case 'ADD_PHOTO':
      if (state.photos.some(p => p.id === action.payload.id)) return state;
      return { ...state, photos: [action.payload, ...state.photos] };

    case 'ADD_DOCUMENT':
      if (state.documents.some(d => d.id === action.payload.id)) return state;
      return { ...state, documents: [action.payload, ...state.documents] };

    case 'DELETE_DOCUMENT':
      return { ...state, documents: state.documents.filter(d => d.id !== action.payload) };

    case 'DELETE_PHOTO':
      return { ...state, photos: state.photos.filter(p => p.id !== action.payload) };

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'ADD_CUSTOM_CHANNEL':
      return { ...state, customChannels: [...state.customChannels, action.payload] };

    case 'SET_GENERAL_CHANNELS':
      return { ...state, generalChannels: action.payload ?? [] };

    case 'SET_CUSTOM_CHANNELS':
      return { ...state, customChannels: action.payload ?? [] };

    case 'REMOVE_CUSTOM_CHANNEL':
      return { ...state, customChannels: (state.customChannels ?? []).filter(c => c.id !== action.payload) };

    case 'ADD_GROUP_CHANNEL':
      if ((state.groupChannels ?? []).some(c => c.id === action.payload.id)) return state;
      return { ...state, groupChannels: [...(state.groupChannels ?? []), action.payload] };

    case 'SET_GROUP_CHANNELS':
      return { ...state, groupChannels: action.payload ?? [] };

    case 'REMOVE_GROUP_CHANNEL':
      return { ...state, groupChannels: (state.groupChannels ?? []).filter(c => c.id !== action.payload) };

    case 'SET_PERSISTED_DM_CHANNELS':
      return { ...state, persistedDmChannels: action.payload ?? [] };

    case 'ADD_PERSISTED_DM_CHANNEL':
      if ((state.persistedDmChannels ?? []).some(c => c.id === action.payload.id)) return state;
      return { ...state, persistedDmChannels: [...(state.persistedDmChannels ?? []), action.payload] };

    case 'UPDATE_CHANNEL': {
      const ch = action.payload;
      if (ch.type === 'general' || ch.type === 'building') {
        return { ...state, generalChannels: (state.generalChannels ?? []).map(c => c.id === ch.id ? ch : c) };
      }
      if (ch.type === 'custom') {
        return { ...state, customChannels: (state.customChannels ?? []).map(c => c.id === ch.id ? ch : c) };
      }
      if (ch.type === 'group') {
        return { ...state, groupChannels: (state.groupChannels ?? []).map(c => c.id === ch.id ? ch : c) };
      }
      if (ch.type === 'dm') {
        return { ...state, persistedDmChannels: (state.persistedDmChannels ?? []).map(c => c.id === ch.id ? ch : c) };
      }
      return state;
    }

    case 'SET_PINNED_CHANNELS':
      return { ...state, pinnedChannelIds: action.payload ?? [] };

    case 'UPDATE_COMPANY_FULL':
      return { ...state, companies: state.companies.map(co => co.id === action.payload.id ? action.payload : co) };

    case 'DELETE_COMPANY':
      return { ...state, companies: state.companies.filter(c => c.id !== action.payload) };

    case 'UPDATE_COMPANY_HOURS':
      return {
        ...state,
        companies: state.companies.map(c =>
          c.id === action.payload.id ? { ...c, hoursWorked: action.payload.hours } : c
        ),
      };

    case 'SET_CHANNEL_MEMBERS_OVERRIDE':
      return { ...state, channelMembersOverride: action.payload };

    case 'BATCH_UPDATE_RESERVES': {
      const updatedMap = new Map(action.payload.map(r => [r.id, r]));
      return {
        ...state,
        reserves: state.reserves.map(r => updatedMap.has(r.id) ? updatedMap.get(r.id)! : r),
      };
    }

    default:
      return state;
  }
}

interface AppContextValue extends AppState {
  channels: Channel[];
  unreadByChannel: Record<string, number>;
  notification: { msg: Message; channelName: string; channelColor: string; channelIcon: string } | null;
  activeChantier: Chantier | null;
  addChantier: (c: Chantier, plans: SitePlan[]) => void;
  updateChantier: (c: Chantier) => void;
  deleteChantier: (id: string) => void;
  setActiveChantier: (id: string) => void;
  addSitePlan: (p: SitePlan) => void;
  updateSitePlan: (p: SitePlan) => void;
  deleteSitePlan: (id: string) => void;
  addReserve: (r: Reserve) => void;
  updateReserve: (r: Reserve) => void;
  updateReserveFields: (r: Reserve) => void;
  deleteReserve: (id: string) => void;
  updateReserveStatus: (id: string, status: ReserveStatus, author?: string) => void;
  addComment: (reserveId: string, content: string, author?: string) => void;
  addCompany: (c: Company) => void;
  updateCompanyWorkers: (id: string, actual: number) => void;
  updateCompanyFull: (c: Company) => void;
  deleteCompany: (id: string) => void;
  updateCompanyHours: (id: string, hours: number) => void;
  reload: () => void;
  setCurrentUser: (name: string) => void;
  addMessage: (channelId: string, content: string, options?: Partial<Pick<Message, 'replyToId' | 'replyToContent' | 'replyToSender' | 'attachmentUri' | 'mentions' | 'reserveId' | 'linkedItemType' | 'linkedItemId' | 'linkedItemTitle'>>, sender?: string) => void;
  incomingMessage: (msg: Message) => void;
  deleteMessage: (id: string) => void;
  updateMessage: (msg: Message) => void;
  toggleReaction: (emoji: string, msg: Message, userName: string) => void;
  markMessagesRead: () => void;
  setChannelRead: (channelId: string) => void;
  setActiveChannelId: (id: string | null) => void;
  dismissNotification: () => void;
  addTask: (t: Task) => void;
  updateTask: (t: Task) => void;
  deleteTask: (id: string) => void;
  addTaskComment: (taskId: string, content: string, author?: string) => void;
  addPhoto: (p: Photo) => void;
  deletePhoto: (id: string) => void;
  addDocument: (d: Document) => void;
  deleteDocument: (id: string) => void;
  addCustomChannel: (name: string, description: string, icon: string, color: string) => Channel;
  removeCustomChannel: (id: string) => void;
  addGroupChannel: (name: string, members: string[], color: string) => Channel;
  removeGroupChannel: (id: string) => void;
  renameChannel: (id: string, newName: string) => void;
  updateCustomChannel: (id: string, updates: Partial<Pick<Channel, 'name' | 'description' | 'icon' | 'color'>>) => void;
  addChannelMember: (id: string, memberName: string) => void;
  removeChannelMember: (id: string, memberName: string) => void;
  pinChannel: (id: string) => { success: boolean; reason?: string };
  unpinChannel: (id: string) => void;
  maxPinnedChannels: number;
  getOrCreateDMChannel: (otherName: string) => Channel;
  fetchOlderMessages: (channelId: string, beforeCreatedAt: string) => Promise<boolean>;
  fetchChannelMessages: (channelId: string) => Promise<void>;
  refreshChannelMessages: (channelId: string) => Promise<void>;
  unreadCount: number;
  stats: {
    total: number; open: number; inProgress: number;
    waiting: number; verification: number; closed: number;
    progress: number; totalWorkers: number; plannedWorkers: number;
  };
  addVisite: (v: Visite) => void;
  updateVisite: (v: Visite) => void;
  deleteVisite: (id: string) => void;
  linkReserveToVisite: (reserveId: string, visiteId: string) => void;
  addLot: (l: Lot) => void;
  updateLot: (l: Lot) => void;
  deleteLot: (id: string) => void;
  addOpr: (o: Opr) => void;
  updateOpr: (o: Opr) => void;
  deleteOpr: (id: string) => void;
  batchUpdateReserves: (ids: string[], updates: Partial<Pick<Reserve, 'status' | 'company' | 'companies' | 'deadline' | 'priority'>>, author?: string) => void;
  addSitePlanVersion: (parentPlanId: string, newPlan: SitePlan) => void;
  migrateReservesToPlan: (fromPlanId: string, toPlanId: string) => number;
  realtimeConnected: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

const MOCK_TODAY = formatDateFR(new Date());

const MOCK_COMPANIES: Company[] = [];

const MOCK_CHANTIERS: Chantier[] = [];

const MOCK_SITE_PLANS: SitePlan[] = [];

const MOCK_RESERVES: Reserve[] = [];

const MOCK_TASKS: Task[] = [];

const MOCK_DOCUMENTS: Document[] = [];

const MOCK_PHOTOS: Photo[] = [];

const MOCK_MESSAGES: Message[] = [];

const MOCK_PROFILES: Profile[] = [
  { id: 'demo-0', name: 'Admin Système', role: 'admin', roleLabel: 'Administrateur', email: 'admin@buildtrack.fr' },
  { id: 'demo-1', name: 'Jean Dupont', role: 'conducteur', roleLabel: 'Conducteur de travaux', email: 'j.dupont@buildtrack.fr' },
  { id: 'demo-2', name: 'Marie Martin', role: 'chef_equipe', roleLabel: "Chef d'équipe", email: 'm.martin@buildtrack.fr' },
  { id: 'demo-3', name: 'Pierre Lambert', role: 'observateur', roleLabel: 'Observateur', email: 'p.lambert@buildtrack.fr' },
];

export const STANDARD_LOTS: Lot[] = [
  { id: 'lot-00', code: '00', name: 'VRD / Terrassement', color: '#78716C', cctpRef: 'CCTP Titre I — Travaux préparatoires' },
  { id: 'lot-01', code: '01', name: 'Gros œuvre / Maçonnerie', color: '#3B82F6', cctpRef: 'CCTP Titre II — Lot 01 GO' },
  { id: 'lot-02', code: '02', name: 'Charpente / Couverture', color: '#8B5CF6', cctpRef: 'CCTP Titre II — Lot 02 Charpente' },
  { id: 'lot-03', code: '03', name: 'Étanchéité', color: '#06B6D4', cctpRef: 'CCTP Titre II — Lot 03 Étanchéité' },
  { id: 'lot-04', code: '04', name: 'Menuiseries extérieures', color: '#F59E0B', cctpRef: 'CCTP Titre III — Lot 04 ME' },
  { id: 'lot-05', code: '05', name: 'Menuiseries intérieures', color: '#D97706', cctpRef: 'CCTP Titre III — Lot 05 MI' },
  { id: 'lot-06', code: '06', name: 'Isolation thermique / Doublage', color: '#10B981', cctpRef: 'CCTP Titre III — Lot 06 ITE' },
  { id: 'lot-07', code: '07', name: 'Plâtrerie / Cloisons sèches', color: '#EC4899', cctpRef: 'CCTP Titre III — Lot 07 Plâtrerie' },
  { id: 'lot-08', code: '08', name: 'Carrelage / Revêtements sols', color: '#EF4444', cctpRef: 'CCTP Titre III — Lot 08 Carrelage' },
  { id: 'lot-09', code: '09', name: 'Peinture / Finitions', color: '#6366F1', cctpRef: 'CCTP Titre III — Lot 09 Peinture' },
  { id: 'lot-10', code: '10', name: 'Plomberie / Sanitaire', color: '#0EA5E9', cctpRef: 'CCTP Titre IV — Lot 10 Plomberie' },
  { id: 'lot-11', code: '11', name: 'Chauffage / VMC / Climatisation', color: '#F97316', cctpRef: 'CCTP Titre IV — Lot 11 CVC' },
  { id: 'lot-12', code: '12', name: 'Électricité / Courants forts', color: '#FBBF24', cctpRef: 'CCTP Titre IV — Lot 12 CF' },
  { id: 'lot-13', code: '13', name: 'Courants faibles / Réseaux', color: '#A78BFA', cctpRef: 'CCTP Titre IV — Lot 13 CFa' },
  { id: 'lot-14', code: '14', name: 'Ascenseurs / Élévateurs', color: '#34D399', cctpRef: 'CCTP Titre V — Lot 14 Ascenseurs' },
  { id: 'lot-15', code: '15', name: 'Espaces verts / Aménagements ext.', color: '#22C55E', cctpRef: 'CCTP Titre VI — Lot 15 VRD ext.' },
  { id: 'lot-16', code: '16', name: 'Sécurité incendie / SSI', color: '#F43F5E', cctpRef: 'CCTP Titre V — Lot 16 SSI' },
];

const MOCK_VISITES: Visite[] = [];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { isOnline, enqueueOperation, registerReloadHandler } = useNetwork();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  // Returns true and enqueues the operation when offline — caller should return early.
  const offline = (op: Parameters<typeof enqueueOperation>[0]): boolean => {
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation(op);
      return true;
    }
    return false;
  };

  const [state, dispatch] = useReducer(reducer, {
    reserves: [], companies: [], tasks: [],
    documents: [], photos: [], messages: [],
    lastReadByChannel: {}, isLoading: true,
    profiles: [], generalChannels: [], customChannels: [], groupChannels: [],
    persistedDmChannels: [], pinnedChannelIds: [],
    channelMembersOverride: {},
    chantiers: [], sitePlans: [], activeChantierId: null,
    visites: [], lots: [], oprs: [],
  });

  const [notification, setNotification] = useState<{ msg: Message; channelName: string; channelColor: string; channelIcon: string } | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [pendingDmChannelIds, setPendingDmChannelIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(PENDING_DM_KEY).then(raw => {
      if (raw) {
        try { setPendingDmChannelIds(new Set(JSON.parse(raw))); } catch {}
      }
    }).catch(() => {});
  }, []);

  const currentUserNameRef = useRef<string>('');
  const currentUserOrgIdRef = useRef<string | null>(null);
  const activeChannelIdRef = useRef<string | null>(null);
  const channelsRef = useRef<Channel[]>([...STATIC_CHANNELS]);
  const stateRef = useRef(state);
  const dmUpsertPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const loadedChannelIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Register the reload handler so NetworkContext can trigger a refresh after offline sync
  useEffect(() => {
    if (isSupabaseConfigured) {
      registerReloadHandler(() => { loadGenerationRef.current++; loadAll(); });
    }
  }, []);

  function dismissNotification() {
    setNotification(null);
  }

  function setActiveChannelId(id: string | null) {
    activeChannelIdRef.current = id;
    if (id) {
      setNotification(prev => (prev?.msg.channelId === id ? null : prev));
    }
  }

  async function loadCustomChannels() {
    // 1. Charger le cache local en premier — source de vérité locale
    let cachedChannels: Channel[] = [];
    try {
      const stored = await AsyncStorage.getItem(CUSTOM_CHANNELS_KEY);
      if (stored) cachedChannels = JSON.parse(stored) ?? [];
    } catch {}

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('channels').select('*').eq('type', 'custom');
        if (!error && data !== null) {
          const supabaseChannels: Channel[] = data.map((r: any) => ({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: 'custom' as const,
            members: r.members ?? [], createdBy: r.created_by ?? undefined,
          }));
          // Fusionner : Supabase en priorité + canaux locaux non encore synchronisés
          const merged = [...supabaseChannels];
          for (const local of cachedChannels) {
            if (!merged.find(c => c.id === local.id)) merged.push(local);
          }
          dispatch({ type: 'SET_CUSTOM_CHANNELS', payload: merged });
          await AsyncStorage.setItem(CUSTOM_CHANNELS_KEY, JSON.stringify(merged)).catch(() => {});
          return;
        }
      } catch {}
    }

    // Fallback : utiliser uniquement le cache local
    if (cachedChannels.length > 0) {
      dispatch({ type: 'SET_CUSTOM_CHANNELS', payload: cachedChannels });
    }
  }

  async function saveCustomChannels(channels: Channel[]) {
    // Toujours persister localement en premier (jamais de perte de données)
    try { await AsyncStorage.setItem(CUSTOM_CHANNELS_KEY, JSON.stringify(channels)); } catch {}
    if (!isSupabaseConfigured) return;

    // Récupérer l'org_id — si null (race condition login), tenter de le charger depuis Supabase
    let orgId = currentUserOrgIdRef.current;
    if (!orgId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data: prof } = await supabase
            .from('profiles').select('organization_id').eq('id', session.user.id).single();
          orgId = prof?.organization_id ?? null;
          if (orgId) currentUserOrgIdRef.current = orgId;
        }
      } catch {}
    }

    for (const ch of channels) {
      const { error } = await supabase.from('channels').upsert({
        id: ch.id, name: ch.name, description: ch.description ?? null,
        icon: ch.icon ?? 'chatbubbles', color: ch.color ?? '#10B981',
        type: ch.type,
        members: ch.members ?? [],
        created_by: ch.createdBy ?? null,
        organization_id: orgId ?? null,
      });
      if (error) {
        console.warn('[saveCustomChannels] upsert error:', error.message, 'channel:', ch.id);
      }
    }
  }

  async function loadGroupChannels() {
    // 1. Charger le cache local en premier
    let cachedChannels: Channel[] = [];
    try {
      const stored = await AsyncStorage.getItem(GROUP_CHANNELS_KEY);
      if (stored) cachedChannels = JSON.parse(stored) ?? [];
    } catch {}

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('channels').select('*').eq('type', 'group');
        if (!error && data !== null) {
          const supabaseChannels: Channel[] = data.map((r: any) => ({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: 'group' as const,
            members: r.members ?? [], createdBy: r.created_by ?? undefined,
          }));
          // Fusionner avec le cache local
          const merged = [...supabaseChannels];
          for (const local of cachedChannels) {
            if (!merged.find(c => c.id === local.id)) merged.push(local);
          }
          dispatch({ type: 'SET_GROUP_CHANNELS', payload: merged });
          await AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(merged)).catch(() => {});
          return;
        }
      } catch {}
    }

    // Fallback : utiliser uniquement le cache local
    if (cachedChannels.length > 0) {
      dispatch({ type: 'SET_GROUP_CHANNELS', payload: cachedChannels });
    }
  }

  async function saveGroupChannels(channels: Channel[]) {
    // Toujours persister localement en premier
    try { await AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(channels)); } catch {}
    if (!isSupabaseConfigured) return;

    // Récupérer l'org_id — si null (race condition login), tenter de le charger depuis Supabase
    let orgId = currentUserOrgIdRef.current;
    if (!orgId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data: prof } = await supabase
            .from('profiles').select('organization_id').eq('id', session.user.id).single();
          orgId = prof?.organization_id ?? null;
          if (orgId) currentUserOrgIdRef.current = orgId;
        }
      } catch {}
    }

    for (const ch of channels) {
      const { error } = await supabase.from('channels').upsert({
        id: ch.id, name: ch.name, description: ch.description ?? null,
        icon: ch.icon ?? 'people-circle', color: ch.color ?? '#10B981',
        type: ch.type,
        members: ch.members ?? [],
        created_by: ch.createdBy ?? null,
        organization_id: orgId ?? null,
      });
      if (error) {
        console.warn('[saveGroupChannels] upsert error:', error.message, 'channel:', ch.id);
      }
    }
  }

  async function loadGeneralChannels() {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .in('type', ['general', 'building']);
      if (error) {
        console.warn('[loadGeneralChannels] Supabase error:', error.message, error.code, error.details);
        return;
      }
      if (data) {
        const channels: Channel[] = data.map((r: any) => ({
          id: r.id, name: r.name, description: r.description ?? '',
          icon: r.icon, color: r.color, type: r.type as 'general' | 'building',
          members: r.members ?? [], createdBy: r.created_by ?? undefined,
          organizationId: r.organization_id ?? undefined,
        }));
        if (channels.length === 0) {
          console.warn('[loadGeneralChannels] Aucun canal general/building retourné — vérifier organization_id dans Supabase (RLS bloque si NULL).');
        }
        dispatch({ type: 'SET_GENERAL_CHANNELS', payload: channels });
      }
    } catch (err: any) {
      console.warn('[loadGeneralChannels] Exception:', err?.message ?? err);
    }
  }

  async function loadDMChannels() {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .eq('type', 'dm');
      if (!error && data) {
        const myName = currentUserNameRef.current;
        const channels: Channel[] = data.map((r: any) => {
          const participants: string[] = r.members ?? [];
          // Toujours afficher le NOM DE L'AUTRE participant, pas le sien.
          // Le `name` stocké en Supabase est du point de vue du créateur ;
          // pour le destinataire il faut recalculer.
          const otherName = participants.find(p => p !== myName) ?? r.name;
          return {
            id: r.id,
            name: otherName,
            description: r.description ?? '',
            icon: r.icon ?? 'person-circle',
            color: r.color ?? '#EC4899',
            type: 'dm' as const,
            members: participants,
            dmParticipants: participants,
            createdBy: r.created_by ?? undefined,
          };
        });
        dispatch({ type: 'SET_PERSISTED_DM_CHANNELS', payload: channels });
      }
    } catch {}
  }

  async function loadPinnedChannels() {
    try {
      // Priorité Supabase : synchronisé sur tous les appareils
      if (isSupabaseConfigured) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data } = await supabase
            .from('profiles')
            .select('pinned_channels')
            .eq('id', session.user.id)
            .single();
          if (data?.pinned_channels && Array.isArray(data.pinned_channels)) {
            dispatch({ type: 'SET_PINNED_CHANNELS', payload: data.pinned_channels });
            // Cache local pour mode hors-ligne
            AsyncStorage.setItem(PINNED_CHANNELS_KEY, JSON.stringify(data.pinned_channels)).catch(() => {});
            return;
          }
        }
      }
      // Fallback AsyncStorage (mode hors-ligne ou Supabase non configuré)
      const stored = await AsyncStorage.getItem(PINNED_CHANNELS_KEY);
      if (stored) {
        dispatch({ type: 'SET_PINNED_CHANNELS', payload: JSON.parse(stored) });
      }
    } catch {}
  }

  async function savePinnedChannels(ids: string[]) {
    try {
      // AsyncStorage pour le cache local
      await AsyncStorage.setItem(PINNED_CHANNELS_KEY, JSON.stringify(ids));
      // Sync Supabase
      if (isSupabaseConfigured) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          supabase
            .from('profiles')
            .update({ pinned_channels: ids })
            .eq('id', session.user.id)
            .then(() => {}).catch(() => {});
        }
      }
    } catch {}
  }

  async function loadChannelMembersOverride() {
    try {
      const stored = await AsyncStorage.getItem(CHANNEL_MEMBERS_OVERRIDE_KEY);
      if (stored) {
        dispatch({ type: 'SET_CHANNEL_MEMBERS_OVERRIDE', payload: JSON.parse(stored) });
      }
    } catch {}
  }

  async function saveChannelMembersOverride(overrides: Record<string, string[]>) {
    try {
      await AsyncStorage.setItem(CHANNEL_MEMBERS_OVERRIDE_KEY, JSON.stringify(overrides));
    } catch {}
  }

  async function loadMockData() {
    dispatch({ type: 'SET_LOADING', payload: true });
    await loadCustomChannels();
    await loadGroupChannels();
    await loadPinnedChannels();
    await loadChannelMembersOverride();
    const storedLastRead = await AsyncStorage.getItem('lastReadByChannel').catch(() => null);
    if (storedLastRead) {
      dispatch({ type: 'SET_LAST_READ', payload: JSON.parse(storedLastRead) });
    }

    let reserves: Reserve[] = MOCK_RESERVES;
    let tasks: Task[] = MOCK_TASKS;
    let photos: Photo[] = MOCK_PHOTOS;
    let messages: Message[] = MOCK_MESSAGES;
    let chantiers: Chantier[] = MOCK_CHANTIERS;
    let sitePlans: SitePlan[] = MOCK_SITE_PLANS;
    let activeChantierId: string | null = MOCK_CHANTIERS[0]?.id ?? null;
    let visites: Visite[] = MOCK_VISITES;
    let lots: Lot[] = STANDARD_LOTS;
    let oprs: Opr[] = [];

    try {
      const sr = await AsyncStorage.getItem(MOCK_RESERVES_KEY);
      if (sr) { const p = JSON.parse(sr); if (Array.isArray(p) && p.length > 0) reserves = p; }
    } catch {}
    try {
      const st = await AsyncStorage.getItem(MOCK_TASKS_KEY);
      if (st) { const p = JSON.parse(st); if (Array.isArray(p) && p.length > 0) tasks = p; }
    } catch {}
    try {
      const sp = await AsyncStorage.getItem(MOCK_PHOTOS_KEY);
      if (sp) {
        const parsed: Photo[] = JSON.parse(sp);
        photos = parsed.map(p =>
          p.uri?.startsWith('blob:') ? { ...p, uri: undefined } : p
        );
      }
    } catch {}
    try {
      const sm = await AsyncStorage.getItem(MOCK_MESSAGES_KEY);
      if (sm) messages = JSON.parse(sm);
    } catch {}
    try {
      const sc = await AsyncStorage.getItem(MOCK_CHANTIERS_KEY);
      if (sc) {
        const p = JSON.parse(sc);
        if (Array.isArray(p)) {
          const stored: Chantier[] = p;
          const storedIds = new Set(stored.map((c: Chantier) => c.id));
          const missing = MOCK_CHANTIERS.filter(c => !storedIds.has(c.id));
          chantiers = [...missing, ...stored];
          persistMockChantiers(chantiers);
        }
      } else {
        persistMockChantiers(chantiers);
      }
    } catch {}
    try {
      const ssp = await AsyncStorage.getItem(MOCK_SITE_PLANS_KEY);
      if (ssp) {
        const p = JSON.parse(ssp);
        if (Array.isArray(p)) {
          const stored: SitePlan[] = p;
          const storedIds = new Set(stored.map((s: SitePlan) => s.id));
          const missing = MOCK_SITE_PLANS.filter(s => !storedIds.has(s.id));
          sitePlans = [...missing, ...stored];
          persistMockSitePlans(sitePlans);
        }
      } else {
        persistMockSitePlans(sitePlans);
      }
    } catch {}
    try {
      const sac = await AsyncStorage.getItem(ACTIVE_CHANTIER_KEY);
      // Valide que l'ID stocké correspond bien à un chantier de la liste
      if (sac && chantiers.some(c => c.id === sac)) activeChantierId = sac;
      // Sinon on garde le fallback MOCK_CHANTIERS[0]?.id déjà défini
    } catch {}
    try {
      const sv = await AsyncStorage.getItem(MOCK_VISITES_KEY);
      if (sv) { const p = JSON.parse(sv); if (Array.isArray(p)) visites = p; }
    } catch {}
    try {
      const sl = await AsyncStorage.getItem(MOCK_LOTS_KEY);
      if (sl) { const p = JSON.parse(sl); if (Array.isArray(p) && p.length > 0) lots = p; }
    } catch {}
    try {
      const so = await AsyncStorage.getItem(MOCK_OPRS_KEY);
      if (so) { const p = JSON.parse(so); if (Array.isArray(p)) oprs = p; }
    } catch {}
    let documents: Document[] = MOCK_DOCUMENTS;
    try {
      const sd = await AsyncStorage.getItem('buildtrack_mock_documents_v2');
      if (sd) { const p = JSON.parse(sd); if (Array.isArray(p) && p.length > 0) documents = p; }
    } catch {}
    let companies: Company[] = MOCK_COMPANIES;
    try {
      const sco = await AsyncStorage.getItem(MOCK_COMPANIES_KEY);
      if (sco) { const p = JSON.parse(sco); if (Array.isArray(p) && p.length > 0) companies = p; }
    } catch {}

    dispatch({
      type: 'INIT',
      payload: {
        reserves,
        companies,
        tasks,
        documents,
        photos,
        messages,
        profiles: MOCK_PROFILES,
      },
    });
    dispatch({ type: 'SET_CHANTIERS', payload: chantiers });
    dispatch({ type: 'SET_SITE_PLANS', payload: sitePlans });
    dispatch({ type: 'SET_VISITES', payload: visites });
    dispatch({ type: 'SET_LOTS', payload: lots });
    dispatch({ type: 'SET_OPRS', payload: oprs });
    if (activeChantierId) dispatch({ type: 'SET_ACTIVE_CHANTIER', payload: activeChantierId });
  }

  function persistMockReserves(reserves: Reserve[]) {
    AsyncStorage.setItem(MOCK_RESERVES_KEY, JSON.stringify(reserves)).catch(() => {});
  }
  function persistMockTasks(tasks: Task[]) {
    AsyncStorage.setItem(MOCK_TASKS_KEY, JSON.stringify(tasks)).catch(() => {});
  }
  function persistMockPhotos(photos: Photo[]) {
    AsyncStorage.setItem(MOCK_PHOTOS_KEY, JSON.stringify(photos)).catch(() => {});
  }
  function persistMockMessages(messages: Message[]) {
    AsyncStorage.setItem(MOCK_MESSAGES_KEY, JSON.stringify(messages)).catch(() => {});
  }
  function persistMockChantiers(chantiers: Chantier[]) {
    AsyncStorage.setItem(MOCK_CHANTIERS_KEY, JSON.stringify(chantiers)).catch(() => {});
  }
  function persistMockSitePlans(plans: SitePlan[]) {
    AsyncStorage.setItem(MOCK_SITE_PLANS_KEY, JSON.stringify(plans)).catch(() => {});
  }
  function persistMockVisites(visites: Visite[]) {
    AsyncStorage.setItem(MOCK_VISITES_KEY, JSON.stringify(visites)).catch(() => {});
  }
  function persistMockLots(lots: Lot[]) {
    AsyncStorage.setItem(MOCK_LOTS_KEY, JSON.stringify(lots)).catch(() => {});
  }
  function persistMockOprs(oprs: Opr[]) {
    AsyncStorage.setItem(MOCK_OPRS_KEY, JSON.stringify(oprs)).catch(() => {});
  }
  function persistMockCompanies(companies: Company[]) {
    AsyncStorage.setItem(MOCK_COMPANIES_KEY, JSON.stringify(companies)).catch(() => {});
  }

  function persistMockDocuments(documents: Document[]) {
    AsyncStorage.setItem('buildtrack_mock_documents_v2', JSON.stringify(documents)).catch(() => {});
  }

  const loadGenerationRef = useRef(0);
  // Guards against reacting to seeding auth events before the app is initialized.
  // Set to true once INITIAL_SESSION fires. Events before that are from seeding.
  const initialSessionReceivedRef = useRef(false);

  async function loadAll() {
    debugLog(`[AppContext] loadAll() → début (gen=${loadGenerationRef.current})`);
    if (!isSupabaseConfigured) {
      debugLogWarn('[AppContext] Supabase non configuré → loadMockData()');
      await loadMockData();
      return;
    }

    const myGen = loadGenerationRef.current;
    loadedChannelIdsRef.current.clear();

    dispatch({ type: 'SET_LOADING', payload: true });

    initStorageBuckets().catch(() => {});
    try {
      debugLog('[AppContext] getSession() → appel');
      const { data: { session } } = await supabase.auth.getSession();
      let profile: { name?: string; organization_id?: string; last_read_by_channel?: Record<string, string>; role?: string; company_id?: string | null } | null = null;
      if (session?.user?.id) {
        debugLogOk(`[AppContext] getSession() → session OK (${session.user.email})`);
        debugLog('[AppContext] profiles.select → chargement profil');
        const { data: profileResult } = await supabase
          .from('profiles')
          .select('name, organization_id, last_read_by_channel, role, company_id')
          .eq('id', session.user.id)
          .single();
        profile = profileResult;
        if (profile?.name) {
          currentUserNameRef.current = profile.name;
          debugLogOk(`[AppContext] profil → name=${profile.name}, org=${profile.organization_id ?? 'null'}, role=${profile.role ?? '?'}`);
        } else {
          debugLogWarn('[AppContext] profil → introuvable ou colonnes manquantes');
        }
        if (profile?.organization_id) {
          currentUserOrgIdRef.current = profile.organization_id;
        }
      } else {
        debugLogWarn('[AppContext] getSession() → pas de session dans loadAll()');
      }

      // Sync cross-device last_read from Supabase (prefer Supabase over local cache)
      if (profile?.last_read_by_channel && typeof profile.last_read_by_channel === 'object') {
        dispatch({ type: 'SET_LAST_READ', payload: profile.last_read_by_channel });
        AsyncStorage.setItem('lastReadByChannel', JSON.stringify(profile.last_read_by_channel)).catch(() => {});
      }

      debugLog('[AppContext] Promise.all → reserves, companies, tasks, documents, photos, profiles, chantiers…');
      const [
        { data: reserves, error: reservesErr },
        { data: companies },
        { data: tasks },
        { data: documents },
        { data: photos },
        { data: profilesData },
        storedActiveChantierIdEarly,
        { data: chantiersForFilter },
      ] = await Promise.all([
        supabase.from('reserves').select('*').order('created_at', { ascending: false }),
        supabase.from('companies').select('*'),
        supabase.from('tasks').select('*'),
        supabase.from('documents').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('photos').select('*').order('taken_at', { ascending: false }),
        profile?.organization_id
          ? supabase.from('profiles')
              .select('id, name, role, role_label, email')
              .eq('organization_id', profile.organization_id)
          : supabase.from('profiles')
              .select('id, name, role, role_label, email'),
        AsyncStorage.getItem(ACTIVE_CHANTIER_KEY).catch(() => null),
        supabase.from('chantiers').select('id, company_ids'),
      ]);
      debugLogOk(`[AppContext] Promise.all OK → réserves=${reserves?.length ?? 0}, entreprises=${companies?.length ?? 0}, tâches=${tasks?.length ?? 0}, profils=${profilesData?.length ?? 0}${reservesErr ? ' ⚠ err_reserves=' + reservesErr.code : ''}`);

      // AsyncStorage last_read: merged as fallback if Supabase dispatch hasn't fired yet
      // (Supabase value dispatched earlier already takes priority)
      const storedLastRead = await AsyncStorage.getItem('lastReadByChannel').catch(() => null);
      if (storedLastRead) {
        try {
          const localRead: Record<string, string> = JSON.parse(storedLastRead);
          // Only dispatch if Supabase gave us nothing (state.lastReadByChannel still empty)
          if (Object.keys(localRead).length > 0) {
            dispatch({ type: 'SET_LAST_READ', payload: localRead });
          }
        } catch {}
      }

      debugLog('[AppContext] Canaux → chargement (general, custom, group, DM, pinned)…');
      await Promise.all([
        loadCustomChannels(),
        loadGroupChannels(),
        loadGeneralChannels(),
        loadDMChannels(),
        loadPinnedChannels(),
        loadChannelMembersOverride(),
      ]);
      debugLogOk('[AppContext] Canaux → OK');

      if (loadGenerationRef.current !== myGen) {
        // A newer loadAll() has already started (e.g. triggered by an auth event
        // during the seed process). Clear loading here so the UI is never stuck
        // — the newer call has already dispatched SET_LOADING:true synchronously.
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }

      // ── Chantier visibility — company-based access control ─────────────────
      // Rule: if a chantier has companyIds set, only members of those companies
      // (plus admin / conducteur / super_admin) can see it and all its related data.
      const loadedRole: string = profile?.role ?? '';
      const loadedCompanyId: string | null = profile?.company_id ?? null;
      const isPrivilegedRole = loadedRole === 'super_admin' || loadedRole === 'admin' || loadedRole === 'conducteur';
      // Build a lookup: chantierId → visible?
      const chantierVisibility = new Map<string, boolean>();
      for (const ch of (chantiersForFilter ?? [])) {
        const cids: string[] = Array.isArray(ch.company_ids) ? ch.company_ids : [];
        if (isPrivilegedRole || cids.length === 0) {
          chantierVisibility.set(ch.id, true);
        } else {
          chantierVisibility.set(ch.id, loadedCompanyId ? cids.includes(loadedCompanyId) : false);
        }
      }
      // Returns true for items with no chantierId (not chantier-scoped) or visible chantiers
      function isChantierIdVisible(chantierId?: string | null): boolean {
        if (!chantierId) return true;
        const v = chantierVisibility.get(chantierId);
        return v !== false; // unknown chantier defaults to visible
      }

      // ── Reserves: Supabase-first with local-cache fallback ──────────────────
      let resolvedReserves: Reserve[] = (reservesErr || !reserves) ? [] : reserves.map(toReserve);
      if (resolvedReserves.length === 0) {
        const sr = await AsyncStorage.getItem(MOCK_RESERVES_KEY).catch(() => null);
        const localReserves: Reserve[] = sr ? (JSON.parse(sr) ?? []) : [];
        if (localReserves.length > 0) {
          resolvedReserves = localReserves;
          // Try to push local reserves up to Supabase (best-effort)
          const syncOrgId = currentUserOrgIdRef.current;
          (async () => {
            for (const r of localReserves) {
              await supabase.from('reserves').upsert({
                id: r.id, title: r.title, description: r.description, building: r.building,
                zone: r.zone, level: r.level,
                company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? null,
                companies: r.companies ?? (r.company ? [r.company] : []),
                priority: r.priority, status: r.status, created_at: r.createdAt, deadline: r.deadline,
                comments: r.comments, history: r.history,
                plan_x: r.planX ?? 50, plan_y: r.planY ?? 50,
                photo_uri: r.photoUri ?? null, lot_id: r.lotId ?? null, kind: r.kind ?? null,
                chantier_id: r.chantierId ?? null, plan_id: r.planId ?? null,
                visite_id: r.visiteId ?? null, linked_task_id: r.linkedTaskId ?? null,
                photos: r.photos ?? null, photo_annotations: r.photoAnnotations ?? null,
                enterprise_signature: r.enterpriseSignature ?? null,
                enterprise_signataire: r.enterpriseSignataire ?? null,
                enterprise_acknowledged_at: r.enterpriseAcknowledgedAt ?? null,
                company_signatures: r.companySignatures ?? null,
                organization_id: syncOrgId ?? null,
              }).catch(() => {});
            }
          })();
        }
      } else {
        // Cache the good result locally so we have a fallback next time
        persistMockReserves(resolvedReserves);
      }

      // ── Companies: Supabase-first with local-cache fallback ─────────────────
      let resolvedCompanies: Company[] = (companies ?? []).map(toCompany);
      if (resolvedCompanies.length === 0) {
        const sc = await AsyncStorage.getItem(MOCK_COMPANIES_KEY).catch(() => null);
        const localCompanies: Company[] = sc ? (JSON.parse(sc) ?? []) : [];
        if (localCompanies.length > 0) {
          resolvedCompanies = localCompanies;
          // Try to push local companies up to Supabase (best-effort)
          const orgId = currentUserOrgIdRef.current;
          (async () => {
            for (const co of localCompanies) {
              await supabase.from('companies').upsert({
                id: co.id, name: co.name, short_name: co.shortName ?? '', color: co.color,
                planned_workers: co.plannedWorkers ?? 0, actual_workers: co.actualWorkers ?? 0,
                hours_worked: co.hoursWorked ?? 0, zone: co.zone ?? '', contact: co.phone ?? null,
                email: co.email ?? null, lots: co.lots?.length ? co.lots : null,
                siret: co.siret ?? null, insurance: co.insurance ?? null,
                qualifications: co.qualifications ?? null,
                organization_id: orgId ?? null,
              }).catch(() => {});
            }
          })();
        }
      } else {
        // Cache the good result locally so we have a fallback next time
        persistMockCompanies(resolvedCompanies);
      }

      // Apply company-based chantier visibility filter
      resolvedReserves = resolvedReserves.filter(r => isChantierIdVisible(r.chantierId));
      const resolvedTasks = (tasks ?? []).map(toTask).filter(t => isChantierIdVisible(t.chantierId));

      debugLogOk(`[AppContext] INIT dispatch → réserves=${resolvedReserves.length}, entreprises=${resolvedCompanies.length}, tâches=${resolvedTasks.length} → isLoading=false`);
      dispatch({
        type: 'INIT',
        payload: {
          reserves: resolvedReserves,
          companies: resolvedCompanies,
          tasks: resolvedTasks,
          documents: (documents ?? []).map(toDocument),
          photos: (photos ?? []).map(toPhoto),
          messages: [],
          profiles: (profilesData ?? []).map((p: any) => ({ id: p.id, name: p.name, role: p.role, roleLabel: p.role_label ?? ROLE_LABELS[p.role as UserRole] ?? p.role, email: p.email })),
        },
      });
      if (storedActiveChantierIdEarly) {
        dispatch({ type: 'SET_ACTIVE_CHANTIER', payload: storedActiveChantierIdEarly });
      }

      // Préchargement non bloquant du dernier message par canal pour l'onglet Messages
      ;(async () => {
        try {
          const { data: previewData } = await supabase
            .from('messages')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);
          if (previewData && previewData.length > 0 && loadGenerationRef.current === myGen) {
            const userName = currentUserNameRef.current;
            const previewMsgs = previewData.map((r: any) => toMessage(r, userName));
            dispatch({ type: 'PREPEND_MESSAGES', payload: previewMsgs });
          }
        } catch {}
      })();

      let chantiers: Chantier[] = [];
      let sitePlans: SitePlan[] = [];
      let activeChantierId: string | null = null;

      debugLog('[AppContext] Chantiers → chargement complet…');
      try {
        const { data: chantiersData, error: chantiersErr } = await supabase
          .from('chantiers').select('*').order('created_at', { ascending: false });
        if (!chantiersErr && chantiersData !== null) {
          const supabaseChantiers = chantiersData.map(toChantier);
          if (supabaseChantiers.length > 0) {
            chantiers = supabaseChantiers;
            persistMockChantiers(chantiers);
          } else {
            // Supabase returned 0 — check local cache before trusting this empty result
            const sc = await AsyncStorage.getItem(MOCK_CHANTIERS_KEY).catch(() => null);
            const localChantiers: Chantier[] = sc ? (JSON.parse(sc) ?? []) : [];
            if (localChantiers.length > 0) {
              // Local cache has data that Supabase doesn't — push it up automatically
              chantiers = localChantiers;
              (async () => {
                for (const ch of localChantiers) {
                  const { error: syncErr } = await supabase.from('chantiers').upsert({
                    id: ch.id,
                    name: ch.name,
                    address: ch.address ?? null,
                    description: ch.description ?? null,
                    start_date: ch.startDate ?? null,
                    end_date: ch.endDate ?? null,
                    status: ch.status,
                    created_by: ch.createdBy ?? null,
                    buildings: ch.buildings ? JSON.stringify(ch.buildings) : null,
                    organization_id: currentUserOrgIdRef.current ?? null,
                  });
                }
              })();
            } else {
              chantiers = [];
            }
          }
        } else {
          const sc = await AsyncStorage.getItem(MOCK_CHANTIERS_KEY);
          if (sc) {
            const p = JSON.parse(sc);
            if (Array.isArray(p)) chantiers = p;
          }
        }
      } catch (e) {
        const sc = await AsyncStorage.getItem(MOCK_CHANTIERS_KEY).catch(() => null);
        if (sc) { const p = JSON.parse(sc); if (Array.isArray(p)) chantiers = p; }
      }

      try {
        const { data: sitePlansData, error: sitePlansErr } = await supabase
          .from('site_plans').select('*').order('created_at', { ascending: false });
        if (!sitePlansErr && sitePlansData !== null) {
          const supabasePlans = sitePlansData.map(toSitePlan);
          if (supabasePlans.length > 0) {
            sitePlans = supabasePlans;
            persistMockSitePlans(sitePlans);
          } else {
            // Supabase returned 0 — check local cache before overwriting
            const ssp = await AsyncStorage.getItem(MOCK_SITE_PLANS_KEY).catch(() => null);
            const localPlans: SitePlan[] = ssp ? (JSON.parse(ssp) ?? []) : [];
            if (localPlans.length > 0) {
              sitePlans = localPlans;
              (async () => {
                for (const p of localPlans) {
                  const { error: syncErr } = await supabase.from('site_plans').upsert({
                    id: p.id,
                    chantier_id: p.chantierId,
                    name: p.name,
                    building: p.building ?? null,
                    level: p.level ?? null,
                    building_id: p.buildingId ?? null,
                    level_id: p.levelId ?? null,
                    uri: p.uri ?? null,
                    file_type: p.fileType ?? null,
                    uploaded_at: p.uploadedAt,
                    size: p.size ?? null,
                  });
                }
              })();
            } else {
              sitePlans = [];
            }
          }
        } else {
          const ssp = await AsyncStorage.getItem(MOCK_SITE_PLANS_KEY);
          if (ssp) {
            const p = JSON.parse(ssp);
            if (Array.isArray(p)) sitePlans = p;
          }
        }
      } catch (e) {
        const ssp = await AsyncStorage.getItem(MOCK_SITE_PLANS_KEY).catch(() => null);
        if (ssp) { const p = JSON.parse(ssp); if (Array.isArray(p)) sitePlans = p; }
      }

      try {
        const sac = await AsyncStorage.getItem(ACTIVE_CHANTIER_KEY);
        if (sac) activeChantierId = sac;
      } catch {}

      // Auto-réconciliation : assigne buildingId/levelId aux plans legacy qui
      // n'ont que les noms textuels, en les faisant correspondre à la hiérarchie.
      const { plans: reconciledPlans, changed: reconciledChanged } = reconcilePlanIds(sitePlans, chantiers);
      if (reconciledChanged.length > 0) {
        sitePlans = reconciledPlans;
        persistMockSitePlans(reconciledPlans);
        if (isSupabaseConfigured) {
          (async () => {
            for (const p of reconciledChanged) {
              const { error } = await supabase.from('site_plans').update({
                building_id: p.buildingId ?? null,
                level_id: p.levelId ?? null,
              }).eq('id', p.id);
            }
          })();
        }
      }

      if (loadGenerationRef.current !== myGen) {
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }

      // Filter chantiers by company-based visibility
      const visibleChantiers = chantiers.filter(ch => {
        const cids = ch.companyIds ?? [];
        if (isPrivilegedRole || cids.length === 0) return true;
        return loadedCompanyId ? cids.includes(loadedCompanyId) : false;
      });
      // Update visibility map with the now-fully-loaded chantier data
      for (const ch of chantiers) {
        const cids = ch.companyIds ?? [];
        if (isPrivilegedRole || cids.length === 0) {
          chantierVisibility.set(ch.id, true);
        } else {
          chantierVisibility.set(ch.id, loadedCompanyId ? cids.includes(loadedCompanyId) : false);
        }
      }
      const visibleSitePlans = sitePlans.filter(p => isChantierIdVisible(p.chantierId));

      dispatch({ type: 'SET_CHANTIERS', payload: visibleChantiers });
      dispatch({ type: 'SET_SITE_PLANS', payload: visibleSitePlans });
      // Valide le chantier actif stocké : s'il n'existe pas dans la liste chargée
      // (ID périmé, accès révoqué, ou première connexion après déconnexion), on
      // sélectionne automatiquement le premier chantier disponible.
      const validActiveId =
        activeChantierId && visibleChantiers.some(c => c.id === activeChantierId)
          ? activeChantierId
          : (visibleChantiers[0]?.id ?? null);
      if (validActiveId) {
        dispatch({ type: 'SET_ACTIVE_CHANTIER', payload: validActiveId });
        if (validActiveId !== activeChantierId) {
          AsyncStorage.setItem(ACTIVE_CHANTIER_KEY, validActiveId).catch(() => {});
        }
      }

      let visites: Visite[] = MOCK_VISITES;
      let lots: Lot[] = STANDARD_LOTS;
      let oprs: Opr[] = [];

      try {
        const { data: visitesData, error: visitesErr } = await supabase.from('visites').select('*').order('created_at', { ascending: false });
        if (!visitesErr && visitesData !== null) {
          if (visitesData.length > 0) {
            visites = visitesData.map(toVisite);
          } else {
            const sv = await AsyncStorage.getItem(MOCK_VISITES_KEY).catch(() => null);
            const localVisites: Visite[] = sv ? (JSON.parse(sv) ?? []) : [];
            if (localVisites.length > 0) {
              visites = localVisites;
              const vSyncOrgId = currentUserOrgIdRef.current;
              (async () => {
                for (const v of localVisites) {
                  const { error: syncErr } = await supabase.from('visites').upsert(fromVisite(v, vSyncOrgId));
                }
              })();
            }
          }
        } else {
          const sv = await AsyncStorage.getItem(MOCK_VISITES_KEY).catch(() => null);
          if (sv) { const p = JSON.parse(sv); if (Array.isArray(p)) visites = p; }
        }
      } catch {
        const sv = await AsyncStorage.getItem(MOCK_VISITES_KEY).catch(() => null);
        if (sv) { const p = JSON.parse(sv); if (Array.isArray(p)) visites = p; }
      }

      try {
        const { data: lotsData, error: lotsErr } = await supabase.from('lots').select('*');
        if (!lotsErr && lotsData && lotsData.length > 0) {
          lots = lotsData.map(toLot);
        } else {
          const sl = await AsyncStorage.getItem(MOCK_LOTS_KEY).catch(() => null);
          if (sl) { const p = JSON.parse(sl); if (Array.isArray(p) && p.length > 0) lots = p; }
        }
      } catch {
        const sl = await AsyncStorage.getItem(MOCK_LOTS_KEY).catch(() => null);
        if (sl) { const p = JSON.parse(sl); if (Array.isArray(p) && p.length > 0) lots = p; }
      }

      try {
        const { data: oprsData, error: oprsErr } = await supabase.from('oprs').select('*').order('created_at', { ascending: false });
        if (!oprsErr && oprsData !== null) {
          if (oprsData.length > 0) {
            oprs = oprsData.map(toOpr);
          } else {
            const so = await AsyncStorage.getItem(MOCK_OPRS_KEY).catch(() => null);
            const localOprs: Opr[] = so ? (JSON.parse(so) ?? []) : [];
            if (localOprs.length > 0) {
              oprs = localOprs;
              const oSyncOrgId = currentUserOrgIdRef.current;
              (async () => {
                for (const o of localOprs) {
                  const { error: syncErr } = await supabase.from('oprs').upsert(fromOpr(o, oSyncOrgId));
                }
              })();
            }
          }
        } else {
          const so = await AsyncStorage.getItem(MOCK_OPRS_KEY).catch(() => null);
          if (so) { const p = JSON.parse(so); if (Array.isArray(p)) oprs = p; }
        }
      } catch {
        const so = await AsyncStorage.getItem(MOCK_OPRS_KEY).catch(() => null);
        if (so) { const p = JSON.parse(so); if (Array.isArray(p)) oprs = p; }
      }

      if (loadGenerationRef.current !== myGen) {
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }

      debugLogOk(`[AppContext] Visites=${visites.length}, Lots=${lots.length}, OPRs=${oprs.length} → dispatch final`);
      dispatch({ type: 'SET_VISITES', payload: visites.filter(v => isChantierIdVisible(v.chantierId)) });
      dispatch({ type: 'SET_LOTS', payload: lots.filter(l => isChantierIdVisible(l.chantierId)) });
      dispatch({ type: 'SET_OPRS', payload: oprs.filter(o => isChantierIdVisible(o.chantierId)) });
      debugLogOk('[AppContext] loadAll() → ✓ TERMINÉ AVEC SUCCÈS');

    } catch (err: any) {
      debugLogError(`[AppContext] loadAll() → EXCEPTION: ${err?.message ?? String(err)}`);
      dispatch({ type: 'SET_LOADING', payload: false });
      Alert.alert(
        'Erreur de connexion',
        'Impossible de charger les données. Vérifiez votre connexion internet.',
        [{ text: 'Réessayer', onPress: loadAll }, { text: 'Ignorer', style: 'cancel' }]
      );
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      loadMockData();
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: any, session: any) => {
      debugLog(`[AppContext] onAuthStateChange → event=${event}, session=${session ? session.user?.email : 'null'}`);

      // ── Guard 1: ignore ALL events until INITIAL_SESSION fires ────────────
      // Supabase emits SIGNED_OUT/SIGNED_IN for each seeding sign-in/out
      // before INITIAL_SESSION arrives. Reacting to those clears app data
      // before the user's real session is known.
      if (!initialSessionReceivedRef.current && event !== 'INITIAL_SESSION') {
        debugLogWarn(`[AppContext] onAuthStateChange ignoré (avant INITIAL_SESSION) event=${event}`);
        return;
      }

      // ── Guard 2: ignore events fired by the demo-user seeding process ─────
      // The seed signs in/out each demo user; AuthContext already ignores
      // these via isSeedingRef — AppContext must do the same via the shared flag.
      if (globalSeedingRef.current) {
        debugLogWarn(`[AppContext] onAuthStateChange ignoré (seeding en cours) event=${event}`);
        return;
      }

      if (event === 'INITIAL_SESSION') {
        initialSessionReceivedRef.current = true;
        if (session) {
          loadGenerationRef.current++;
          debugLog(`[AppContext] → déclenchement loadAll() (INITIAL_SESSION, gen=${loadGenerationRef.current})`);
          loadAll();
        } else {
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      } else if (event === 'SIGNED_IN' && session) {
        loadGenerationRef.current++;
        debugLog(`[AppContext] → déclenchement loadAll() (gen=${loadGenerationRef.current})`);
        loadAll();
      } else if (event === 'SIGNED_OUT') {
        loadGenerationRef.current++;
        debugLogWarn(`[AppContext] SIGNED_OUT → effacement données (gen=${loadGenerationRef.current})`);
        currentUserNameRef.current = '';
        currentUserOrgIdRef.current = null;
        loadedChannelIdsRef.current.clear();
        // Vider toutes les données utilisateur en mémoire
        dispatch({ type: 'INIT', payload: { reserves: [], companies: [], tasks: [], documents: [], photos: [], messages: [], profiles: [] } });
        dispatch({ type: 'SET_CUSTOM_CHANNELS', payload: [] });
        dispatch({ type: 'SET_GROUP_CHANNELS', payload: [] });
        dispatch({ type: 'SET_PINNED_CHANNELS', payload: [] });
        dispatch({ type: 'SET_CHANTIERS', payload: [] });
        dispatch({ type: 'SET_SITE_PLANS', payload: [] });
        dispatch({ type: 'SET_VISITES', payload: [] });
        dispatch({ type: 'SET_LOTS', payload: [] });
        dispatch({ type: 'SET_OPRS', payload: [] });
        dispatch({ type: 'SET_ACTIVE_CHANTIER', payload: null });
        setPendingDmChannelIds(new Set());
        // Effacer TOUT le cache local lié à l'utilisateur déconnecté
        AsyncStorage.multiRemove([
          PENDING_DM_KEY,
          CUSTOM_CHANNELS_KEY,
          GROUP_CHANNELS_KEY,
          PINNED_CHANNELS_KEY,
          CHANNEL_MEMBERS_OVERRIDE_KEY,
          'lastReadByChannel',
          ACTIVE_CHANTIER_KEY,
          MOCK_RESERVES_KEY,
          MOCK_TASKS_KEY,
          MOCK_PHOTOS_KEY,
          MOCK_MESSAGES_KEY,
          MOCK_CHANTIERS_KEY,
          MOCK_SITE_PLANS_KEY,
          MOCK_VISITES_KEY,
          MOCK_LOTS_KEY,
          MOCK_OPRS_KEY,
          MOCK_COMPANIES_KEY,
          'buildtrack_mock_documents_v2',
        ]).catch(() => {});
      }
    });

    supabase.auth.getSession().then(({ data: { session } }: { data: { session: any } }) => {
      // INITIAL_SESSION from onAuthStateChange already triggers loadAll() for an existing session.
      // We only need to handle the "no session" case here to clear the loading flag.
      if (!session) dispatch({ type: 'SET_LOADING', payload: false });
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const globalSub = supabase
      .channel('global-messages-v2')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload: any) => {
        const userName = currentUserNameRef.current;
        const msg = toMessage(payload.new, userName);
        if (!msg.isMe) {
          dispatch({ type: 'INCOMING_MESSAGE', payload: msg });
          if (activeChannelIdRef.current !== msg.channelId) {
            const ch = channelsRef.current.find(c => c.id === msg.channelId);
            const isDM = msg.channelId.startsWith('dm-');
            setNotification({
              msg,
              channelName: isDM ? msg.sender : (ch?.name ?? msg.channelId),
              channelColor: ch?.color ?? C.primary,
              channelIcon: isDM ? 'person-circle' : (ch?.icon ?? 'chatbubbles'),
            });
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload: any) => {
        const userName = currentUserNameRef.current;
        const incoming = toMessage(payload.new, userName);
        if (incoming.isMe) {
          // Pour les messages envoyés par l'utilisateur courant, on n'applique le
          // UPDATE Supabase que si les réactions ou les lecteurs ont changé côté serveur
          // (mis à jour par d'autres utilisateurs). Cela évite un double-render inutile
          // après l'update optimiste local.
          const current = stateRef.current.messages.find(m => m.id === incoming.id);
          if (current) {
            const reactionsChanged = JSON.stringify(incoming.reactions) !== JSON.stringify(current.reactions);
            const readByChanged = (incoming.readBy?.length ?? 0) !== (current.readBy?.length ?? 0);
            if (!reactionsChanged && !readByChanged) return;
          }
        }
        dispatch({ type: 'UPDATE_MESSAGE', payload: incoming });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload: any) => {
        dispatch({ type: 'DELETE_MESSAGE', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
        if (err) console.warn('[Realtime] messages error:', err.message);
        else if (status !== 'SUBSCRIBED') console.log('[Realtime] messages status:', status);
      });

    return () => { supabase.removeChannel(globalSub); };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channelSub = supabase
      .channel('realtime-channels-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channels' }, (payload: any) => {
        const r = payload.new;
        const ch: Channel = {
          id: r.id, name: r.name, description: r.description ?? '',
          icon: r.icon, color: r.color, type: r.type,
          members: r.members ?? [], createdBy: r.created_by ?? undefined,
        };
        if (r.type === 'custom') {
          dispatch({ type: 'ADD_CUSTOM_CHANNEL', payload: ch });
        } else if (r.type === 'group') {
          dispatch({ type: 'ADD_GROUP_CHANNEL', payload: ch });
        } else if (r.type === 'dm') {
          const myName = currentUserNameRef.current;
          const participants: string[] = r.members ?? [];
          if (!myName || participants.includes(myName)) {
            // Recalculer le nom affiché depuis la liste members (point de vue
            // agnostique du créateur), pour que le destinataire voie le bon nom.
            const otherName = participants.find(p => p !== myName) ?? r.name;
            dispatch({
              type: 'ADD_PERSISTED_DM_CHANNEL',
              payload: { ...ch, name: otherName, dmParticipants: participants },
            });
          }
        } else if (r.type === 'general' || r.type === 'building') {
          const alreadyExists = (stateRef.current.generalChannels ?? []).some(c => c.id === ch.id);
          if (!alreadyExists) {
            dispatch({ type: 'SET_GENERAL_CHANNELS', payload: [...(stateRef.current.generalChannels ?? []), ch] });
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'channels' }, (payload: any) => {
        const r = payload.new;
        const participants: string[] = r.members ?? [];
        const myName = currentUserNameRef.current;
        const displayName = r.type === 'dm'
          ? (participants.find((p: string) => p !== myName) ?? r.name)
          : r.name;
        const ch: Channel = {
          id: r.id, name: displayName, description: r.description ?? '',
          icon: r.icon, color: r.color, type: r.type,
          members: participants, createdBy: r.created_by ?? undefined,
          ...(r.type === 'dm' ? { dmParticipants: participants } : {}),
        };
        dispatch({ type: 'UPDATE_CHANNEL', payload: ch });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'channels' }, (payload: any) => {
        const r = payload.old;
        if (r.type === 'custom') dispatch({ type: 'REMOVE_CUSTOM_CHANNEL', payload: r.id });
        else if (r.type === 'group') dispatch({ type: 'REMOVE_GROUP_CHANNEL', payload: r.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] channels error:', err.message);
        else console.log('[Realtime] channels:', status);
      });

    return () => { supabase.removeChannel(channelSub); };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const reserveSub = supabase
      .channel('realtime-reserves-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reserves' }, (payload: any) => {
        const r = toReserve(payload.new);
        dispatch({ type: 'ADD_RESERVE', payload: r });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reserves' }, (payload: any) => {
        const r = toReserve(payload.new);
        dispatch({ type: 'UPDATE_RESERVE', payload: r });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reserves' }, (payload: any) => {
        dispatch({ type: 'DELETE_RESERVE', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] reserves error:', err.message);
        else console.log('[Realtime] reserves:', status);
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    const taskSub = supabase
      .channel('realtime-tasks-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, (payload: any) => {
        dispatch({ type: 'ADD_TASK', payload: toTask(payload.new) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, (payload: any) => {
        dispatch({ type: 'UPDATE_TASK', payload: toTask(payload.new) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, (payload: any) => {
        dispatch({ type: 'DELETE_TASK', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] tasks error:', err.message);
        else console.log('[Realtime] tasks:', status);
      });

    return () => {
      supabase.removeChannel(reserveSub);
      supabase.removeChannel(taskSub);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const chantierSub = supabase
      .channel('realtime-chantiers-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chantiers' }, (payload: any) => {
        dispatch({ type: 'ADD_CHANTIER', payload: toChantier(payload.new) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chantiers' }, (payload: any) => {
        dispatch({ type: 'UPDATE_CHANTIER', payload: toChantier(payload.new) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chantiers' }, (payload: any) => {
        dispatch({ type: 'DELETE_CHANTIER', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] chantiers error:', err.message);
        else console.log('[Realtime] chantiers:', status);
      });

    const sitePlanSub = supabase
      .channel('realtime-site-plans-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_plans' }, (payload: any) => {
        dispatch({ type: 'ADD_SITE_PLAN', payload: toSitePlan(payload.new) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'site_plans' }, (payload: any) => {
        dispatch({ type: 'UPDATE_SITE_PLAN', payload: toSitePlan(payload.new) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'site_plans' }, (payload: any) => {
        dispatch({ type: 'DELETE_SITE_PLAN', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] site_plans error:', err.message);
        else console.log('[Realtime] site_plans:', status);
      });

    const visiteSub = supabase
      .channel('realtime-visites-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visites' }, (payload: any) => {
        dispatch({ type: 'ADD_VISITE', payload: toVisite(payload.new) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'visites' }, (payload: any) => {
        dispatch({ type: 'UPDATE_VISITE', payload: toVisite(payload.new) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'visites' }, (payload: any) => {
        dispatch({ type: 'DELETE_VISITE', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] visites error:', err.message);
        else console.log('[Realtime] visites:', status);
      });

    const oprSub = supabase
      .channel('realtime-oprs-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'oprs' }, (payload: any) => {
        dispatch({ type: 'ADD_OPR', payload: toOpr(payload.new) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'oprs' }, (payload: any) => {
        dispatch({ type: 'UPDATE_OPR', payload: toOpr(payload.new) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'oprs' }, (payload: any) => {
        dispatch({ type: 'DELETE_OPR', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] oprs error:', err.message);
        else console.log('[Realtime] oprs:', status);
      });

    const lotSub = supabase
      .channel('realtime-lots-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lots' }, (payload: any) => {
        dispatch({ type: 'ADD_LOT', payload: toLot(payload.new) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lots' }, (payload: any) => {
        dispatch({ type: 'UPDATE_LOT', payload: toLot(payload.new) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'lots' }, (payload: any) => {
        dispatch({ type: 'DELETE_LOT', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] lots error:', err.message);
        else console.log('[Realtime] lots:', status);
      });

    const companySub = supabase
      .channel('realtime-companies-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'companies' }, (payload: any) => {
        dispatch({ type: 'ADD_COMPANY', payload: toCompany(payload.new) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'companies' }, (payload: any) => {
        dispatch({ type: 'UPDATE_COMPANY_FULL', payload: toCompany(payload.new) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'companies' }, (payload: any) => {
        dispatch({ type: 'DELETE_COMPANY', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] companies error:', err.message);
        else console.log('[Realtime] companies:', status);
      });

    const photoSub = supabase
      .channel('realtime-photos-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'photos' }, (payload: any) => {
        dispatch({ type: 'ADD_PHOTO', payload: toPhoto(payload.new) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'photos' }, (payload: any) => {
        dispatch({ type: 'DELETE_PHOTO', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] photos error:', err.message);
        else console.log('[Realtime] photos:', status);
      });

    const documentSub = supabase
      .channel('realtime-documents-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'documents' }, (payload: any) => {
        dispatch({ type: 'ADD_DOCUMENT', payload: toDocument(payload.new) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'documents' }, (payload: any) => {
        dispatch({ type: 'DELETE_DOCUMENT', payload: payload.old.id });
      })
      .subscribe((status: string, err?: Error) => {
        if (err) console.warn('[Realtime] documents error:', err.message);
        else console.log('[Realtime] documents:', status);
      });

    return () => {
      supabase.removeChannel(chantierSub);
      supabase.removeChannel(sitePlanSub);
      supabase.removeChannel(visiteSub);
      supabase.removeChannel(oprSub);
      supabase.removeChannel(lotSub);
      supabase.removeChannel(companySub);
      supabase.removeChannel(photoSub);
      supabase.removeChannel(documentSub);
    };
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4500);
    return () => clearTimeout(timer);
  }, [notification]);

  const persistMessagesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured) {
      if (persistMessagesTimerRef.current) clearTimeout(persistMessagesTimerRef.current);
      persistMessagesTimerRef.current = setTimeout(() => {
        persistMockMessages(state.messages);
      }, 1500);
    }
    return () => {
      if (persistMessagesTimerRef.current) clearTimeout(persistMessagesTimerRef.current);
    };
  }, [state.messages]);

  function setCurrentUser(name: string) {
    currentUserNameRef.current = name;
    dispatch({
      type: 'INIT',
      payload: {
        reserves: stateRef.current.reserves,
        companies: stateRef.current.companies,
        tasks: stateRef.current.tasks,
        documents: stateRef.current.documents,
        photos: stateRef.current.photos,
        messages: stateRef.current.messages.map(m => ({ ...m, isMe: m.sender === name })),
        profiles: stateRef.current.profiles,
      },
    });
  }

  const companyChannels: Channel[] = (() => {
    const seenNames = new Set<string>();
    return state.companies.filter(co => {
      const key = co.name.trim().toLowerCase();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    }).map(co => ({
      id: `company-${co.id}`,
      name: co.name,
      description: `Canal de l'entreprise ${co.name}`,
      icon: 'people' as const,
      color: co.color,
      type: 'company' as const,
    }));
  })();

  const dmChannelIds = new Set([
    ...(state.messages ?? [])
      .filter(m => m.channelId.startsWith('dm-'))
      .map(m => m.channelId),
    ...Array.from(pendingDmChannelIds),
    ...(state.persistedDmChannels ?? []).map(c => c.id),
  ]);

  const dmChannelRemapsRef = useRef<Array<{ fromId: string; toId: string }>>([]);
  const dmChannels: Channel[] = (() => {
    const all = Array.from(dmChannelIds).map(chId => {
      // Prefer data loaded from Supabase if available
      const persisted = (state.persistedDmChannels ?? []).find(c => c.id === chId);
      if (persisted) return persisted;
      const parts = chId.replace('dm-', '').split('__');
      const myName = currentUserNameRef.current;
      const otherName = parts.find(p => p !== myName) ?? parts[0];
      return {
        id: chId,
        name: otherName,
        description: `Message direct avec ${otherName}`,
        icon: 'person-circle',
        color: '#EC4899',
        type: 'dm' as const,
        dmParticipants: parts,
      };
    });
    // Deduplicate: if two channels have the same other participant name (e.g. one local
    // + one from Supabase with a slightly different ID), keep the Supabase-persisted one.
    // Also collect remappings so local messages can be migrated to the canonical Supabase ID.
    const byName = new Map<string, Channel>();
    const remaps: Array<{ fromId: string; toId: string }> = [];
    for (const ch of all) {
      const key = ch.name.toLowerCase().trim();
      if (!byName.has(key)) {
        byName.set(key, ch);
      } else {
        const isPersisted = (state.persistedDmChannels ?? []).some(c => c.id === ch.id);
        if (isPersisted) {
          // Current ch is the Supabase winner, existing entry is the local loser
          remaps.push({ fromId: byName.get(key)!.id, toId: ch.id });
          byName.set(key, ch);
        } else {
          // Current ch is the local loser, existing entry is the Supabase winner
          remaps.push({ fromId: ch.id, toId: byName.get(key)!.id });
        }
      }
    }
    dmChannelRemapsRef.current = remaps;
    return Array.from(byName.values());
  })();

  // Migrate local messages from duplicate DM channel IDs to the canonical Supabase ID.
  // Also clean up the stale pending DM ID so the duplicate never reappears.
  const appliedRemapsRef = useRef(new Set<string>());
  useEffect(() => {
    for (const { fromId, toId } of dmChannelRemapsRef.current) {
      const key = `${fromId}->${toId}`;
      if (appliedRemapsRef.current.has(key)) continue;
      appliedRemapsRef.current.add(key);
      // Re-assign messages stored under the old local ID to the Supabase channel ID
      dispatch({ type: 'REMAP_DM_CHANNEL', payload: { fromId, toId } });
      // Remove the stale local pending channel ID
      setPendingDmChannelIds(prev => {
        const next = new Set(prev);
        if (!next.has(fromId)) return prev;
        next.delete(fromId);
        AsyncStorage.setItem(PENDING_DM_KEY, JSON.stringify([...next])).catch(() => {});
        return next;
      });
    }
  });

  const channels: Channel[] = [
    ...STATIC_CHANNELS,
    ...(state.generalChannels ?? []),
    ...companyChannels,
    ...(state.customChannels ?? []),
    ...(state.groupChannels ?? []),
    ...dmChannels,
  ];

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  function frTimestampToMs(ts: string): number {
    // Tente le format français dd/mm/yyyy hh:mm
    const match = ts.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
    if (match) {
      const [, dd, mm, yyyy, hh, min] = match;
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
      return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    // Fallback : ISO 8601 ou autre format reconnu par Date
    const d = new Date(ts);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  // P15: useMemo pour éviter le recalcul O(N×M) à chaque render d'AppContext
  const unreadByChannel = useMemo(() => {
    const result: Record<string, number> = {};
    // P14 pattern: une seule passe pour construire l'index ms par message
    // Fix: utiliser dbCreatedAt (ISO UTC Supabase) quand disponible pour éviter
    // le décalage timezone entre le timestamp FR (heure locale) et lastRead (UTC ISO).
    // Fallback sur frTimestampToMs pour les messages locaux hors-ligne uniquement.
    const msgMsByChannel: Record<string, number[]> = {};
    for (const m of state.messages) {
      if (m.isMe) continue; // les messages envoyés par soi ne comptent pas comme non-lus
      if (!msgMsByChannel[m.channelId]) msgMsByChannel[m.channelId] = [];
      const ms = m.dbCreatedAt
        ? new Date(m.dbCreatedAt).getTime()
        : frTimestampToMs(m.timestamp);
      msgMsByChannel[m.channelId].push(ms);
    }
    for (const ch of channels) {
      const lastRead = state.lastReadByChannel[ch.id];
      const lastReadMs = lastRead ? new Date(lastRead).getTime() : 0;
      const times = msgMsByChannel[ch.id] ?? [];
      result[ch.id] = times.filter(t => t > lastReadMs).length;
    }
    return result;
    // frTimestampToMs est une fonction pure définie dans ce composant (stable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.messages, state.lastReadByChannel, channels]);

  const reservesForStats = state.activeChantierId
    ? state.reserves.filter(r => r.chantierId === state.activeChantierId)
    : state.reserves;

  const stats = {
    total: reservesForStats.length,
    open: reservesForStats.filter(r => r.status === 'open').length,
    inProgress: reservesForStats.filter(r => r.status === 'in_progress').length,
    waiting: reservesForStats.filter(r => r.status === 'waiting').length,
    verification: reservesForStats.filter(r => r.status === 'verification').length,
    closed: reservesForStats.filter(r => r.status === 'closed').length,
    progress: reservesForStats.length > 0
      ? Math.round((reservesForStats.filter(r => r.status === 'closed').length / reservesForStats.length) * 100) : 0,
    totalWorkers: state.companies.reduce((s, c) => s + c.actualWorkers, 0),
    plannedWorkers: state.companies.reduce((s, c) => s + c.plannedWorkers, 0),
  };

  const unreadCount = Object.values(unreadByChannel).reduce((a, b) => a + b, 0);

  function addCustomChannel(name: string, description: string, icon: string, color: string): Channel {
    const creator = currentUserNameRef.current;
    const newCh: Channel = {
      id: 'custom-' + genId(),
      name, description, icon, color,
      type: 'custom',
      createdBy: creator,
      members: creator ? [creator] : [],
    };
    dispatch({ type: 'ADD_CUSTOM_CHANNEL', payload: newCh });
    const updated = [...stateRef.current.customChannels, newCh];
    saveCustomChannels(updated);
    return newCh;
  }

  function removeCustomChannel(id: string) {
    const updated = stateRef.current.customChannels.filter(c => c.id !== id);
    dispatch({ type: 'REMOVE_CUSTOM_CHANNEL', payload: id });
    saveCustomChannels(updated);
    if (isSupabaseConfigured) {
      supabase.from('channels').delete().eq('id', id).then(({ error }: { error: any }) => {
      });
    }
  }

  function addGroupChannel(name: string, members: string[], color: string): Channel {
    const creator = currentUserNameRef.current;
    const allMembers = creator && !members.includes(creator) ? [creator, ...members] : members;
    const newCh: Channel = {
      id: 'group-' + genId(),
      name,
      description: `Groupe : ${allMembers.join(', ')}`,
      icon: 'people-circle',
      color,
      type: 'group',
      members: allMembers,
      createdBy: creator,
    };
    dispatch({ type: 'ADD_GROUP_CHANNEL', payload: newCh });
    const updated = [...stateRef.current.groupChannels, newCh];
    saveGroupChannels(updated);
    return newCh;
  }

  function removeGroupChannel(id: string) {
    const updated = stateRef.current.groupChannels.filter(c => c.id !== id);
    dispatch({ type: 'REMOVE_GROUP_CHANNEL', payload: id });
    saveGroupChannels(updated);
    if (isSupabaseConfigured) {
      supabase.from('channels').delete().eq('id', id).then(({ error }: { error: any }) => {
      });
    }
  }

  function _updateAndPersistChannel(updatedCh: Channel) {
    const newCustomChannels = stateRef.current.customChannels.map(c => c.id === updatedCh.id ? updatedCh : c);
    const newGroupChannels = stateRef.current.groupChannels.map(c => c.id === updatedCh.id ? updatedCh : c);
    dispatch({ type: 'UPDATE_CHANNEL', payload: updatedCh });
    if (updatedCh.type === 'custom') {
      saveCustomChannels(newCustomChannels);
    } else if (updatedCh.type === 'group') {
      saveGroupChannels(newGroupChannels);
    }
  }

  function updateCustomChannel(id: string, updates: Partial<Pick<Channel, 'name' | 'description' | 'icon' | 'color'>>) {
    const ch = [...stateRef.current.customChannels, ...stateRef.current.groupChannels].find(c => c.id === id);
    if (ch) {
      _updateAndPersistChannel({ ...ch, ...updates });
    }
  }

  function renameChannel(id: string, newName: string) {
    const ch = [...stateRef.current.customChannels, ...stateRef.current.groupChannels].find(c => c.id === id);
    if (ch) {
      _updateAndPersistChannel({ ...ch, name: newName });
      return;
    }
    if (id.startsWith('company-')) {
      const companyId = id.replace('company-', '');
      const company = stateRef.current.companies.find(co => co.id === companyId);
      if (company) {
        const updatedCompany = { ...company, name: newName };
        if (isSupabaseConfigured) {
          supabase.from('companies').update({ name: newName }).eq('id', companyId).then(({ error }: { error: any }) => {
          });
        }
        dispatch({ type: 'UPDATE_COMPANY_FULL', payload: updatedCompany });
      }
    }
  }

  function addChannelMember(id: string, memberName: string) {
    const ch = [...stateRef.current.customChannels, ...stateRef.current.groupChannels].find(c => c.id === id);
    if (ch) {
      const members = [...(ch.members ?? [])];
      if (members.includes(memberName)) return;
      members.push(memberName);
      _updateAndPersistChannel({
        ...ch, members,
        description: ch.type === 'group' ? `Groupe : ${members.join(', ')}` : ch.description,
      });
    } else {
      const current = stateRef.current.channelMembersOverride[id] ?? [];
      if (current.includes(memberName)) return;
      const updated = [...current, memberName];
      const newOverrides = { ...stateRef.current.channelMembersOverride, [id]: updated };
      dispatch({ type: 'SET_CHANNEL_MEMBERS_OVERRIDE', payload: newOverrides });
      saveChannelMembersOverride(newOverrides);
    }
  }

  function removeChannelMember(id: string, memberName: string) {
    const ch = [...stateRef.current.customChannels, ...stateRef.current.groupChannels].find(c => c.id === id);
    if (ch) {
      const members = (ch.members ?? []).filter(m => m !== memberName);
      _updateAndPersistChannel({
        ...ch, members,
        description: ch.type === 'group' ? `Groupe : ${members.join(', ')}` : ch.description,
      });
    } else {
      const current = stateRef.current.channelMembersOverride[id] ?? [];
      const updated = current.filter(m => m !== memberName);
      const newOverrides = { ...stateRef.current.channelMembersOverride, [id]: updated };
      dispatch({ type: 'SET_CHANNEL_MEMBERS_OVERRIDE', payload: newOverrides });
      saveChannelMembersOverride(newOverrides);
    }
  }

  function pinChannel(id: string): { success: boolean; reason?: string } {
    if (stateRef.current.pinnedChannelIds.includes(id)) return { success: false, reason: 'already_pinned' };
    if (stateRef.current.pinnedChannelIds.length >= MAX_PINNED) return { success: false, reason: 'limit_reached' };
    const updated = [...stateRef.current.pinnedChannelIds, id];
    dispatch({ type: 'SET_PINNED_CHANNELS', payload: updated });
    savePinnedChannels(updated);
    return { success: true };
  }

  function unpinChannel(id: string) {
    const updated = stateRef.current.pinnedChannelIds.filter(pid => pid !== id);
    dispatch({ type: 'SET_PINNED_CHANNELS', payload: updated });
    savePinnedChannels(updated);
  }

  function getOrCreateDMChannel(otherName: string): Channel {
    const myName = currentUserNameRef.current;
    const chId = dmChannelId(myName, otherName);
    const existing = dmChannels.find(c => c.id === chId);
    if (existing) return existing;

    const newChannel: Channel = {
      id: chId,
      name: otherName,
      description: `Message direct avec ${otherName}`,
      icon: 'person-circle',
      color: '#EC4899',
      type: 'dm',
      dmParticipants: [myName, otherName],
    };

    // Persister dans Supabase pour que le destinataire voie le canal.
    // On stocke la promesse afin qu'addMessage puisse l'attendre avant
    // d'insérer le premier message (Fix 1 — race condition DM).
    if (isSupabaseConfigured) {
      const orgId = currentUserOrgIdRef.current;
      const upsertPromise: Promise<void> = supabase.from('channels').upsert({
        id: chId,
        name: otherName,
        description: `Message direct avec ${otherName}`,
        icon: 'person-circle',
        color: '#EC4899',
        type: 'dm',
        members: [myName, otherName],
        created_by: myName,
        organization_id: orgId ?? null,
      }).then(() => {
        dmUpsertPromisesRef.current.delete(chId);
      }).catch(() => {
        dmUpsertPromisesRef.current.delete(chId);
      });
      dmUpsertPromisesRef.current.set(chId, upsertPromise);
    }

    // Cache local pour mode hors-ligne
    const newPending = new Set(pendingDmChannelIds).add(chId);
    setPendingDmChannelIds(newPending);
    AsyncStorage.setItem(PENDING_DM_KEY, JSON.stringify([...newPending])).catch(() => {});

    return newChannel;
  }

  const value: AppContextValue = {
    ...state,
    companies: state.companies.filter((c, i, arr) => arr.findIndex(x => x.name === c.name) === i),
    stats, unreadCount, channels, unreadByChannel, notification, realtimeConnected,
    setActiveChannelId,
    dismissNotification,

    addReserve: (r) => {
      dispatch({ type: 'ADD_RESERVE', payload: r });
      persistMockReserves([r, ...stateRef.current.reserves]);
      if (offline({ table: 'reserves', op: 'insert', data: { id: r.id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          try {
            let orgId = currentUserOrgIdRef.current;
            if (!orgId) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) {
                const { data: prof } = await supabase
                  .from('profiles').select('organization_id')
                  .eq('id', session.user.id).single();
                orgId = prof?.organization_id ?? null;
                if (orgId) currentUserOrgIdRef.current = orgId;
              }
            }
            const payload = {
              id: r.id, title: r.title, description: r.description, building: r.building,
              zone: r.zone, level: r.level,
              company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? null,
              companies: r.companies ?? (r.company ? [r.company] : []),
              priority: r.priority, status: r.status, created_at: r.createdAt, deadline: r.deadline,
              comments: r.comments, history: r.history,
              plan_x: r.planX ?? 50, plan_y: r.planY ?? 50,
              photo_uri: r.photoUri ?? null, lot_id: r.lotId ?? null, kind: r.kind ?? null,
              chantier_id: r.chantierId ?? null, plan_id: r.planId ?? null,
              visite_id: r.visiteId ?? null, linked_task_id: r.linkedTaskId ?? null,
              photos: r.photos ?? null, photo_annotations: r.photoAnnotations ?? null,
              enterprise_signature: r.enterpriseSignature ?? null,
              enterprise_signataire: r.enterpriseSignataire ?? null,
              enterprise_acknowledged_at: r.enterpriseAcknowledgedAt ?? null,
              company_signatures: r.companySignatures ?? null,
              organization_id: orgId,
            };
            let insertPayload = { ...payload };
            let { error } = await supabase.from('reserves').insert(insertPayload);

            if (error?.code === '23505') {
              // Doublon de clé primaire — récupère les IDs existants depuis Supabase
              // et génère un nouvel ID non-conflictuel, puis réessaie
              const { data: remoteIds } = await supabase
                .from('reserves')
                .select('id')
                .eq('organization_id', orgId ?? '');
              const remoteReserves = (remoteIds ?? []) as { id: string }[];
              const newId = genReserveId(remoteReserves);
              insertPayload = { ...insertPayload, id: newId };
              const { error: retryError } = await supabase.from('reserves').insert(insertPayload);
              if (!retryError) {
                // Met à jour l'ID dans l'état local
                dispatch({ type: 'UPDATE_RESERVE', payload: { ...r, id: newId } });
                persistMockReserves(
                  stateRef.current.reserves.map(res => res.id === r.id ? { ...res, id: newId } : res)
                );
              } else {
                error = retryError;
              }
            }

            if (error) {
              console.error('[sync] addReserve Supabase error:', error.code, error.message, error.details);
              Alert.alert(
                'Erreur de synchronisation',
                `La réserve a été sauvegardée localement mais n'a pas pu être envoyée au serveur.\n\nCode: ${error.code}\n${error.message}`,
                [{ text: 'OK' }]
              );
            }
          } catch (e: any) {
            console.error('[sync] addReserve exception:', e?.message ?? e);
          }
        })();
      }
    },

    updateReserve: (r) => {
      const previous = stateRef.current.reserves.find(res => res.id === r.id);
      const newReserves = stateRef.current.reserves.map(res => res.id === r.id ? r : res);
      dispatch({ type: 'UPDATE_RESERVE', payload: r });
      // Always persist locally first so data survives Supabase failures or restarts
      persistMockReserves(newReserves);
      if (offline({ table: 'reserves', op: 'update', filter: { column: 'id', value: r.id }, data: {
        title: r.title, description: r.description, building: r.building,
        zone: r.zone, level: r.level,
        company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? null,
        companies: r.companies ?? (r.company ? [r.company] : []),
        priority: r.priority, status: r.status, deadline: r.deadline,
        comments: r.comments, history: r.history,
        plan_x: r.planX ?? 50, plan_y: r.planY ?? 50, photo_uri: r.photoUri ?? null,
        lot_id: r.lotId ?? null, kind: r.kind ?? null,
        chantier_id: r.chantierId ?? null, plan_id: r.planId ?? null,
        visite_id: r.visiteId ?? null, linked_task_id: r.linkedTaskId ?? null,
        photos: r.photos ?? null, photo_annotations: r.photoAnnotations ?? null,
        closed_at: r.closedAt ?? null, closed_by: r.closedBy ?? null,
        enterprise_signature: r.enterpriseSignature ?? null,
        enterprise_signataire: r.enterpriseSignataire ?? null,
        enterprise_acknowledged_at: r.enterpriseAcknowledgedAt ?? null,
        company_signatures: r.companySignatures ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({
          title: r.title, description: r.description, building: r.building,
          zone: r.zone, level: r.level,
          company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? null,
          companies: r.companies ?? (r.company ? [r.company] : []),
          priority: r.priority,
          status: r.status, deadline: r.deadline, comments: r.comments, history: r.history,
          plan_x: r.planX ?? 50, plan_y: r.planY ?? 50, photo_uri: r.photoUri ?? null,
          lot_id: r.lotId ?? null,
          kind: r.kind ?? null,
          chantier_id: r.chantierId ?? null,
          plan_id: r.planId ?? null,
          visite_id: r.visiteId ?? null,
          linked_task_id: r.linkedTaskId ?? null,
          photos: r.photos ?? null,
          photo_annotations: r.photoAnnotations ?? null,
          closed_at: r.closedAt ?? null,
          closed_by: r.closedBy ?? null,
          enterprise_signature: r.enterpriseSignature ?? null,
          enterprise_signataire: r.enterpriseSignataire ?? null,
          enterprise_acknowledged_at: r.enterpriseAcknowledgedAt ?? null,
          company_signatures: r.companySignatures ?? null,
        }).eq('id', r.id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateReserve server error (data saved locally):', error.message);
          }
        });
      }
    },

    updateReserveFields: (r) => {
      const previous = stateRef.current.reserves.find(res => res.id === r.id);
      const newReserves = stateRef.current.reserves.map(res => res.id === r.id ? r : res);
      dispatch({ type: 'UPDATE_RESERVE_FIELDS', payload: r });
      // Always persist locally first so data survives Supabase failures or restarts
      persistMockReserves(newReserves);
      if (offline({ table: 'reserves', op: 'update', filter: { column: 'id', value: r.id }, data: {
        title: r.title, description: r.description, building: r.building,
        zone: r.zone, level: r.level,
        company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? null,
        companies: r.companies ?? (r.company ? [r.company] : []),
        priority: r.priority, status: r.status, deadline: r.deadline,
        comments: r.comments, history: r.history,
        photo_uri: r.photoUri ?? null, lot_id: r.lotId ?? null, kind: r.kind ?? null,
        photos: r.photos ?? null, photo_annotations: r.photoAnnotations ?? null,
        enterprise_signature: r.enterpriseSignature ?? null,
        enterprise_signataire: r.enterpriseSignataire ?? null,
        enterprise_acknowledged_at: r.enterpriseAcknowledgedAt ?? null,
        company_signatures: r.companySignatures ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({
          title: r.title, description: r.description, building: r.building,
          zone: r.zone, level: r.level,
          company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? null,
          companies: r.companies ?? (r.company ? [r.company] : []),
          priority: r.priority,
          status: r.status, deadline: r.deadline, comments: r.comments, history: r.history,
          photo_uri: r.photoUri ?? null,
          lot_id: r.lotId ?? null,
          kind: r.kind ?? null,
          photos: r.photos ?? null,
          photo_annotations: r.photoAnnotations ?? null,
          enterprise_signature: r.enterpriseSignature ?? null,
          enterprise_signataire: r.enterpriseSignataire ?? null,
          enterprise_acknowledged_at: r.enterpriseAcknowledgedAt ?? null,
          company_signatures: r.companySignatures ?? null,
        }).eq('id', r.id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateReserveFields server error (data saved locally):', error.message);
          }
        });
      }
    },

    deleteReserve: (id) => {
      const previous = stateRef.current.reserves.find(r => r.id === id);
      const newReserves = stateRef.current.reserves.filter(r => r.id !== id);
      dispatch({ type: 'DELETE_RESERVE', payload: id });
      persistMockReserves(newReserves);
      if (offline({ table: 'reserves', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const { data: deleted, error } = await supabase.from('reserves').delete().eq('id', id).select();
          if (error) {
            console.warn('[sync] deleteReserve erreur serveur:', error.message);
            if (previous) {
              dispatch({ type: 'ADD_RESERVE', payload: previous });
              persistMockReserves([previous, ...newReserves]);
              Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cette réserve, ou elle n\'existe plus sur le serveur.');
            }
          } else if (!deleted || deleted.length === 0) {
            console.warn('[sync] deleteReserve: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
          }
        })();
      }
    },

    updateReserveStatus: (id, status, author?: string) => {
      author = author ?? currentUserNameRef.current ?? 'Système';
      const reserve = stateRef.current.reserves.find(r => r.id === id);
      if (!reserve) return;
      const labels: Record<ReserveStatus, string> = {
        open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
        verification: 'Vérification', closed: 'Clôturé',
      };
      const historyEntry = {
        id: genId(),
        action: 'Statut modifié',
        author,
        createdAt: formatDateFR(new Date()),
        oldValue: labels[reserve.status],
        newValue: labels[status],
      };
      const closedAt = status === 'closed' ? new Date().toISOString().split('T')[0] : reserve.closedAt;
      const closedBy = status === 'closed' ? author : reserve.closedBy;
      const updated: Reserve = {
        ...reserve,
        status,
        history: [...reserve.history, historyEntry],
        closedAt,
        closedBy,
      };
      dispatch({ type: 'UPDATE_RESERVE_STATUS', payload: updated });
      persistMockReserves(stateRef.current.reserves.map(r => r.id === id ? updated : r));
      if (offline({
        table: 'reserves', op: 'update',
        filter: { column: 'id', value: id },
        data: { status: updated.status, history: updated.history, closed_at: closedAt ?? null, closed_by: closedBy ?? null },
        conflictCheck: {
          entityId: id,
          previousStatus: reserve.status,
          newStatus: status,
          author: author!,
          history: updated.history,
          closedAt,
          closedBy,
        },
      })) return;
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({
          status: updated.status, history: updated.history,
          closed_at: closedAt ?? null, closed_by: closedBy ?? null,
        }).eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateReserveStatus server error (data saved locally):', error.message);
          }
        });
      }

      const reserveCompanyNames = reserve.companies ?? (reserve.company ? [reserve.company] : []);
      const notifiedCompanies = stateRef.current.companies.filter(c => reserveCompanyNames.includes(c.name));
      const ts = nowTimestampFR();
      for (const company of notifiedCompanies) {
        const notifChannelId = `company-${company.id}`;
        const notifMsg: Message = {
          id: genId(),
          channelId: notifChannelId,
          sender: author,
          content: `Réserve ${reserve.id} — "${reserve.title}" : statut modifié → ${labels[status] ?? status}`,
          timestamp: ts,
          type: 'notification',
          read: false,
          isMe: false,
          reactions: {},
          isPinned: false,
          readBy: [],
          mentions: [],
          reserveId: reserve.id,
        };
        dispatch({ type: 'ADD_MESSAGE', payload: notifMsg });
        if (isSupabaseConfigured) {
          supabase.from('messages').insert(fromMessage(notifMsg)).then(({ error }: { error: any }) => {
            if (error) {
              console.warn('[sync] sendMessage notification insert error:', error.message);
            }
          });
        }
      }
    },

    addComment: (reserveId, content, author = 'Conducteur de travaux') => {
      const reserve = stateRef.current.reserves.find(r => r.id === reserveId);
      if (!reserve) return;
      const actualAuthor = currentUserNameRef.current || author;
      const comment: Comment = {
        id: genId(),
        author: actualAuthor,
        content,
        createdAt: formatDateFR(new Date()),
      };
      const updatedComments = [...reserve.comments, comment];
      dispatch({ type: 'ADD_COMMENT', payload: { reserveId, comment } });
      persistMockReserves(stateRef.current.reserves.map(r => r.id === reserveId ? { ...r, comments: updatedComments } : r));
      if (offline({ table: 'reserves', op: 'update', filter: { column: 'id', value: reserveId }, data: { comments: updatedComments } })) return;
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({ comments: updatedComments }).eq('id', reserveId).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] addComment server error (data saved locally):', error.message);
          }
        });
      }
    },

    addCompany: (c) => {
      const duplicate = stateRef.current.companies.some(
        existing => existing.name.trim().toLowerCase() === c.name.trim().toLowerCase()
      );
      if (duplicate) {
        Alert.alert('Entreprise existante', `Une entreprise nommée "${c.name}" existe déjà.`);
        return;
      }
      dispatch({ type: 'ADD_COMPANY', payload: c });
      // Always persist to local cache so data survives if Supabase fails or is unavailable
      persistMockCompanies([...stateRef.current.companies, c]);
      if (offline({ table: 'companies', op: 'insert', data: {
        id: c.id, name: c.name, short_name: c.shortName, color: c.color,
        planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
        hours_worked: c.hoursWorked, zone: c.zone ?? '', contact: c.phone ?? null,
        email: c.email ?? null, lots: c.lots?.length ? c.lots : null,
        siret: c.siret ?? null, insurance: c.insurance ?? null,
        qualifications: c.qualifications ?? null,
        organization_id: currentUserOrgIdRef.current ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          try {
            let orgId = currentUserOrgIdRef.current;
            if (!orgId) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) {
                const { data: prof } = await supabase
                  .from('profiles').select('organization_id')
                  .eq('id', session.user.id).single();
                orgId = prof?.organization_id ?? null;
                if (orgId) currentUserOrgIdRef.current = orgId;
              }
            }
            const payload = {
              id: c.id, name: c.name, short_name: c.shortName, color: c.color,
              planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
              hours_worked: c.hoursWorked, zone: c.zone ?? '', contact: c.phone ?? null,
              email: c.email ?? null, lots: c.lots?.length ? c.lots : null,
              siret: c.siret ?? null, insurance: c.insurance ?? null,
              qualifications: c.qualifications ?? null,
              organization_id: orgId,
            };
            const { error } = await supabase.from('companies').insert(payload);
            if (error) {
              console.warn('[sync] addCompany server error (data saved locally):', error.message);
            }
          } catch (e: any) {
            console.warn('[sync] addCompany exception (data saved locally):', e?.message ?? e);
          }
        })();
      }
    },

    updateCompanyWorkers: (id, actual) => {
      const previous = stateRef.current.companies.find(c => c.id === id);
      dispatch({ type: 'UPDATE_COMPANY', payload: { id, actualWorkers: actual } });
      persistMockCompanies(stateRef.current.companies.map(c => c.id === id ? { ...c, actualWorkers: actual } : c));
      if (offline({ table: 'companies', op: 'update', filter: { column: 'id', value: id }, data: { actual_workers: actual } })) return;
      if (isSupabaseConfigured) {
        supabase.from('companies').update({ actual_workers: actual }).eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateCompanyWorkers server error (data saved locally):', error.message);
          }
        });
      }
    },

    updateCompanyFull: (c) => {
      const previous = stateRef.current.companies.find(co => co.id === c.id);
      dispatch({ type: 'UPDATE_COMPANY_FULL', payload: c });
      persistMockCompanies(stateRef.current.companies.map(co => co.id === c.id ? c : co));
      if (offline({ table: 'companies', op: 'update', filter: { column: 'id', value: c.id }, data: {
        name: c.name, short_name: c.shortName, color: c.color,
        planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
        hours_worked: c.hoursWorked, zone: c.zone, contact: c.phone ?? null,
        email: c.email ?? null, lots: c.lots ?? null,
        siret: c.siret ?? null, insurance: c.insurance ?? null,
        qualifications: c.qualifications ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        supabase.from('companies').update({
          name: c.name, short_name: c.shortName, color: c.color,
          planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
          hours_worked: c.hoursWorked, zone: c.zone, contact: c.phone ?? null,
          email: c.email ?? null, lots: c.lots ?? null,
          siret: c.siret ?? null, insurance: c.insurance ?? null,
          qualifications: c.qualifications ?? null,
        }).eq('id', c.id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateCompanyFull server error (data saved locally):', error.message);
          }
        });
      }
    },

    deleteCompany: (id) => {
      const previous = stateRef.current.companies.find(c => c.id === id);
      const newCompanies = stateRef.current.companies.filter(c => c.id !== id);
      dispatch({ type: 'DELETE_COMPANY', payload: id });
      persistMockCompanies(newCompanies);
      if (offline({ table: 'companies', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const { data: deleted, error } = await supabase.from('companies').delete().eq('id', id).select();
          if (error) {
            console.warn('[sync] deleteCompany erreur serveur:', error.message);
            if (previous) {
              dispatch({ type: 'ADD_COMPANY', payload: previous });
              persistMockCompanies([previous, ...newCompanies]);
              Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cette entreprise, ou elle n\'existe plus sur le serveur.');
            }
          } else if (!deleted || deleted.length === 0) {
            console.warn('[sync] deleteCompany: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
          }
        })();
      }
    },

    updateCompanyHours: (id, hours) => {
      const previous = stateRef.current.companies.find(c => c.id === id);
      dispatch({ type: 'UPDATE_COMPANY_HOURS', payload: { id, hours } });
      persistMockCompanies(stateRef.current.companies.map(c => c.id === id ? { ...c, hoursWorked: hours } : c));
      if (offline({ table: 'companies', op: 'update', filter: { column: 'id', value: id }, data: { hours_worked: hours } })) return;
      if (isSupabaseConfigured) {
        supabase.from('companies').update({ hours_worked: hours }).eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateCompanyHours server error (data saved locally):', error.message);
          }
        });
      }
    },

    reload: loadAll,
    setCurrentUser,

    addMessage: (channelId, content, options = {}, sender = 'Moi') => {
      const ts = nowTimestampFR();
      const actualSender = currentUserNameRef.current || sender;
      const msg: Message = {
        id: genId(), channelId, sender: actualSender, content, timestamp: ts,
        type: 'message', read: true, isMe: true,
        reactions: {}, isPinned: false, readBy: [], mentions: options.mentions ?? [],
        replyToId: options.replyToId, replyToContent: options.replyToContent,
        replyToSender: options.replyToSender, attachmentUri: options.attachmentUri,
        reserveId: options.reserveId,
        linkedItemType: options.linkedItemType,
        linkedItemId: options.linkedItemId,
        linkedItemTitle: options.linkedItemTitle,
        dbCreatedAt: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_MESSAGE', payload: msg });
      if (isSupabaseConfigured) {
        // Fix 1 — Race condition DM : si le canal DM est en cours de création,
        // attendre que l'upsert soit terminé avant d'insérer le message.
        // Cela garantit que le destinataire verra le canal avant le message.
        const pendingUpsert = channelId.startsWith('dm-')
          ? dmUpsertPromisesRef.current.get(channelId)
          : undefined;
        const doInsert = () => {
          supabase.from('messages').insert(fromMessage(msg)).then(({ error }: { error: any }) => {
            if (error) {
              console.warn('[sync] addMessage server error (data saved locally):', error.message);
            }
          });
        };
        if (pendingUpsert) {
          pendingUpsert.then(doInsert).catch(doInsert);
        } else {
          doInsert();
        }
      } else {
        persistMockMessages([...stateRef.current.messages, msg]);
      }
    },

    incomingMessage: (msg) => dispatch({ type: 'INCOMING_MESSAGE', payload: msg }),

    deleteMessage: (id) => {
      const originalMessages = stateRef.current.messages;
      const newMessages = originalMessages.filter(m => m.id !== id);
      dispatch({ type: 'DELETE_MESSAGE', payload: id });
      if (isSupabaseConfigured) {
        supabase.from('messages').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] deleteMessage server error (data deleted locally):', error.message);
          }
        });
      } else {
        persistMockMessages(newMessages);
      }
    },

    updateMessage: (msg) => {
      const previous = stateRef.current.messages.find(m => m.id === msg.id);
      const newMessages = stateRef.current.messages.map(m => m.id === msg.id ? msg : m);
      dispatch({ type: 'UPDATE_MESSAGE', payload: msg });
      if (isSupabaseConfigured) {
        supabase.from('messages').update(fromMessage(msg)).eq('id', msg.id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateMessage server error (data saved locally):', error.message);
          }
        });
      } else {
        persistMockMessages(newMessages);
      }
    },

    toggleReaction: (emoji, msg, userName) => {
      // Optimistic local update
      const current = msg.reactions[emoji] ?? [];
      const updated = current.includes(userName)
        ? current.filter((u: string) => u !== userName)
        : [...current, userName];
      const newReactions = { ...msg.reactions, [emoji]: updated };
      if (updated.length === 0) delete newReactions[emoji];
      const optimistic = { ...msg, reactions: newReactions };
      dispatch({ type: 'UPDATE_MESSAGE', payload: optimistic });
      if (isSupabaseConfigured) {
        // Mise à jour atomique via RPC (évite la race condition multi-utilisateur)
        supabase.rpc('toggle_message_reaction', {
          p_message_id: msg.id,
          p_emoji: emoji,
          p_user_name: userName,
        }).then(({ error }: { error: any }) => {
          if (error) {
            // Revert local state on server error
            dispatch({ type: 'UPDATE_MESSAGE', payload: msg });
            console.warn('[sync] toggleReaction server error:', error.message);
          }
        });
      } else {
        persistMockMessages(stateRef.current.messages.map(m => m.id === msg.id ? optimistic : m));
      }
    },

    markMessagesRead: () => {
      dispatch({ type: 'MARK_MESSAGES_READ' });
    },

    setChannelRead: (channelId) => {
      const timestamp = new Date().toISOString();
      dispatch({ type: 'SET_CHANNEL_READ', payload: { channelId, timestamp } });
      const userName = currentUserNameRef.current;
      if (userName) {
        dispatch({ type: 'MARK_CHANNEL_READ_BY', payload: { channelId, userName } });
        if (isSupabaseConfigured) {
          // Persister last_read_by_channel dans Supabase (cross-device sync)
          const newLastRead = { ...stateRef.current.lastReadByChannel, [channelId]: timestamp };
          supabase.auth.getSession().then(({ data: { session } }: { data: { session: any } }) => {
            if (session?.user?.id) {
              supabase
                .from('profiles')
                .update({ last_read_by_channel: newLastRead })
                .eq('id', session.user.id)
                .then(({ error }: { error: any }) => {
                  if (error) console.warn('[setChannelRead] last_read_by_channel sync error:', error.message);
                });
            }
          }).catch((e: any) => {
            console.warn('[setChannelRead] getSession error:', e?.message ?? e);
          });
          // Persister le read_by dans Supabase via RPC pour que l'envoyeur
          // puisse voir "Vu par N" même après rechargement.
          // Fix: envoi par batchs de 100 pour couvrir plus de 100 messages non-lus.
          const unread = stateRef.current.messages.filter(
            m => m.channelId === channelId
              && !m.isMe
              && !m.readBy.includes(userName)
          );
          const ids = unread.map(m => m.id);
          const BATCH_SIZE = 100;
          for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            const batch = ids.slice(i, i + BATCH_SIZE);
            supabase.rpc('mark_messages_read_by', {
              p_message_ids: batch,
              p_user_name: userName,
            }).then(({ error }: { error: any }) => {
              if (error) console.warn('[setChannelRead] mark_messages_read_by error:', error.message);
            });
          }
        }
      }
    },

    addTask: (t) => {
      dispatch({ type: 'ADD_TASK', payload: t });
      persistMockTasks([t, ...stateRef.current.tasks]);
      if (offline({ table: 'tasks', op: 'insert', data: { id: t.id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          try {
            let orgId = currentUserOrgIdRef.current;
            if (!orgId) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) {
                const { data: prof } = await supabase
                  .from('profiles').select('organization_id')
                  .eq('id', session.user.id).single();
                orgId = prof?.organization_id ?? null;
                if (orgId) currentUserOrgIdRef.current = orgId;
              }
            }
            const { error } = await supabase.from('tasks').insert({
              id: t.id, title: t.title, description: t.description, status: t.status,
              priority: t.priority, start_date: t.startDate ?? null, deadline: t.deadline,
              assignee: t.assignee, progress: t.progress, company: t.company,
              chantier_id: t.chantierId ?? null, reserve_id: t.reserveId ?? null,
              comments: t.comments ?? [], history: t.history ?? [],
              created_at: t.createdAt ?? null,
              organization_id: orgId,
            });
            if (error) {
              console.error('[sync] addTask Supabase error:', error.code, error.message);
              Alert.alert(
                'Erreur de synchronisation',
                `La tâche a été sauvegardée localement mais n'a pas pu être envoyée.\n\nCode: ${error.code}\n${error.message}`,
                [{ text: 'OK' }]
              );
            }
          } catch (e: any) {
            console.error('[sync] addTask exception:', e?.message ?? e);
          }
        })();
      }
    },

    updateTask: (t) => {
      const previous = stateRef.current.tasks.find(tk => tk.id === t.id);
      const newTasks = stateRef.current.tasks.map(tk => tk.id === t.id ? t : tk);
      dispatch({ type: 'UPDATE_TASK', payload: t });
      persistMockTasks(newTasks);
      if (offline({ table: 'tasks', op: 'update', filter: { column: 'id', value: t.id }, data: {
        title: t.title, description: t.description, status: t.status,
        priority: t.priority, start_date: t.startDate ?? null, deadline: t.deadline,
        assignee: t.assignee, progress: t.progress, company: t.company,
        chantier_id: t.chantierId ?? null, reserve_id: t.reserveId ?? null,
        comments: t.comments ?? [], history: t.history ?? [],
      } })) return;
      if (isSupabaseConfigured) {
        supabase.from('tasks').update({
          title: t.title, description: t.description, status: t.status,
          priority: t.priority, start_date: t.startDate ?? null, deadline: t.deadline,
          assignee: t.assignee, progress: t.progress, company: t.company,
          chantier_id: t.chantierId ?? null, reserve_id: t.reserveId ?? null,
          comments: t.comments ?? [], history: t.history ?? [],
        }).eq('id', t.id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateTask server error (data saved locally):', error.message);
          }
        });
      }
    },

    deleteTask: (id) => {
      const previous = stateRef.current.tasks.find(t => t.id === id);
      const newTasks = stateRef.current.tasks.filter(t => t.id !== id);
      dispatch({ type: 'DELETE_TASK', payload: id });
      persistMockTasks(newTasks);
      if (offline({ table: 'tasks', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const { data: deleted, error } = await supabase.from('tasks').delete().eq('id', id).select();
          if (error) {
            console.warn('[sync] deleteTask erreur serveur:', error.message);
            if (previous) {
              dispatch({ type: 'ADD_TASK', payload: previous });
              persistMockTasks([previous, ...newTasks]);
              Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cette tâche, ou elle n\'existe plus sur le serveur.');
            }
          } else if (!deleted || deleted.length === 0) {
            console.warn('[sync] deleteTask: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
          }
        })();
      }
    },

    addTaskComment: (taskId, content, author = 'Utilisateur') => {
      const task = stateRef.current.tasks.find(t => t.id === taskId);
      if (!task) return;
      const actualAuthor = currentUserNameRef.current || author;
      const comment: Comment = {
        id: genId(), author: actualAuthor, content,
        createdAt: formatDateFR(new Date()),
      };
      const updatedComments = [...(task.comments ?? []), comment];
      const newTasks = stateRef.current.tasks.map(t =>
        t.id === taskId ? { ...t, comments: updatedComments } : t
      );
      dispatch({ type: 'ADD_TASK_COMMENT', payload: { taskId, comment } });
      persistMockTasks(newTasks);
      if (offline({ table: 'tasks', op: 'update', filter: { column: 'id', value: taskId }, data: { comments: updatedComments } })) return;
      if (isSupabaseConfigured) {
        supabase.from('tasks').update({ comments: updatedComments }).eq('id', taskId).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] addTaskComment server error (data saved locally):', error.message);
          }
        });
      }
    },

    addPhoto: (p) => {
      dispatch({ type: 'ADD_PHOTO', payload: p });
      persistMockPhotos([p, ...stateRef.current.photos]);
      if (offline({ table: 'photos', op: 'insert', data: {
        id: p.id, comment: p.comment, location: p.location,
        taken_at: p.takenAt, taken_by: p.takenBy, color_code: p.colorCode, uri: p.uri,
        reserve_id: p.reserveId ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        supabase.from('photos').insert({
          id: p.id, comment: p.comment, location: p.location,
          taken_at: p.takenAt, taken_by: p.takenBy, color_code: p.colorCode, uri: p.uri,
          reserve_id: p.reserveId ?? null,
        }).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] addPhoto server error (data saved locally):', error.message);
          }
        });
      }
    },

    deletePhoto: (id) => {
      const previous = stateRef.current.photos.find(p => p.id === id);
      const newPhotos = stateRef.current.photos.filter(p => p.id !== id);
      dispatch({ type: 'DELETE_PHOTO', payload: id });
      persistMockPhotos(newPhotos);
      if (offline({ table: 'photos', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const { data: deleted, error } = await supabase.from('photos').delete().eq('id', id).select();
          if (error) {
            console.warn('[sync] deletePhoto erreur serveur:', error.message);
            if (previous) {
              dispatch({ type: 'ADD_PHOTO', payload: previous });
              persistMockPhotos([previous, ...newPhotos]);
              Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cette photo, ou elle n\'existe plus sur le serveur.');
            }
          } else if (!deleted || deleted.length === 0) {
            console.warn('[sync] deletePhoto: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
          }
        })();
      }
    },

    addDocument: (d) => {
      const newDocuments = [d, ...stateRef.current.documents];
      dispatch({ type: 'ADD_DOCUMENT', payload: d });
      persistMockDocuments(newDocuments);
      if (offline({ table: 'documents', op: 'insert', data: {
        id: d.id, name: d.name, type: d.type, category: d.category,
        uploaded_at: d.uploadedAt, size: d.size, version: d.version, uri: d.uri,
        organization_id: currentUserOrgIdRef.current ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        supabase.from('documents').insert({
          id: d.id, name: d.name, type: d.type, category: d.category,
          uploaded_at: d.uploadedAt, size: d.size, version: d.version, uri: d.uri,
          organization_id: currentUserOrgIdRef.current ?? null,
        }).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] addDocument server error (data saved locally):', error.message);
          }
        });
      }
    },

    deleteDocument: (id) => {
      const previous = stateRef.current.documents.find(d => d.id === id);
      const newDocuments = stateRef.current.documents.filter(d => d.id !== id);
      dispatch({ type: 'DELETE_DOCUMENT', payload: id });
      persistMockDocuments(newDocuments);
      if (offline({ table: 'documents', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const { data: deleted, error } = await supabase.from('documents').delete().eq('id', id).select();
          if (error) {
            console.warn('[sync] deleteDocument erreur serveur:', error.message);
            if (previous) {
              dispatch({ type: 'ADD_DOCUMENT', payload: previous });
              persistMockDocuments([previous, ...newDocuments]);
              Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer ce document, ou il n\'existe plus sur le serveur.');
            }
          } else if (!deleted || deleted.length === 0) {
            console.warn('[sync] deleteDocument: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
          }
        })();
      }
    },

    addCustomChannel,
    removeCustomChannel,
    addGroupChannel,
    removeGroupChannel,
    renameChannel,
    updateCustomChannel,
    addChannelMember,
    removeChannelMember,
    pinChannel,
    unpinChannel,
    maxPinnedChannels: MAX_PINNED,
    getOrCreateDMChannel,

    fetchOlderMessages: async (channelId: string, beforeCreatedAt: string): Promise<boolean> => {
      if (!isSupabaseConfigured) return false;
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('channel_id', channelId)
          .lt('created_at', beforeCreatedAt)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) {
          console.warn('[fetchOlderMessages] error:', error.message);
          return false;
        }
        if (!data?.length) return false;
        const userName = currentUserNameRef.current;
        const older = (data as any[]).map(r => toMessage(r, userName)).reverse();
        dispatch({ type: 'PREPEND_MESSAGES', payload: older });
        return data.length === 50;
      } catch (e: any) {
        console.warn('[fetchOlderMessages] exception:', e?.message ?? e);
        return false;
      }
    },

    fetchChannelMessages: async (channelId: string): Promise<void> => {
      if (!isSupabaseConfigured) return;
      if (loadedChannelIdsRef.current.has(channelId)) return;
      loadedChannelIdsRef.current.add(channelId);
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('channel_id', channelId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) {
          loadedChannelIdsRef.current.delete(channelId);
          console.warn('[fetchChannelMessages] error:', error.message);
          return;
        }
        const userName = currentUserNameRef.current;
        const msgs = (data ?? []).map((r: any) => toMessage(r, userName)).reverse();
        dispatch({ type: 'SET_CHANNEL_MESSAGES', payload: { channelId, messages: msgs } });
      } catch (e: any) {
        loadedChannelIdsRef.current.delete(channelId);
        console.warn('[fetchChannelMessages] exception:', e?.message ?? e);
      }
    },

    refreshChannelMessages: async (channelId: string): Promise<void> => {
      if (!isSupabaseConfigured) return;
      loadedChannelIdsRef.current.delete(channelId);
      loadedChannelIdsRef.current.add(channelId);
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('channel_id', channelId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) {
          loadedChannelIdsRef.current.delete(channelId);
          console.warn('[refreshChannelMessages] error:', error.message);
          return;
        }
        const userName = currentUserNameRef.current;
        const msgs = (data ?? []).map((r: any) => toMessage(r, userName)).reverse();
        dispatch({ type: 'SET_CHANNEL_MESSAGES', payload: { channelId, messages: msgs } });
      } catch (e: any) {
        loadedChannelIdsRef.current.delete(channelId);
        console.warn('[refreshChannelMessages] exception:', e?.message ?? e);
      }
    },

    addVisite: (v) => {
      const newVisites = [v, ...stateRef.current.visites];
      dispatch({ type: 'ADD_VISITE', payload: v });
      persistMockVisites(newVisites);
      if (offline({ table: 'visites', op: 'insert', data: fromVisite(v, currentUserOrgIdRef.current) })) return;
      if (isSupabaseConfigured) {
        (async () => {
          try {
            let orgId = currentUserOrgIdRef.current;
            if (!orgId) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) {
                const { data: prof } = await supabase
                  .from('profiles').select('organization_id')
                  .eq('id', session.user.id).single();
                orgId = prof?.organization_id ?? null;
                if (orgId) currentUserOrgIdRef.current = orgId;
              }
            }
            const { error } = await supabase.from('visites').insert(fromVisite(v, orgId));
            if (error) {
              console.warn('[sync] addVisite server error (data saved locally):', error.message);
            }
          } catch (e: any) {
            console.error('[sync] addVisite exception:', e?.message ?? e);
          }
        })();
      }
    },
    updateVisite: (v) => {
      const previous = stateRef.current.visites.find(x => x.id === v.id);
      const newVisites = stateRef.current.visites.map(x => x.id === v.id ? v : x);
      dispatch({ type: 'UPDATE_VISITE', payload: v });
      persistMockVisites(newVisites);
      { const { id: _vid, organization_id: _vorgId, ..._vfields } = fromVisite(v, currentUserOrgIdRef.current);
        if (offline({ table: 'visites', op: 'update', filter: { column: 'id', value: v.id }, data: _vfields })) return; }
      if (isSupabaseConfigured) {
        const { id, organization_id, ...fields } = fromVisite(v, currentUserOrgIdRef.current);
        supabase.from('visites').update(fields).eq('id', v.id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateVisite server error (data saved locally):', error.message);
          }
        });
      }
    },
    deleteVisite: (id) => {
      const previous = stateRef.current.visites.find(v => v.id === id);
      const newVisites = stateRef.current.visites.filter(v => v.id !== id);
      dispatch({ type: 'DELETE_VISITE', payload: id });
      persistMockVisites(newVisites);
      if (offline({ table: 'visites', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const { data: deleted, error } = await supabase.from('visites').delete().eq('id', id).select();
          if (error) {
            console.warn('[sync] deleteVisite erreur serveur:', error.message);
            if (previous) {
              dispatch({ type: 'ADD_VISITE', payload: previous });
              persistMockVisites([previous, ...newVisites]);
              Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cette visite, ou elle n\'existe plus sur le serveur.');
            }
          } else if (!deleted || deleted.length === 0) {
            console.warn('[sync] deleteVisite: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
          }
        })();
      }
    },
    linkReserveToVisite: (reserveId, visiteId) => {
      const visite = stateRef.current.visites.find(v => v.id === visiteId);
      if (!visite) return;
      if (visite.reserveIds.includes(reserveId)) return;
      const updated = { ...visite, reserveIds: [...visite.reserveIds, reserveId] };
      const newVisites = stateRef.current.visites.map(x => x.id === visiteId ? updated : x);
      dispatch({ type: 'UPDATE_VISITE', payload: updated });
      persistMockVisites(newVisites);
      if (offline({ table: 'visites', op: 'update', filter: { column: 'id', value: visiteId }, data: { reserve_ids: updated.reserveIds } })) return;
      if (isSupabaseConfigured) {
        supabase.from('visites').update({ reserve_ids: updated.reserveIds }).eq('id', visiteId).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] linkReserveToVisite server error (data saved locally):', error.message);
          }
        });
      }
    },

    addLot: (l) => {
      const duplicateLot = stateRef.current.lots.some(
        existing => existing.name.trim().toLowerCase() === l.name.trim().toLowerCase()
      );
      if (duplicateLot) {
        Alert.alert('Lot existant', `Un lot nommé "${l.name}" existe déjà.`);
        return;
      }
      const newLots = [...stateRef.current.lots, l];
      dispatch({ type: 'ADD_LOT', payload: l });
      persistMockLots(newLots);
      if (offline({ table: 'lots', op: 'insert', data: fromLot(l, currentUserOrgIdRef.current) })) return;
      if (isSupabaseConfigured) {
        (async () => {
          try {
            let orgId = currentUserOrgIdRef.current;
            if (!orgId) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) {
                const { data: prof } = await supabase
                  .from('profiles').select('organization_id')
                  .eq('id', session.user.id).single();
                orgId = prof?.organization_id ?? null;
                if (orgId) currentUserOrgIdRef.current = orgId;
              }
            }
            const { error } = await supabase.from('lots').insert(fromLot(l, orgId));
            if (error) {
              console.warn('[sync] addLot server error (data saved locally):', error.message);
            }
          } catch (e: any) {
            console.error('[sync] addLot exception:', e?.message ?? e);
          }
        })();
      }
    },
    updateLot: (l) => {
      const previous = stateRef.current.lots.find(x => x.id === l.id);
      const newLots = stateRef.current.lots.map(x => x.id === l.id ? l : x);
      dispatch({ type: 'UPDATE_LOT', payload: l });
      persistMockLots(newLots);
      { const { id: _lid, organization_id: _lorgId, ..._lfields } = fromLot(l, currentUserOrgIdRef.current);
        if (offline({ table: 'lots', op: 'update', filter: { column: 'id', value: l.id }, data: _lfields })) return; }
      if (isSupabaseConfigured) {
        const { id, organization_id, ...fields } = fromLot(l, currentUserOrgIdRef.current);
        supabase.from('lots').update(fields).eq('id', l.id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateLot server error (data saved locally):', error.message);
          }
        });
      }
    },
    deleteLot: (id) => {
      const previous = stateRef.current.lots.find(l => l.id === id);
      const newLots = stateRef.current.lots.filter(l => l.id !== id);
      dispatch({ type: 'DELETE_LOT', payload: id });
      persistMockLots(newLots);
      if (offline({ table: 'lots', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const { data: deleted, error } = await supabase.from('lots').delete().eq('id', id).select();
          if (error) {
            console.warn('[sync] deleteLot erreur serveur:', error.message);
            if (previous) {
              dispatch({ type: 'ADD_LOT', payload: previous });
              persistMockLots([previous, ...newLots]);
              Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer ce lot, ou il n\'existe plus sur le serveur.');
            }
          } else if (!deleted || deleted.length === 0) {
            console.warn('[sync] deleteLot: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
          }
        })();
      }
    },

    batchUpdateReserves: (ids, updates, author) => {
      const actualAuthor = author ?? currentUserNameRef.current ?? 'Système';
      const statusLabels: Record<string, string> = {
        open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
        verification: 'Vérification', closed: 'Clôturé',
      };
      const now = new Date().toISOString().split('T')[0];
      const previousReserves = stateRef.current.reserves.filter(r => ids.includes(r.id));
      const updated: Reserve[] = [];
      for (const id of ids) {
        const reserve = stateRef.current.reserves.find(r => r.id === id);
        if (!reserve) continue;
        const historyEntries: typeof reserve.history = [];
        if (updates.status && updates.status !== reserve.status) {
          historyEntries.push({
            id: genId(), action: 'Statut modifié (lot)', author: actualAuthor, createdAt: now,
            oldValue: statusLabels[reserve.status], newValue: statusLabels[updates.status],
          });
        }
        const newCompanies = updates.companies ?? (updates.company ? [updates.company] : undefined);
        const oldCompanies = reserve.companies ?? (reserve.company ? [reserve.company] : []);
        if (newCompanies && JSON.stringify(newCompanies) !== JSON.stringify(oldCompanies)) {
          historyEntries.push({
            id: genId(), action: 'Entreprises modifiées (lot)', author: actualAuthor, createdAt: now,
            oldValue: oldCompanies.join(', '), newValue: newCompanies.join(', '),
          });
        }
        const isClosing = updates.status === 'closed' && reserve.status !== 'closed';
        const r: Reserve = {
          ...reserve,
          ...updates,
          companies: newCompanies ?? oldCompanies,
          company: (newCompanies ?? oldCompanies)[0] ?? reserve.company,
          history: [...reserve.history, ...historyEntries],
          closedAt: isClosing ? now : reserve.closedAt,
          closedBy: isClosing ? actualAuthor : reserve.closedBy,
        };
        updated.push(r);
      }
      dispatch({ type: 'BATCH_UPDATE_RESERVES', payload: updated });
      if (isSupabaseConfigured) {
        let hasError = false;
        Promise.all(
          updated.map(r =>
            supabase.from('reserves').update({
              status: r.status,
              company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? null,
              companies: r.companies ?? (r.company ? [r.company] : []),
              deadline: r.deadline,
              priority: r.priority, history: r.history,
              closed_at: r.closedAt ?? null, closed_by: r.closedBy ?? null,
            }).eq('id', r.id)
          )
        ).then(results => {
          const failed = results.some((res: any) => res.error);
          if (failed && !hasError) {
            hasError = true;
            console.warn('[sync] batchUpdateReserves some server errors (data saved locally)');
          }
        });
      } else {
        const allReserves = stateRef.current.reserves.map(r => {
          const u = updated.find(x => x.id === r.id);
          return u ?? r;
        });
        persistMockReserves(allReserves);
      }
    },

    addSitePlanVersion: (parentPlanId, newPlan) => {
      const allPlans = stateRef.current.sitePlans;
      const parent = allPlans.find(p => p.id === parentPlanId);
      if (!parent) return;
      const parentRevNum = parent.revisionNumber ?? 1;
      const revNum = parentRevNum + 1;
      const autoRevCode = `R${String(revNum).padStart(2, '0')}`;
      const finalRevCode = newPlan.revisionCode?.trim() || autoRevCode;
      const updatedParent: SitePlan = { ...parent, revisionNumber: parentRevNum, isLatestRevision: false };
      const versionedNew: SitePlan = {
        ...newPlan,
        parentPlanId,
        revisionNumber: revNum,
        revisionCode: finalRevCode,
        isLatestRevision: true,
      };
      const updatedPlans = allPlans.map(p => p.id === parentPlanId ? updatedParent : p).concat([versionedNew]);
      dispatch({ type: 'UPDATE_SITE_PLAN', payload: updatedParent });
      dispatch({ type: 'ADD_SITE_PLAN', payload: versionedNew });
      // Always persist locally as a cache/fallback so revisions survive Supabase failures
      persistMockSitePlans(updatedPlans);
      if (isSupabaseConfigured) {
        (async () => {
          try {
            let orgId = currentUserOrgIdRef.current;
            if (!orgId) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) {
                const { data: prof } = await supabase
                  .from('profiles').select('organization_id')
                  .eq('id', session.user.id).single();
                orgId = prof?.organization_id ?? null;
                if (orgId) currentUserOrgIdRef.current = orgId;
              }
            }
            const { error: updateErr } = await supabase
              .from('site_plans')
              .update({ is_latest_revision: false, revision_number: parentRevNum })
              .eq('id', parentPlanId);
            if (updateErr) {
              console.error('[addSitePlanVersion] update parent error:', updateErr.message);
            }
            const { error: insertErr } = await supabase.from('site_plans').insert({
              id: versionedNew.id,
              chantier_id: versionedNew.chantierId,
              name: versionedNew.name,
              uri: versionedNew.uri ?? null,
              file_type: versionedNew.fileType ?? null,
              dxf_name: versionedNew.dxfName ?? null,
              size: versionedNew.size ?? null,
              building: versionedNew.building ?? null,
              level: versionedNew.level ?? null,
              building_id: versionedNew.buildingId ?? null,
              level_id: versionedNew.levelId ?? null,
              revision_code: finalRevCode,
              revision_number: revNum,
              parent_plan_id: parentPlanId,
              is_latest_revision: true,
              revision_note: versionedNew.revisionNote ?? null,
              organization_id: orgId,
            });
            if (insertErr) {
              console.warn('[sync] addSitePlanVersion insert revision error (data saved locally):', insertErr.message);
            }
          } catch (e: any) {
            console.error('[sync] addSitePlanVersion exception:', e?.message ?? e);
          }
        })();
      }
    },

    migrateReservesToPlan: (fromPlanId, toPlanId) => {
      const toMigrate = stateRef.current.reserves.filter(
        r => r.planId === fromPlanId && r.status !== 'closed'
      );
      if (toMigrate.length === 0) return 0;
      const previousReserves = stateRef.current.reserves;
      const migrated = toMigrate.map(r => ({ ...r, planId: toPlanId }));
      const allUpdated = stateRef.current.reserves.map(r => {
        const m = migrated.find(x => x.id === r.id);
        return m ?? r;
      });
      dispatch({ type: 'BATCH_UPDATE_RESERVES', payload: migrated });
      if (isSupabaseConfigured) {
        Promise.all(migrated.map(r =>
          supabase.from('reserves').update({ plan_id: toPlanId }).eq('id', r.id)
        )).then(results => {
          const hasError = results.some(({ error }: { error: any }) => error);
          if (hasError) {
            console.warn('[sync] migrateReservesToPlan some server errors (data saved locally)');
          }
        });
      } else {
        persistMockReserves(allUpdated);
      }
      return migrated.length;
    },

    addOpr: (o) => {
      const newOprs = [o, ...stateRef.current.oprs];
      dispatch({ type: 'ADD_OPR', payload: o });
      persistMockOprs(newOprs);
      if (offline({ table: 'oprs', op: 'insert', data: fromOpr(o, currentUserOrgIdRef.current) })) return;
      if (isSupabaseConfigured) {
        (async () => {
          try {
            let orgId = currentUserOrgIdRef.current;
            if (!orgId) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) {
                const { data: prof } = await supabase
                  .from('profiles').select('organization_id')
                  .eq('id', session.user.id).single();
                orgId = prof?.organization_id ?? null;
                if (orgId) currentUserOrgIdRef.current = orgId;
              }
            }
            const { error } = await supabase.from('oprs').insert(fromOpr(o, orgId));
            if (error) {
              console.warn('[sync] addOpr server error (data saved locally):', error.message);
            }
          } catch (e: any) {
            console.error('[sync] addOpr exception:', e?.message ?? e);
          }
        })();
      }
    },
    updateOpr: (o) => {
      const previous = stateRef.current.oprs.find(x => x.id === o.id);
      const newOprs = stateRef.current.oprs.map(x => x.id === o.id ? o : x);
      dispatch({ type: 'UPDATE_OPR', payload: o });
      persistMockOprs(newOprs);
      { const { id: _oid, organization_id: _oorgId, ..._ofields } = fromOpr(o, currentUserOrgIdRef.current);
        if (offline({ table: 'oprs', op: 'update', filter: { column: 'id', value: o.id }, data: _ofields })) return; }
      if (isSupabaseConfigured) {
        const { id, organization_id, ...fields } = fromOpr(o, currentUserOrgIdRef.current);
        supabase.from('oprs').update(fields).eq('id', o.id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateOpr server error (data saved locally):', error.message);
          }
        });
      }
    },
    deleteOpr: (id) => {
      const previous = stateRef.current.oprs.find(o => o.id === id);
      const newOprs = stateRef.current.oprs.filter(o => o.id !== id);
      dispatch({ type: 'DELETE_OPR', payload: id });
      persistMockOprs(newOprs);
      if (offline({ table: 'oprs', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const { data: deleted, error } = await supabase.from('oprs').delete().eq('id', id).select();
          if (error) {
            console.warn('[sync] deleteOpr erreur serveur:', error.message);
            if (previous) {
              dispatch({ type: 'ADD_OPR', payload: previous });
              persistMockOprs([previous, ...newOprs]);
              Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cet OPR, ou il n\'existe plus sur le serveur.');
            }
          } else if (!deleted || deleted.length === 0) {
            console.warn('[sync] deleteOpr: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
          }
        })();
      }
    },

    activeChantier: state.chantiers.find(c => c.id === state.activeChantierId) ?? null,

    addChantier: (c: Chantier, plans: SitePlan[]) => {
      const duplicateChantier = stateRef.current.chantiers.some(
        existing => existing.name.trim().toLowerCase() === c.name.trim().toLowerCase()
      );
      if (duplicateChantier) {
        Alert.alert('Chantier existant', `Un chantier nommé "${c.name}" existe déjà.`);
        return;
      }
      const newChantiers = [...stateRef.current.chantiers, c];
      const newSitePlans = [...stateRef.current.sitePlans, ...plans];
      dispatch({ type: 'ADD_CHANTIER', payload: c });
      plans.forEach(p => dispatch({ type: 'ADD_SITE_PLAN', payload: p }));
      if (!stateRef.current.activeChantierId) {
        dispatch({ type: 'SET_ACTIVE_CHANTIER', payload: c.id });
        AsyncStorage.setItem(ACTIVE_CHANTIER_KEY, c.id).catch(() => {});
      }
      persistMockChantiers(newChantiers);
      persistMockSitePlans(newSitePlans);

      // Création du canal chantier associé
      const buildingChannel: Channel = {
        id: `building-${c.id}`,
        name: c.name,
        description: c.description ?? '',
        icon: 'business',
        color: '#3B82F6',
        type: 'building',
        members: currentUserNameRef.current ? [currentUserNameRef.current] : [],
        createdBy: currentUserNameRef.current || undefined,
        organizationId: currentUserOrgIdRef.current || undefined,
      };
      dispatch({ type: 'SET_GENERAL_CHANNELS', payload: [...(stateRef.current.generalChannels ?? []), buildingChannel] });

      if (offline({ table: 'chantiers', op: 'insert', data: {
        id: c.id, name: c.name, address: c.address ?? null, description: c.description ?? null,
        start_date: c.startDate ?? null, end_date: c.endDate ?? null, status: c.status,
        created_by: c.createdBy ?? null, buildings: c.buildings ? JSON.stringify(c.buildings) : null,
        organization_id: currentUserOrgIdRef.current ?? null,
        company_ids: c.companyIds ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const chantierPayload = {
            id: c.id,
            name: c.name,
            address: c.address ?? null,
            description: c.description ?? null,
            start_date: c.startDate ?? null,
            end_date: c.endDate ?? null,
            status: c.status,
            created_by: c.createdBy ?? null,
            buildings: c.buildings ? JSON.stringify(c.buildings) : null,
            organization_id: currentUserOrgIdRef.current ?? null,
            company_ids: c.companyIds ?? null,
          };
          let { error } = await supabase.from('chantiers').insert(chantierPayload);
          if (error) {
            await supabase.auth.refreshSession().catch(() => {});
            const { error: err2 } = await supabase.from('chantiers').insert(chantierPayload);
            if (err2) {
              Alert.alert(
                'Synchronisation incomplète',
                `Le chantier "${c.name}" a été créé localement mais n'a pas pu être synchronisé avec le serveur (${err2.message}). Il sera automatiquement synchronisé à votre reconnexion.`,
                [{ text: 'OK' }]
              );
            }
          }
          for (const p of plans) {
            const planPayload = {
              id: p.id,
              chantier_id: p.chantierId,
              name: p.name,
              building: p.building ?? null,
              level: p.level ?? null,
              building_id: p.buildingId ?? null,
              level_id: p.levelId ?? null,
              uri: p.uri ?? null,
              file_type: p.fileType ?? null,
              uploaded_at: p.uploadedAt,
              size: p.size ?? null,
            };
            const { error: planErr } = await supabase.from('site_plans').insert(planPayload);
          }

          // Insertion du canal chantier dans Supabase
          await supabase.from('channels').insert({
            id: `building-${c.id}`,
            name: c.name,
            description: c.description ?? '',
            icon: 'business',
            color: '#3B82F6',
            type: 'building',
            members: currentUserNameRef.current ? [currentUserNameRef.current] : [],
            created_by: currentUserNameRef.current || null,
            organization_id: currentUserOrgIdRef.current ?? null,
          });
        })();
      }
    },

    updateChantier: (c: Chantier) => {
      const updated = stateRef.current.chantiers.map(ch => ch.id === c.id ? c : ch);
      dispatch({ type: 'UPDATE_CHANTIER', payload: c });
      persistMockChantiers(updated);
      if (offline({ table: 'chantiers', op: 'update', filter: { column: 'id', value: c.id }, data: {
        name: c.name, address: c.address ?? null, description: c.description ?? null,
        start_date: c.startDate ?? null, end_date: c.endDate ?? null, status: c.status,
        buildings: c.buildings ? JSON.stringify(c.buildings) : null,
        company_ids: c.companyIds ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const updatePayload = {
            name: c.name,
            address: c.address ?? null,
            description: c.description ?? null,
            start_date: c.startDate ?? null,
            end_date: c.endDate ?? null,
            status: c.status,
            buildings: c.buildings ? JSON.stringify(c.buildings) : null,
            company_ids: c.companyIds ?? null,
          };
          const { error } = await supabase.from('chantiers').update(updatePayload).eq('id', c.id);
          if (error) {
            await supabase.auth.refreshSession().catch(() => {});
            const { error: err2 } = await supabase.from('chantiers').update(updatePayload).eq('id', c.id);
            if (err2) {
              Alert.alert(
                'Synchronisation incomplète',
                `Le chantier "${c.name}" a été modifié localement mais n'a pas pu être synchronisé avec le serveur (${err2.message}). Il sera automatiquement synchronisé à votre reconnexion.`,
                [{ text: 'OK' }]
              );
            }
          }
        })();
      }
    },

    deleteChantier: (id: string) => {
      const newChantiers = stateRef.current.chantiers.filter(c => c.id !== id);
      const newSitePlans = stateRef.current.sitePlans.filter(p => p.chantierId !== id);
      const newReserves = stateRef.current.reserves.filter(r => r.chantierId !== id);
      const newTasks = stateRef.current.tasks.filter(t => t.chantierId !== id);
      dispatch({ type: 'DELETE_CHANTIER', payload: id });
      persistMockChantiers(newChantiers);
      persistMockSitePlans(newSitePlans);
      persistMockReserves(newReserves);
      persistMockTasks(newTasks);
      const newActiveId = stateRef.current.activeChantierId === id
        ? (newChantiers[0]?.id ?? null)
        : stateRef.current.activeChantierId;
      if (newActiveId) {
        AsyncStorage.setItem(ACTIVE_CHANTIER_KEY, newActiveId).catch(() => {});
      } else {
        AsyncStorage.removeItem(ACTIVE_CHANTIER_KEY).catch(() => {});
      }
      if (offline({ table: 'chantiers', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        // Cascade: delete all child entities in Supabase before deleting the chantier itself.
        // Order matters for RLS join policies (reserves/tasks reference chantier_id).
        (async () => {
          try {
            await Promise.all([
              supabase.from('reserves').delete().eq('chantier_id', id),
              supabase.from('tasks').delete().eq('chantier_id', id),
              supabase.from('visites').delete().eq('chantier_id', id),
              supabase.from('lots').delete().eq('chantier_id', id),
              supabase.from('oprs').delete().eq('chantier_id', id),
              supabase.from('site_plans').delete().eq('chantier_id', id),
            ]);
            const { data: deleted, error } = await supabase.from('chantiers').delete().eq('id', id).select();
            if (error) {
              console.warn('[sync] deleteChantier erreur serveur:', error.message);
            } else if (!deleted || deleted.length === 0) {
              console.warn('[sync] deleteChantier: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
            }
          } catch (e: any) {
            console.error('[sync] deleteChantier exception:', e?.message ?? e);
          }
        })();
      }
    },

    setActiveChantier: (id: string) => {
      dispatch({ type: 'SET_ACTIVE_CHANTIER', payload: id });
      AsyncStorage.setItem(ACTIVE_CHANTIER_KEY, id).catch(() => {});
    },

    addSitePlan: (p: SitePlan) => {
      dispatch({ type: 'ADD_SITE_PLAN', payload: p });
      // Always persist locally as a cache/fallback so plans survive Supabase failures
      const updated = [...stateRef.current.sitePlans, p];
      persistMockSitePlans(updated);
      if (offline({ table: 'site_plans', op: 'insert', data: {
        id: p.id, chantier_id: p.chantierId, name: p.name,
        building: p.building ?? null, level: p.level ?? null,
        building_id: p.buildingId ?? null, level_id: p.levelId ?? null,
        uri: p.uri ?? null, file_type: p.fileType ?? null, dxf_name: p.dxfName ?? null,
        uploaded_at: p.uploadedAt, size: p.size ?? null,
        revision_code: p.revisionCode ?? null, revision_number: p.revisionNumber ?? null,
        parent_plan_id: p.parentPlanId ?? null, is_latest_revision: p.isLatestRevision ?? null,
        revision_note: p.revisionNote ?? null, annotations: p.annotations ?? null,
        pdf_page_count: p.pdfPageCount ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          try {
            let orgId = currentUserOrgIdRef.current;
            if (!orgId) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) {
                const { data: prof } = await supabase
                  .from('profiles').select('organization_id')
                  .eq('id', session.user.id).single();
                orgId = prof?.organization_id ?? null;
                if (orgId) currentUserOrgIdRef.current = orgId;
              }
            }
            const { error } = await supabase.from('site_plans').insert({
              id: p.id,
              chantier_id: p.chantierId,
              name: p.name,
              building: p.building ?? null,
              level: p.level ?? null,
              building_id: p.buildingId ?? null,
              level_id: p.levelId ?? null,
              uri: p.uri ?? null,
              file_type: p.fileType ?? null,
              dxf_name: p.dxfName ?? null,
              uploaded_at: p.uploadedAt,
              size: p.size ?? null,
              revision_code: p.revisionCode ?? null,
              revision_number: p.revisionNumber ?? null,
              parent_plan_id: p.parentPlanId ?? null,
              is_latest_revision: p.isLatestRevision ?? null,
              revision_note: p.revisionNote ?? null,
              annotations: p.annotations ?? null,
              pdf_page_count: p.pdfPageCount ?? null,
              organization_id: orgId,
            });
            if (error) {
              console.warn('[sync] addSitePlan server error (data saved locally):', error.message);
            }
          } catch (e: any) {
            console.error('[sync] addSitePlan exception:', e?.message ?? e);
          }
        })();
      }
    },

    updateSitePlan: (p: SitePlan) => {
      const previous = stateRef.current.sitePlans.find(sp => sp.id === p.id);
      const updated = stateRef.current.sitePlans.map(sp => sp.id === p.id ? p : sp);
      dispatch({ type: 'UPDATE_SITE_PLAN', payload: p });
      // Always persist locally as a cache/fallback
      persistMockSitePlans(updated);
      if (offline({ table: 'site_plans', op: 'update', filter: { column: 'id', value: p.id }, data: {
        chantier_id: p.chantierId, name: p.name,
        building: p.building ?? null, level: p.level ?? null,
        building_id: p.buildingId ?? null, level_id: p.levelId ?? null,
        uri: p.uri ?? null, file_type: p.fileType ?? null, dxf_name: p.dxfName ?? null,
        uploaded_at: p.uploadedAt, size: p.size ?? null,
        revision_code: p.revisionCode ?? null, revision_number: p.revisionNumber ?? null,
        parent_plan_id: p.parentPlanId ?? null, is_latest_revision: p.isLatestRevision ?? null,
        revision_note: p.revisionNote ?? null, annotations: p.annotations ?? null,
        pdf_page_count: p.pdfPageCount ?? null,
      } })) return;
      if (isSupabaseConfigured) {
        supabase.from('site_plans').update({
          chantier_id: p.chantierId,
          name: p.name,
          building: p.building ?? null,
          level: p.level ?? null,
          building_id: p.buildingId ?? null,
          level_id: p.levelId ?? null,
          uri: p.uri ?? null,
          file_type: p.fileType ?? null,
          dxf_name: p.dxfName ?? null,
          uploaded_at: p.uploadedAt,
          size: p.size ?? null,
          revision_code: p.revisionCode ?? null,
          revision_number: p.revisionNumber ?? null,
          parent_plan_id: p.parentPlanId ?? null,
          is_latest_revision: p.isLatestRevision ?? null,
          revision_note: p.revisionNote ?? null,
          annotations: p.annotations ?? null,
          pdf_page_count: p.pdfPageCount ?? null,
        }).eq('id', p.id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateSitePlan server error (data saved locally):', error.message);
          }
        });
      }
    },

    deleteSitePlan: (id: string) => {
      const previous = stateRef.current.sitePlans.find(p => p.id === id);
      const updated = stateRef.current.sitePlans.filter(p => p.id !== id);
      dispatch({ type: 'DELETE_SITE_PLAN', payload: id });
      // Always persist locally as a cache/fallback
      persistMockSitePlans(updated);
      if (offline({ table: 'site_plans', op: 'delete', filter: { column: 'id', value: id } })) return;
      if (isSupabaseConfigured) {
        (async () => {
          const { data: deleted, error } = await supabase.from('site_plans').delete().eq('id', id).select();
          if (error) {
            console.warn('[sync] deleteSitePlan erreur serveur:', error.message);
            if (previous) {
              dispatch({ type: 'ADD_SITE_PLAN', payload: previous });
              persistMockSitePlans([...updated, previous]);
              Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer ce plan, ou il n\'existe plus sur le serveur.');
            }
          } else if (!deleted || deleted.length === 0) {
            console.warn('[sync] deleteSitePlan: aucune ligne supprimée (RLS ou déjà inexistante) — suppression conservée localement');
          }
        })();
      }
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
