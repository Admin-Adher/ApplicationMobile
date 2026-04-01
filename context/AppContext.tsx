import React, { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Reserve, Company, Task, Document, Photo, Message, Channel, Profile, Comment, ReserveStatus, ReservePriority, TaskStatus, Chantier, SitePlan, ChantierStatus, Visite, Lot, Opr, VisiteStatus, OprStatus } from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { initStorageBuckets } from '@/lib/storage';
import { C } from '@/constants/colors';
import { genId, nowTimestampFR } from '@/lib/utils';

export const STATIC_CHANNELS: Channel[] = [
  { id: 'general', name: 'Général', description: 'Canal principal du projet', icon: 'home', color: C.primary, type: 'general' },
  { id: 'building-a', name: 'Chantier A', description: 'Messages relatifs au Bâtiment A', icon: 'business', color: '#7C3AED', type: 'building' },
  { id: 'building-b', name: 'Chantier B', description: 'Messages relatifs au Bâtiment B', icon: 'business', color: '#059669', type: 'building' },
  { id: 'building-c', name: 'Chantier C', description: 'Messages relatifs au Bâtiment C', icon: 'business', color: '#D97706', type: 'building' },
];

const CUSTOM_CHANNELS_KEY = 'customChannels_v1';
const GROUP_CHANNELS_KEY = 'groupChannels_v1';
const PINNED_CHANNELS_KEY = 'pinnedChannels_v1';
const CHANNEL_MEMBERS_OVERRIDE_KEY = 'channelMembersOverride_v1';
const MOCK_RESERVES_KEY = 'buildtrack_mock_reserves_v2';
const MOCK_TASKS_KEY = 'buildtrack_mock_tasks_v2';
const MOCK_PHOTOS_KEY = 'buildtrack_mock_photos_v3';
const MOCK_MESSAGES_KEY = 'buildtrack_mock_messages_v1';
const MOCK_CHANTIERS_KEY = 'buildtrack_mock_chantiers_v1';
const MOCK_SITE_PLANS_KEY = 'buildtrack_mock_site_plans_v1';
const MOCK_VISITES_KEY = 'buildtrack_mock_visites_v1';
const MOCK_LOTS_KEY = 'buildtrack_mock_lots_v1';
const MOCK_OPRS_KEY = 'buildtrack_mock_oprs_v1';
const ACTIVE_CHANTIER_KEY = 'buildtrack_active_chantier_v1';
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
  customChannels: Channel[];
  groupChannels: Channel[];
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
  | { type: 'INIT'; payload: Omit<AppState, 'isLoading' | 'lastReadByChannel' | 'customChannels' | 'groupChannels' | 'pinnedChannelIds' | 'channelMembersOverride' | 'chantiers' | 'sitePlans' | 'activeChantierId' | 'visites' | 'lots' | 'oprs'> }
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
  | { type: 'UPDATE_MESSAGE'; payload: Message }
  | { type: 'MARK_MESSAGES_READ' }
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
  | { type: 'ADD_CUSTOM_CHANNEL'; payload: Channel }
  | { type: 'SET_CUSTOM_CHANNELS'; payload: Channel[] }
  | { type: 'REMOVE_CUSTOM_CHANNEL'; payload: string }
  | { type: 'ADD_GROUP_CHANNEL'; payload: Channel }
  | { type: 'SET_GROUP_CHANNELS'; payload: Channel[] }
  | { type: 'REMOVE_GROUP_CHANNEL'; payload: string }
  | { type: 'UPDATE_CHANNEL'; payload: Channel }
  | { type: 'SET_PINNED_CHANNELS'; payload: string[] }
  | { type: 'UPDATE_COMPANY_FULL'; payload: Company }
  | { type: 'DELETE_COMPANY'; payload: string }
  | { type: 'UPDATE_COMPANY_HOURS'; payload: { id: string; hours: number } }
  | { type: 'SET_CHANNEL_MEMBERS_OVERRIDE'; payload: Record<string, string[]> }
  | { type: 'BATCH_UPDATE_RESERVES'; payload: Reserve[] };

function toReserve(row: any): Reserve {
  return {
    id: row.id, title: row.title, description: row.description, building: row.building,
    zone: row.zone, level: row.level, company: row.company, priority: row.priority as ReservePriority,
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
  };
}

function toCompany(row: any): Company {
  return {
    id: row.id, name: row.name, shortName: row.short_name, color: row.color,
    plannedWorkers: row.planned_workers, actualWorkers: row.actual_workers,
    hoursWorked: row.hours_worked, zone: row.zone, contact: row.contact,
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
  };
}

function toVisite(row: any): Visite {
  return {
    id: row.id,
    chantierId: row.chantier_id,
    title: row.title,
    date: row.date,
    conducteur: row.conducteur,
    status: row.status as VisiteStatus,
    building: row.building ?? undefined,
    level: row.level ?? undefined,
    notes: row.notes ?? undefined,
    reserveIds: row.reserve_ids ?? [],
    createdAt: row.created_at,
    conducteurSignature: row.conducteur_signature ?? undefined,
    entrepriseSignature: row.entreprise_signature ?? undefined,
    signedAt: row.signed_at ?? undefined,
    entrepriseSignataire: row.entreprise_signataire ?? undefined,
  };
}

function fromVisite(v: Visite): Record<string, any> {
  return {
    id: v.id, chantier_id: v.chantierId, title: v.title, date: v.date,
    conducteur: v.conducteur, status: v.status,
    building: v.building ?? null, level: v.level ?? null, notes: v.notes ?? null,
    reserve_ids: v.reserveIds, created_at: v.createdAt,
    conducteur_signature: v.conducteurSignature ?? null,
    entreprise_signature: v.entrepriseSignature ?? null,
    signed_at: v.signedAt ?? null,
    entreprise_signataire: v.entrepriseSignataire ?? null,
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

function fromLot(l: Lot): Record<string, any> {
  return {
    id: l.id, code: l.code, name: l.name, color: l.color,
    chantier_id: l.chantierId ?? null,
    company_id: l.companyId ?? null,
    cctp_ref: l.cctpRef ?? null,
    number: l.number ?? null,
  };
}

function toOpr(row: any): Opr {
  return {
    id: row.id, chantierId: row.chantier_id, title: row.title,
    date: row.date, building: row.building, level: row.level,
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

function fromOpr(o: Opr): Record<string, any> {
  return {
    id: o.id, chantier_id: o.chantierId, title: o.title,
    date: o.date, building: o.building, level: o.level,
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
  };
}

function toChantier(row: any): Chantier {
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
  };
}

function toSitePlan(row: any): SitePlan {
  return {
    id: row.id,
    chantierId: row.chantier_id,
    name: row.name,
    building: row.building ?? undefined,
    level: row.level ?? undefined,
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
  };
}

function fromMessage(m: Message): Record<string, any> {
  return {
    id: m.id, channel_id: m.channelId, sender: m.sender, content: m.content,
    timestamp: m.timestamp, type: m.type, read: m.read, is_me: m.isMe,
    reply_to_id: m.replyToId ?? null, reply_to_content: m.replyToContent ?? null,
    reply_to_sender: m.replyToSender ?? null, attachment_uri: m.attachmentUri ?? null,
    reactions: m.reactions, is_pinned: m.isPinned, read_by: m.readBy,
    mentions: m.mentions, reserve_id: m.reserveId ?? null,
  };
}

export function dmChannelId(nameA: string, nameB: string): string {
  return 'dm-' + [nameA, nameB].sort().join('__');
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT':
      return {
        ...action.payload,
        lastReadByChannel: state.lastReadByChannel,
        customChannels: state.customChannels,
        groupChannels: state.groupChannels,
        pinnedChannelIds: state.pinnedChannelIds,
        channelMembersOverride: state.channelMembersOverride,
        chantiers: state.chantiers,
        sitePlans: state.sitePlans,
        activeChantierId: state.activeChantierId,
        visites: state.visites,
        lots: state.lots,
        oprs: state.oprs,
        isLoading: false,
      };

    case 'SET_VISITES': return { ...state, visites: action.payload };
    case 'ADD_VISITE': return { ...state, visites: [action.payload, ...state.visites] };
    case 'UPDATE_VISITE': return { ...state, visites: state.visites.map(v => v.id === action.payload.id ? action.payload : v) };
    case 'DELETE_VISITE': return { ...state, visites: state.visites.filter(v => v.id !== action.payload) };

    case 'SET_LOTS': return { ...state, lots: action.payload };
    case 'ADD_LOT': return { ...state, lots: [...state.lots, action.payload] };
    case 'UPDATE_LOT': return { ...state, lots: state.lots.map(l => l.id === action.payload.id ? action.payload : l) };
    case 'DELETE_LOT': return { ...state, lots: state.lots.filter(l => l.id !== action.payload) };

    case 'SET_OPRS': return { ...state, oprs: action.payload };
    case 'ADD_OPR': return { ...state, oprs: [action.payload, ...state.oprs] };
    case 'UPDATE_OPR': return { ...state, oprs: state.oprs.map(o => o.id === action.payload.id ? action.payload : o) };
    case 'DELETE_OPR': return { ...state, oprs: state.oprs.filter(o => o.id !== action.payload) };

    case 'ADD_CHANTIER':
      return { ...state, chantiers: [...state.chantiers, action.payload] };

    case 'UPDATE_CHANTIER':
      return { ...state, chantiers: state.chantiers.map(c => c.id === action.payload.id ? action.payload : c) };

    case 'DELETE_CHANTIER':
      return {
        ...state,
        chantiers: state.chantiers.filter(c => c.id !== action.payload),
        sitePlans: state.sitePlans.filter(p => p.chantierId !== action.payload),
        reserves: state.reserves.filter(r => r.chantierId !== action.payload),
        tasks: state.tasks.filter(t => t.chantierId !== action.payload),
        activeChantierId: state.activeChantierId === action.payload
          ? (state.chantiers.find(c => c.id !== action.payload)?.id ?? null)
          : state.activeChantierId,
      };

    case 'ADD_SITE_PLAN':
      return { ...state, sitePlans: [...state.sitePlans, action.payload] };

    case 'UPDATE_SITE_PLAN':
      return { ...state, sitePlans: state.sitePlans.map(p => p.id === action.payload.id ? action.payload : p) };

    case 'DELETE_SITE_PLAN':
      return { ...state, sitePlans: state.sitePlans.filter(p => p.id !== action.payload) };

    case 'SET_ACTIVE_CHANTIER':
      return { ...state, activeChantierId: action.payload };

    case 'SET_CHANTIERS':
      return { ...state, chantiers: action.payload };

    case 'SET_SITE_PLANS':
      return { ...state, sitePlans: action.payload };

    case 'ADD_RESERVE':
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

    case 'ADD_COMPANY':
      return { ...state, companies: [...state.companies, action.payload] };

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

    case 'UPDATE_MESSAGE':
      return { ...state, messages: state.messages.map(m => m.id === action.payload.id ? action.payload : m) };

    case 'MARK_MESSAGES_READ':
      return { ...state, messages: state.messages.map(m => ({ ...m, read: true })) };

    case 'SET_CHANNEL_READ': {
      const newLastRead = { ...state.lastReadByChannel, [action.payload.channelId]: action.payload.timestamp };
      AsyncStorage.setItem('lastReadByChannel', JSON.stringify(newLastRead)).catch(() => {});
      return { ...state, lastReadByChannel: newLastRead };
    }

    case 'SET_LAST_READ':
      return { ...state, lastReadByChannel: action.payload };

    case 'ADD_TASK':
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
      return { ...state, photos: [action.payload, ...state.photos] };

    case 'ADD_DOCUMENT':
      return { ...state, documents: [action.payload, ...state.documents] };

    case 'DELETE_DOCUMENT':
      return { ...state, documents: state.documents.filter(d => d.id !== action.payload) };

    case 'DELETE_PHOTO':
      return { ...state, photos: state.photos.filter(p => p.id !== action.payload) };

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'ADD_CUSTOM_CHANNEL':
      return { ...state, customChannels: [...state.customChannels, action.payload] };

    case 'SET_CUSTOM_CHANNELS':
      return { ...state, customChannels: action.payload };

    case 'REMOVE_CUSTOM_CHANNEL':
      return { ...state, customChannels: state.customChannels.filter(c => c.id !== action.payload) };

    case 'ADD_GROUP_CHANNEL':
      return { ...state, groupChannels: [...state.groupChannels, action.payload] };

    case 'SET_GROUP_CHANNELS':
      return { ...state, groupChannels: action.payload };

    case 'REMOVE_GROUP_CHANNEL':
      return { ...state, groupChannels: state.groupChannels.filter(c => c.id !== action.payload) };

    case 'UPDATE_CHANNEL': {
      const ch = action.payload;
      if (ch.type === 'custom') {
        return { ...state, customChannels: state.customChannels.map(c => c.id === ch.id ? ch : c) };
      }
      if (ch.type === 'group') {
        return { ...state, groupChannels: state.groupChannels.map(c => c.id === ch.id ? ch : c) };
      }
      return state;
    }

    case 'SET_PINNED_CHANNELS':
      return { ...state, pinnedChannelIds: action.payload };

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
  addMessage: (channelId: string, content: string, options?: Partial<Pick<Message, 'replyToId' | 'replyToContent' | 'replyToSender' | 'attachmentUri' | 'mentions' | 'reserveId'>>, sender?: string) => void;
  incomingMessage: (msg: Message) => void;
  deleteMessage: (id: string) => void;
  updateMessage: (msg: Message) => void;
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
  addChannelMember: (id: string, memberName: string) => void;
  removeChannelMember: (id: string, memberName: string) => void;
  pinChannel: (id: string) => { success: boolean; reason?: string };
  unpinChannel: (id: string) => void;
  maxPinnedChannels: number;
  getOrCreateDMChannel: (otherName: string) => Channel;
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
  batchUpdateReserves: (ids: string[], updates: Partial<Pick<Reserve, 'status' | 'company' | 'deadline' | 'priority'>>, author?: string) => void;
  addSitePlanVersion: (parentPlanId: string, newPlan: SitePlan) => void;
  migrateReservesToPlan: (fromPlanId: string, toPlanId: string) => number;
  realtimeConnected: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

const MOCK_TODAY = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const MOCK_COMPANIES: Company[] = [
  { id: 'co1', name: 'Maçonnerie Dubois', shortName: 'Dubois', color: '#3B82F6', plannedWorkers: 8, actualWorkers: 6, hoursWorked: 320, zone: 'Zone Nord', contact: 'M. Dubois' },
  { id: 'co2', name: 'Plomberie Martin', shortName: 'Martin', color: '#10B981', plannedWorkers: 4, actualWorkers: 4, hoursWorked: 180, zone: 'Zone Sud', contact: 'Mme Martin' },
  { id: 'co3', name: 'Électricité Leroy', shortName: 'Leroy', color: '#F59E0B', plannedWorkers: 5, actualWorkers: 3, hoursWorked: 210, zone: 'Zone Est', contact: 'M. Leroy' },
  { id: 'co4', name: 'Menuiserie Petit', shortName: 'Petit', color: '#8B5CF6', plannedWorkers: 3, actualWorkers: 3, hoursWorked: 140, zone: 'Zone Ouest', contact: 'M. Petit' },
];

const MOCK_CHANTIERS: Chantier[] = [
  {
    id: 'chan1',
    name: 'Projet Horizon',
    address: '25 rue des Bâtisseurs, 75001 Paris',
    description: 'Construction immeuble résidentiel R+3, 3 bâtiments, 24 logements.',
    startDate: '01/01/2026',
    endDate: '31/12/2026',
    status: 'active',
    createdAt: '2026-01-01',
    createdBy: 'Admin Système',
  },
];

const MOCK_SITE_PLANS: SitePlan[] = [
  { id: 'sp-A', chantierId: 'chan1', name: 'Bâtiment A — Plan masse', uploadedAt: '15/02/2026', size: '2.4 Mo' },
  { id: 'sp-B', chantierId: 'chan1', name: 'Bâtiment B — Plan masse', uploadedAt: '15/02/2026', size: '1.8 Mo' },
  { id: 'sp-C', chantierId: 'chan1', name: 'Bâtiment C — Plan masse', uploadedAt: '20/02/2026', size: '2.1 Mo' },
];

const MOCK_RESERVES: Reserve[] = [
  { id: 'RSV-001', title: 'Fissure mur porteur RDC', description: 'Fissure horizontale de 2 mm sur le mur porteur nord, entre les axes B3 et B4.', building: 'A', zone: 'Zone Nord', level: 'RDC', company: 'Maçonnerie Dubois', priority: 'critical', status: 'open', createdAt: '2026-03-15', deadline: '25/03/2026', comments: [], history: [{ id: 'h1', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-15' }], planX: 20, planY: 30, chantierId: 'chan1', planId: 'sp-A' },
  { id: 'RSV-002', title: 'Fuite canalisation sous-sol', description: 'Fuite eau froide au niveau du coude DN50, local technique.', building: 'B', zone: 'Zone Sud', level: 'Sous-sol', company: 'Plomberie Martin', priority: 'high', status: 'in_progress', createdAt: '2026-03-18', deadline: '22/03/2026', comments: [{ id: 'c1', author: 'Marie Martin', content: 'Intervention prévue demain matin.', createdAt: '2026-03-19' }], history: [{ id: 'h2', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-18' }, { id: 'h3', action: 'Statut modifié', author: 'Jean Dupont', createdAt: '2026-03-19', oldValue: 'Ouvert', newValue: 'En cours' }], planX: 55, planY: 70, chantierId: 'chan1', planId: 'sp-B' },
  { id: 'RSV-003', title: 'Défaut prise électrique R+1', description: "Prise 16A non fonctionnelle chambre 12, vérification du circuit F7.", building: 'A', zone: 'Zone Est', level: 'R+1', company: 'Électricité Leroy', priority: 'medium', status: 'verification', createdAt: '2026-03-10', deadline: '30/03/2026', comments: [], history: [{ id: 'h4', action: 'Réserve créée', author: 'Admin Système', createdAt: '2026-03-10' }], planX: 75, planY: 45, chantierId: 'chan1', planId: 'sp-A' },
  { id: 'RSV-004', title: 'Porte intérieure coincée', description: "Porte chambre 8 ferme mal, gêne au passage. Seuil à reprendre.", building: 'B', zone: 'Zone Ouest', level: 'R+2', company: 'Menuiserie Petit', priority: 'low', status: 'closed', createdAt: '2026-03-05', deadline: '15/03/2026', comments: [], history: [{ id: 'h5', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-05' }, { id: 'h6', action: 'Statut modifié', author: 'Marie Martin', createdAt: '2026-03-14', oldValue: 'En cours', newValue: 'Clôturé' }], planX: 30, planY: 60, chantierId: 'chan1', planId: 'sp-B' },
  { id: 'RSV-005', title: 'Finition peinture escalier', description: "Reprise peinture nécessaire sur la cage d'escalier, côté palier R+1.", building: 'C', zone: 'Zone Centre', level: 'R+1', company: 'Maçonnerie Dubois', priority: 'low', status: 'waiting', createdAt: '2026-03-20', deadline: '—', comments: [], history: [{ id: 'h7', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-20' }], planX: 50, planY: 50, chantierId: 'chan1', planId: 'sp-C' },
  { id: 'RSV-006', title: 'Infiltration toiture bât. C', description: "Trace d'humidité au plafond R+3, infiltration possible au niveau de l'acrotère.", building: 'C', zone: 'Zone Nord', level: 'R+3', company: 'Maçonnerie Dubois', priority: 'high', status: 'open', createdAt: '2026-03-22', deadline: '01/04/2026', comments: [], history: [{ id: 'h8', action: 'Réserve créée', author: 'Admin Système', createdAt: '2026-03-22' }], planX: 65, planY: 20, chantierId: 'chan1', planId: 'sp-C' },
  { id: 'RSV-007', title: 'Câblage réseau salle serveur', description: 'Câbles réseau non étiquetés, brassage à revoir selon plan informatique.', building: 'A', zone: 'Zone Centre', level: 'Sous-sol', company: 'Électricité Leroy', priority: 'medium', status: 'in_progress', createdAt: '2026-03-25', deadline: '05/04/2026', comments: [], history: [{ id: 'h9', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-25' }], planX: 40, planY: 80, chantierId: 'chan1', planId: 'sp-A' },
  { id: 'RSV-008', title: 'Carrelage fissuré salle de bain', description: 'Carrelage salle de bain appt 14, fissure diagonale 15 cm, risque éclat.', building: 'B', zone: 'Zone Est', level: 'R+2', company: 'Maçonnerie Dubois', priority: 'medium', status: 'open', createdAt: '2026-03-28', deadline: '10/04/2026', comments: [], history: [{ id: 'h10', action: 'Réserve créée', author: 'Marie Martin', createdAt: '2026-03-28' }], planX: 80, planY: 35, chantierId: 'chan1', planId: 'sp-B' },
];

const MOCK_TASKS: Task[] = [
  { id: 'tsk1', title: 'Coulage dalle bâtiment A', description: 'Préparation et coulage dalle béton niveau RDC.', status: 'done', priority: 'high', startDate: '2026-03-01', deadline: '15/03/2026', assignee: 'Jean Dupont', progress: 100, company: 'co1', comments: [], history: [{ id: 'ht1', action: 'Tâche créée', author: 'Admin Système', createdAt: '2026-03-01' }] },
  { id: 'tsk2', title: 'Installation réseau plomberie', description: 'Pose canalisations eau froide/chaude bâtiments A et B.', status: 'in_progress', priority: 'high', startDate: '2026-03-10', deadline: '31/03/2026', assignee: 'Marie Martin', progress: 65, company: 'co2', comments: [{ id: 'tc1', author: 'Marie Martin', content: 'Bâtiment A terminé, B en cours.', createdAt: '2026-03-20' }], history: [{ id: 'ht2', action: 'Tâche créée', author: 'Admin Système', createdAt: '2026-03-10' }] },
  { id: 'tsk3', title: 'Câblage électrique R+1', description: 'Tirage câbles et pose tableaux électriques niveau R+1.', status: 'in_progress', priority: 'medium', startDate: '2026-03-15', deadline: '05/04/2026', assignee: 'Pierre Lambert', progress: 40, company: 'co3', comments: [], history: [{ id: 'ht3', action: 'Tâche créée', author: 'Admin Système', createdAt: '2026-03-15' }] },
  { id: 'tsk4', title: 'Pose menuiseries extérieures', description: 'Installation fenêtres double vitrage et portes palières.', status: 'todo', priority: 'medium', startDate: '2026-04-01', deadline: '20/04/2026', assignee: 'Jean Dupont', progress: 0, company: 'co4', comments: [], history: [{ id: 'ht4', action: 'Tâche créée', author: 'Admin Système', createdAt: '2026-03-28' }] },
  { id: 'tsk5', title: 'Finitions peinture intérieure', description: "Peinture blanche deux couches sur l'ensemble des pièces.", status: 'todo', priority: 'low', startDate: '2026-04-15', deadline: '30/04/2026', assignee: 'Admin Système', progress: 0, company: 'co1', comments: [], history: [{ id: 'ht5', action: 'Tâche créée', author: 'Admin Système', createdAt: '2026-03-28' }] },
];

const MOCK_DOCUMENTS: Document[] = [
  { id: 'doc1', name: 'Plan masse - Bâtiment A.pdf', type: 'plan', category: 'Plans', uploadedAt: '2026-02-15', size: '2.4 Mo', version: 3 },
  { id: 'doc2', name: 'CCTP Plomberie.pdf', type: 'technical', category: 'Marchés', uploadedAt: '2026-01-20', size: '1.1 Mo', version: 1 },
  { id: 'doc3', name: 'Calendrier prévisionnel.xlsx', type: 'other', category: 'Planning', uploadedAt: '2026-03-01', size: '340 Ko', version: 2 },
];

const MOCK_PHOTOS: Photo[] = [
  { id: 'ph1', comment: 'Fissure mur nord RSV-001', location: 'Bât. A - RDC', takenAt: '2026-03-15', takenBy: 'Jean Dupont', colorCode: '#EF4444', uri: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400&q=80' },
  { id: 'ph2', comment: 'État avancement dalle béton', location: 'Bât. A - RDC', takenAt: '2026-03-10', takenBy: 'Admin Système', colorCode: '#10B981', uri: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&q=80' },
  { id: 'ph3', comment: 'Salle serveur — câblage réseau', location: 'Bât. A - Sous-sol', takenAt: '2026-03-25', takenBy: 'Jean Dupont', colorCode: '#F59E0B', uri: 'https://images.unsplash.com/photo-1590496793929-36417d3117de?w=400&q=80' },
];

const MOCK_MESSAGES: Message[] = [
  { id: 'msg1', channelId: 'general', sender: 'Jean Dupont', content: "Bonjour à tous, réunion de chantier à 14h aujourd'hui.", timestamp: `${MOCK_TODAY} 08:15`, type: 'message', read: false, isMe: false, reactions: {}, isPinned: false, readBy: [], mentions: [] },
  { id: 'msg2', channelId: 'general', sender: 'Marie Martin', content: 'Présent. Je prépare le point sur les réserves en cours.', timestamp: `${MOCK_TODAY} 08:32`, type: 'message', read: false, isMe: false, reactions: {}, isPinned: false, readBy: [], mentions: [] },
  { id: 'msg3', channelId: 'building-a', sender: 'Jean Dupont', content: 'La fissure RSV-001 a été confirmée ce matin. Priorité critique.', timestamp: `${MOCK_TODAY} 09:05`, type: 'message', read: false, isMe: false, reactions: {}, isPinned: false, readBy: [], mentions: [] },
  { id: 'msg4', channelId: 'building-b', sender: 'Marie Martin', content: 'Intervention plomberie confirmée pour demain 8h.', timestamp: `${MOCK_TODAY} 09:45`, type: 'message', read: false, isMe: false, reactions: {}, isPinned: false, readBy: [], mentions: [] },
  { id: 'msg5', channelId: 'building-c', sender: 'Pierre Lambert', content: "Infiltration toiture RSV-006 vérifiée. Rapport transmis à l'architecte.", timestamp: `${MOCK_TODAY} 10:12`, type: 'message', read: false, isMe: false, reactions: {}, isPinned: false, readBy: [], mentions: [] },
];

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

const MOCK_VISITES: Visite[] = [
  {
    id: 'vis-001',
    chantierId: 'chan1',
    title: 'Visite de contrôle — Semaine 12',
    date: '25/03/2026',
    conducteur: 'Jean Dupont',
    status: 'completed',
    building: 'A',
    level: 'RDC',
    notes: 'Visite complète bâtiment A, relevé des désordres structurels et finitions.',
    reserveIds: ['RSV-001', 'RSV-003', 'RSV-007'],
    createdAt: '2026-03-25',
  },
  {
    id: 'vis-002',
    chantierId: 'chan1',
    title: 'Visite plomberie — Bât. B',
    date: '28/03/2026',
    conducteur: 'Jean Dupont',
    status: 'completed',
    building: 'B',
    level: 'Sous-sol',
    notes: 'Contrôle réseau plomberie suite fuite RSV-002.',
    reserveIds: ['RSV-002', 'RSV-008'],
    createdAt: '2026-03-28',
  },
];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    reserves: [], companies: [], tasks: [],
    documents: [], photos: [], messages: [],
    lastReadByChannel: {}, isLoading: true,
    profiles: [], customChannels: [], groupChannels: [], pinnedChannelIds: [],
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
  const activeChannelIdRef = useRef<string | null>(null);
  const channelsRef = useRef<Channel[]>([...STATIC_CHANNELS]);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    try {
      const stored = await AsyncStorage.getItem(CUSTOM_CHANNELS_KEY);
      if (stored) {
        dispatch({ type: 'SET_CUSTOM_CHANNELS', payload: JSON.parse(stored) });
      }
    } catch {}
  }

  async function saveCustomChannels(channels: Channel[]) {
    try {
      await AsyncStorage.setItem(CUSTOM_CHANNELS_KEY, JSON.stringify(channels));
    } catch {}
  }

  async function loadGroupChannels() {
    try {
      const stored = await AsyncStorage.getItem(GROUP_CHANNELS_KEY);
      if (stored) {
        dispatch({ type: 'SET_GROUP_CHANNELS', payload: JSON.parse(stored) });
      }
    } catch {}
  }

  async function saveGroupChannels(channels: Channel[]) {
    try {
      await AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(channels));
    } catch {}
  }

  async function loadPinnedChannels() {
    try {
      const stored = await AsyncStorage.getItem(PINNED_CHANNELS_KEY);
      if (stored) {
        dispatch({ type: 'SET_PINNED_CHANNELS', payload: JSON.parse(stored) });
      }
    } catch {}
  }

  async function savePinnedChannels(ids: string[]) {
    try {
      await AsyncStorage.setItem(PINNED_CHANNELS_KEY, JSON.stringify(ids));
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
      if (sac) activeChantierId = sac;
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

    dispatch({
      type: 'INIT',
      payload: {
        reserves,
        companies: MOCK_COMPANIES,
        tasks,
        documents: MOCK_DOCUMENTS,
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

  async function loadAll() {
    if (!isSupabaseConfigured) {
      await loadMockData();
      return;
    }

    dispatch({ type: 'SET_LOADING', payload: true });

    initStorageBuckets().catch(() => {});
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', session.user.id)
          .single();
        if (profile?.name) {
          currentUserNameRef.current = profile.name;
        }
      }

      const [
        { data: reserves, error: reservesErr },
        { data: companies },
        { data: tasks },
        { data: documents },
        { data: photos },
        { data: messages },
        { data: profilesData },
      ] = await Promise.all([
        supabase.from('reserves').select('*').order('created_at', { ascending: false }),
        supabase.from('companies').select('*'),
        supabase.from('tasks').select('*'),
        supabase.from('documents').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('photos').select('*').order('taken_at', { ascending: false }),
        supabase.from('messages').select('*').order('timestamp', { ascending: true }),
        supabase.from('profiles').select('id, name, role, role_label, email'),
      ]);

      if (reservesErr) {
        console.warn('Erreur chargement réserves:', reservesErr.message);
      }

      const storedLastRead = await AsyncStorage.getItem('lastReadByChannel').catch(() => null);
      if (storedLastRead) {
        dispatch({ type: 'SET_LAST_READ', payload: JSON.parse(storedLastRead) });
      }

      await loadCustomChannels();
      await loadGroupChannels();
      await loadPinnedChannels();
      await loadChannelMembersOverride();

      const userName = currentUserNameRef.current;
      dispatch({
        type: 'INIT',
        payload: {
          reserves: (reserves ?? []).map(toReserve),
          companies: (companies ?? []).map(toCompany),
          tasks: (tasks ?? []).map(toTask),
          documents: (documents ?? []).map(toDocument),
          photos: (photos ?? []).map(toPhoto),
          messages: (messages ?? []).map((r: any) => toMessage(r, userName)),
          profiles: (profilesData ?? []).map((p: any) => ({ id: p.id, name: p.name, role: p.role, roleLabel: p.role_label ?? ROLE_LABELS[p.role as UserRole] ?? p.role, email: p.email })),
        },
      });

      let chantiers: Chantier[] = MOCK_CHANTIERS;
      let sitePlans: SitePlan[] = MOCK_SITE_PLANS;
      let activeChantierId: string | null = null;

      try {
        const { data: chantiersData, error: chantiersErr } = await supabase
          .from('chantiers').select('*').order('created_at', { ascending: false });
        if (!chantiersErr && chantiersData && chantiersData.length > 0) {
          chantiers = chantiersData.map(toChantier);
        } else {
          const sc = await AsyncStorage.getItem(MOCK_CHANTIERS_KEY);
          if (sc) {
            const p = JSON.parse(sc);
            if (Array.isArray(p)) {
              const stored: Chantier[] = p;
              const storedIds = new Set(stored.map((c: Chantier) => c.id));
              const missing = MOCK_CHANTIERS.filter(c => !storedIds.has(c.id));
              chantiers = [...missing, ...stored];
            }
          }
          persistMockChantiers(chantiers);
        }
      } catch {
        const sc = await AsyncStorage.getItem(MOCK_CHANTIERS_KEY).catch(() => null);
        if (sc) { const p = JSON.parse(sc); if (Array.isArray(p)) chantiers = p; }
      }

      try {
        const { data: sitePlansData, error: sitePlansErr } = await supabase
          .from('site_plans').select('*').order('created_at', { ascending: false });
        if (!sitePlansErr && sitePlansData && sitePlansData.length > 0) {
          sitePlans = sitePlansData.map(toSitePlan);
        } else {
          const ssp = await AsyncStorage.getItem(MOCK_SITE_PLANS_KEY);
          if (ssp) {
            const p = JSON.parse(ssp);
            if (Array.isArray(p)) {
              const stored: SitePlan[] = p;
              const storedIds = new Set(stored.map((s: SitePlan) => s.id));
              const missing = MOCK_SITE_PLANS.filter(s => !storedIds.has(s.id));
              sitePlans = [...missing, ...stored];
            }
          }
          persistMockSitePlans(sitePlans);
        }
      } catch {
        const ssp = await AsyncStorage.getItem(MOCK_SITE_PLANS_KEY).catch(() => null);
        if (ssp) { const p = JSON.parse(ssp); if (Array.isArray(p)) sitePlans = p; }
      }

      try {
        const sac = await AsyncStorage.getItem(ACTIVE_CHANTIER_KEY);
        if (sac) activeChantierId = sac;
      } catch {}
      dispatch({ type: 'SET_CHANTIERS', payload: chantiers });
      dispatch({ type: 'SET_SITE_PLANS', payload: sitePlans });
      if (activeChantierId) dispatch({ type: 'SET_ACTIVE_CHANTIER', payload: activeChantierId });

      let visites: Visite[] = MOCK_VISITES;
      let lots: Lot[] = STANDARD_LOTS;
      let oprs: Opr[] = [];

      try {
        const { data: visitesData, error: visitesErr } = await supabase.from('visites').select('*').order('created_at', { ascending: false });
        if (!visitesErr && visitesData) {
          visites = visitesData.map(toVisite);
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
        if (!oprsErr && oprsData) {
          oprs = oprsData.map(toOpr);
        } else {
          const so = await AsyncStorage.getItem(MOCK_OPRS_KEY).catch(() => null);
          if (so) { const p = JSON.parse(so); if (Array.isArray(p)) oprs = p; }
        }
      } catch {
        const so = await AsyncStorage.getItem(MOCK_OPRS_KEY).catch(() => null);
        if (so) { const p = JSON.parse(so); if (Array.isArray(p)) oprs = p; }
      }

      dispatch({ type: 'SET_VISITES', payload: visites });
      dispatch({ type: 'SET_LOTS', payload: lots });
      dispatch({ type: 'SET_OPRS', payload: oprs });

    } catch (err) {
      console.warn('Supabase load error:', err);
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
      if (event === 'SIGNED_IN' && session) {
        loadAll();
      } else if (event === 'SIGNED_OUT') {
        currentUserNameRef.current = '';
        dispatch({ type: 'INIT', payload: { reserves: [], companies: [], tasks: [], documents: [], photos: [], messages: [], profiles: [] } });
      }
    });

    supabase.auth.getSession().then(({ data: { session } }: { data: { session: any } }) => {
      if (session) loadAll();
      else dispatch({ type: 'SET_LOADING', payload: false });
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
        dispatch({ type: 'UPDATE_MESSAGE', payload: toMessage(payload.new, userName) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload: any) => {
        dispatch({ type: 'DELETE_MESSAGE', payload: payload.old.id });
      })
      .subscribe();

    return () => { supabase.removeChannel(globalSub); };
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
      .subscribe((status: string) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    const taskSub = supabase
      .channel('realtime-tasks-v1')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, (payload: any) => {
        dispatch({ type: 'UPDATE_TASK', payload: toTask(payload.new) });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(reserveSub);
      supabase.removeChannel(taskSub);
    };
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4500);
    return () => clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      persistMockMessages(state.messages);
    }
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

  const companyChannels: Channel[] = state.companies.map(co => ({
    id: `company-${co.id}`,
    name: co.name,
    description: `Canal de l'entreprise ${co.name}`,
    icon: 'people' as const,
    color: co.color,
    type: 'company' as const,
  }));

  const dmChannelIds = new Set([
    ...state.messages
      .filter(m => m.channelId.startsWith('dm-'))
      .map(m => m.channelId),
    ...Array.from(pendingDmChannelIds),
  ]);

  const dmChannels: Channel[] = Array.from(dmChannelIds).map(chId => {
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

  const channels: Channel[] = [
    ...STATIC_CHANNELS,
    ...companyChannels,
    ...state.customChannels,
    ...state.groupChannels,
    ...dmChannels,
  ];

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const unreadByChannel: Record<string, number> = {};
  for (const ch of channels) {
    const lastRead = state.lastReadByChannel[ch.id] ?? '0';
    unreadByChannel[ch.id] = state.messages.filter(
      m => m.channelId === ch.id && !m.isMe && m.timestamp > lastRead
    ).length;
  }

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
    const newCh: Channel = {
      id: 'custom-' + genId(),
      name, description, icon, color,
      type: 'custom',
      createdBy: currentUserNameRef.current,
    };
    dispatch({ type: 'ADD_CUSTOM_CHANNEL', payload: newCh });
    const updated = [...stateRef.current.customChannels, newCh];
    saveCustomChannels(updated);
    return newCh;
  }

  function removeCustomChannel(id: string) {
    dispatch({ type: 'REMOVE_CUSTOM_CHANNEL', payload: id });
    const updated = stateRef.current.customChannels.filter(c => c.id !== id);
    saveCustomChannels(updated);
  }

  function addGroupChannel(name: string, members: string[], color: string): Channel {
    const newCh: Channel = {
      id: 'group-' + genId(),
      name,
      description: `Groupe : ${members.join(', ')}`,
      icon: 'people-circle',
      color,
      type: 'group',
      members,
      createdBy: currentUserNameRef.current,
    };
    dispatch({ type: 'ADD_GROUP_CHANNEL', payload: newCh });
    const updated = [...stateRef.current.groupChannels, newCh];
    saveGroupChannels(updated);
    return newCh;
  }

  function removeGroupChannel(id: string) {
    dispatch({ type: 'REMOVE_GROUP_CHANNEL', payload: id });
    const updated = stateRef.current.groupChannels.filter(c => c.id !== id);
    saveGroupChannels(updated);
  }

  function _updateAndPersistChannel(updatedCh: Channel) {
    dispatch({ type: 'UPDATE_CHANNEL', payload: updatedCh });
    if (updatedCh.type === 'custom') {
      saveCustomChannels(stateRef.current.customChannels.map(c => c.id === updatedCh.id ? updatedCh : c));
    } else if (updatedCh.type === 'group') {
      saveGroupChannels(stateRef.current.groupChannels.map(c => c.id === updatedCh.id ? updatedCh : c));
    }
  }

  function renameChannel(id: string, newName: string) {
    const ch = [...state.customChannels, ...state.groupChannels].find(c => c.id === id);
    if (ch) {
      _updateAndPersistChannel({ ...ch, name: newName });
      return;
    }
    if (id.startsWith('company-')) {
      const companyId = id.replace('company-', '');
      const company = state.companies.find(co => co.id === companyId);
      if (company) {
        const updatedCompany = { ...company, name: newName };
        if (isSupabaseConfigured) {
          supabase.from('companies').update({ name: newName }).eq('id', companyId).then(({ error }: { error: any }) => {
            if (error) console.warn('Erreur renommage canal entreprise:', error.message);
          });
        }
        dispatch({ type: 'UPDATE_COMPANY_FULL', payload: updatedCompany });
      }
    }
  }

  function addChannelMember(id: string, memberName: string) {
    const ch = [...state.customChannels, ...state.groupChannels].find(c => c.id === id);
    if (ch) {
      const members = [...(ch.members ?? [])];
      if (members.includes(memberName)) return;
      members.push(memberName);
      _updateAndPersistChannel({
        ...ch, members,
        description: ch.type === 'group' ? `Groupe : ${members.join(', ')}` : ch.description,
      });
    } else {
      const current = state.channelMembersOverride[id] ?? [];
      if (current.includes(memberName)) return;
      const updated = [...current, memberName];
      const newOverrides = { ...state.channelMembersOverride, [id]: updated };
      dispatch({ type: 'SET_CHANNEL_MEMBERS_OVERRIDE', payload: newOverrides });
      saveChannelMembersOverride(newOverrides);
    }
  }

  function removeChannelMember(id: string, memberName: string) {
    const ch = [...state.customChannels, ...state.groupChannels].find(c => c.id === id);
    if (ch) {
      const members = (ch.members ?? []).filter(m => m !== memberName);
      _updateAndPersistChannel({
        ...ch, members,
        description: ch.type === 'group' ? `Groupe : ${members.join(', ')}` : ch.description,
      });
    } else {
      const current = state.channelMembersOverride[id] ?? [];
      const updated = current.filter(m => m !== memberName);
      const newOverrides = { ...state.channelMembersOverride, [id]: updated };
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
    const newPending = new Set(pendingDmChannelIds).add(chId);
    setPendingDmChannelIds(newPending);
    AsyncStorage.setItem(PENDING_DM_KEY, JSON.stringify([...newPending])).catch(() => {});
    return {
      id: chId,
      name: otherName,
      description: `Message direct avec ${otherName}`,
      icon: 'person-circle',
      color: '#EC4899',
      type: 'dm',
      dmParticipants: [myName, otherName],
    };
  }

  const value: AppContextValue = {
    ...state, stats, unreadCount, channels, unreadByChannel, notification, realtimeConnected,
    setActiveChannelId,
    dismissNotification,

    addReserve: (r) => {
      dispatch({ type: 'ADD_RESERVE', payload: r });
      if (isSupabaseConfigured) {
        supabase.from('reserves').insert({
          id: r.id, title: r.title, description: r.description, building: r.building,
          zone: r.zone, level: r.level, company: r.company, priority: r.priority,
          status: r.status, created_at: r.createdAt, deadline: r.deadline,
          comments: r.comments, history: r.history, plan_x: r.planX, plan_y: r.planY,
          photo_uri: r.photoUri,
          lot_id: r.lotId ?? null,
          kind: r.kind ?? null,
          chantier_id: r.chantierId ?? null,
          plan_id: r.planId ?? null,
          visite_id: r.visiteId ?? null,
          linked_task_id: r.linkedTaskId ?? null,
          photos: r.photos ?? null,
          photo_annotations: r.photoAnnotations ?? null,
          enterprise_signature: r.enterpriseSignature ?? null,
          enterprise_signataire: r.enterpriseSignataire ?? null,
          enterprise_acknowledged_at: r.enterpriseAcknowledgedAt ?? null,
        }).then(({ error }: { error: any }) => {
          if (error) {
            dispatch({ type: 'DELETE_RESERVE', payload: r.id });
            Alert.alert('Erreur de sauvegarde', "La réserve n'a pas pu être enregistrée. Vérifiez votre connexion et réessayez.");
          }
        });
      } else {
        persistMockReserves([r, ...stateRef.current.reserves]);
      }
    },

    updateReserve: (r) => {
      const previous = stateRef.current.reserves.find(res => res.id === r.id);
      dispatch({ type: 'UPDATE_RESERVE', payload: r });
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({
          title: r.title, description: r.description, building: r.building,
          zone: r.zone, level: r.level, company: r.company, priority: r.priority,
          status: r.status, deadline: r.deadline, comments: r.comments, history: r.history,
          plan_x: r.planX, plan_y: r.planY, photo_uri: r.photoUri,
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
        }).eq('id', r.id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_RESERVE', payload: previous });
            Alert.alert('Erreur de sauvegarde', "La modification de la réserve n'a pas pu être enregistrée.");
          }
        });
      } else {
        persistMockReserves(stateRef.current.reserves.map(res => res.id === r.id ? r : res));
      }
    },

    updateReserveFields: (r) => {
      const previous = stateRef.current.reserves.find(res => res.id === r.id);
      dispatch({ type: 'UPDATE_RESERVE_FIELDS', payload: r });
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({
          title: r.title, description: r.description, building: r.building,
          zone: r.zone, level: r.level, company: r.company, priority: r.priority,
          status: r.status, deadline: r.deadline, comments: r.comments, history: r.history,
          photo_uri: r.photoUri ?? null,
          lot_id: r.lotId ?? null,
          kind: r.kind ?? null,
          photos: r.photos ?? null,
          photo_annotations: r.photoAnnotations ?? null,
        }).eq('id', r.id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_RESERVE_FIELDS', payload: previous });
            Alert.alert('Erreur de sauvegarde', "La modification de la réserve n'a pas pu être enregistrée.");
          }
        });
      } else {
        persistMockReserves(stateRef.current.reserves.map(res => res.id === r.id ? r : res));
      }
    },

    deleteReserve: (id) => {
      const previous = stateRef.current.reserves.find(r => r.id === id);
      dispatch({ type: 'DELETE_RESERVE', payload: id });
      if (isSupabaseConfigured) {
        supabase.from('reserves').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'ADD_RESERVE', payload: previous });
            Alert.alert('Erreur de suppression', "La réserve n'a pas pu être supprimée. Veuillez réessayer.");
          }
        });
      } else {
        persistMockReserves(stateRef.current.reserves.filter(r => r.id !== id));
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
        createdAt: new Date().toISOString().slice(0, 10),
        oldValue: labels[reserve.status],
        newValue: labels[status],
      };
      const closedAt = status === 'closed' ? new Date().toISOString().slice(0, 10) : reserve.closedAt;
      const closedBy = status === 'closed' ? author : reserve.closedBy;
      const updated: Reserve = {
        ...reserve,
        status,
        history: [...reserve.history, historyEntry],
        closedAt,
        closedBy,
      };
      dispatch({ type: 'UPDATE_RESERVE_STATUS', payload: updated });
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({
          status: updated.status, history: updated.history,
          closed_at: closedAt ?? null, closed_by: closedBy ?? null,
        }).eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            dispatch({ type: 'UPDATE_RESERVE_STATUS', payload: reserve });
            Alert.alert('Erreur de sauvegarde', "Le statut de la réserve n'a pas pu être mis à jour.");
          }
        });
      }

      const company = stateRef.current.companies.find(c => c.name === reserve.company);
      if (company) {
        const notifChannelId = `company-${company.id}`;
        const ts = nowTimestampFR();
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
            if (error) console.warn('Erreur notification canal:', error.message);
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
        createdAt: new Date().toISOString().slice(0, 10),
      };
      const updatedComments = [...reserve.comments, comment];
      dispatch({ type: 'ADD_COMMENT', payload: { reserveId, comment } });
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({ comments: updatedComments }).eq('id', reserveId).then(({ error }: { error: any }) => {
          if (error) {
            dispatch({ type: 'UPDATE_RESERVE', payload: reserve });
            Alert.alert('Erreur de sauvegarde', "Le commentaire n'a pas pu être enregistré.");
          }
        });
      }
    },

    addCompany: (c) => {
      dispatch({ type: 'ADD_COMPANY', payload: c });
      if (isSupabaseConfigured) {
        supabase.from('companies').insert({
          id: c.id, name: c.name, short_name: c.shortName, color: c.color,
          planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
          hours_worked: c.hoursWorked, zone: c.zone, contact: c.contact,
          email: c.email ?? null, lots: c.lots ?? null,
          siret: c.siret ?? null, insurance: c.insurance ?? null,
          qualifications: c.qualifications ?? null,
        }).then(({ error }: { error: any }) => {
          if (error) {
            dispatch({ type: 'DELETE_COMPANY', payload: c.id });
            Alert.alert('Erreur de sauvegarde', "L'entreprise n'a pas pu être enregistrée.");
          }
        });
      }
    },

    updateCompanyWorkers: (id, actual) => {
      const previous = stateRef.current.companies.find(c => c.id === id);
      dispatch({ type: 'UPDATE_COMPANY', payload: { id, actualWorkers: actual } });
      if (isSupabaseConfigured) {
        supabase.from('companies').update({ actual_workers: actual }).eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_COMPANY', payload: { id, actualWorkers: previous.actualWorkers } });
            Alert.alert('Erreur de sauvegarde', "L'effectif n'a pas pu être mis à jour.");
          }
        });
      }
    },

    updateCompanyFull: (c) => {
      const previous = stateRef.current.companies.find(co => co.id === c.id);
      dispatch({ type: 'UPDATE_COMPANY_FULL', payload: c });
      if (isSupabaseConfigured) {
        supabase.from('companies').update({
          name: c.name, short_name: c.shortName, color: c.color,
          planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
          hours_worked: c.hoursWorked, zone: c.zone, contact: c.contact,
          email: c.email ?? null, lots: c.lots ?? null,
          siret: c.siret ?? null, insurance: c.insurance ?? null,
          qualifications: c.qualifications ?? null,
        }).eq('id', c.id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_COMPANY_FULL', payload: previous });
            Alert.alert('Erreur de sauvegarde', "L'entreprise n'a pas pu être mise à jour.");
          }
        });
      }
    },

    deleteCompany: (id) => {
      const previous = stateRef.current.companies.find(c => c.id === id);
      dispatch({ type: 'DELETE_COMPANY', payload: id });
      if (isSupabaseConfigured) {
        supabase.from('companies').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'ADD_COMPANY', payload: previous });
            Alert.alert('Erreur de suppression', "L'entreprise n'a pas pu être supprimée.");
          }
        });
      }
    },

    updateCompanyHours: (id, hours) => {
      const previous = stateRef.current.companies.find(c => c.id === id);
      dispatch({ type: 'UPDATE_COMPANY_HOURS', payload: { id, hours } });
      if (isSupabaseConfigured) {
        supabase.from('companies').update({ hours_worked: hours }).eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_COMPANY_HOURS', payload: { id, hours: previous.hoursWorked } });
            Alert.alert('Erreur de sauvegarde', "Les heures n'ont pas pu être mises à jour.");
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
      };
      dispatch({ type: 'ADD_MESSAGE', payload: msg });
      if (isSupabaseConfigured) {
        supabase.from('messages').insert(fromMessage(msg)).then(({ error }: { error: any }) => {
          if (error) {
            dispatch({ type: 'DELETE_MESSAGE', payload: msg.id });
            Alert.alert('Erreur d\'envoi', "Le message n'a pas pu être envoyé. Vérifiez votre connexion.");
          }
        });
      } else {
        persistMockMessages([...stateRef.current.messages, msg]);
      }
    },

    incomingMessage: (msg) => dispatch({ type: 'INCOMING_MESSAGE', payload: msg }),

    deleteMessage: (id) => {
      const previous = stateRef.current.messages.find(m => m.id === id);
      dispatch({ type: 'DELETE_MESSAGE', payload: id });
      if (isSupabaseConfigured) {
        supabase.from('messages').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'ADD_MESSAGE', payload: previous });
            Alert.alert('Erreur de suppression', "Le message n'a pas pu être supprimé.");
          }
        });
      } else {
        persistMockMessages(stateRef.current.messages.filter(m => m.id !== id));
      }
    },

    updateMessage: (msg) => {
      const previous = stateRef.current.messages.find(m => m.id === msg.id);
      dispatch({ type: 'UPDATE_MESSAGE', payload: msg });
      if (isSupabaseConfigured) {
        supabase.from('messages').update(fromMessage(msg)).eq('id', msg.id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_MESSAGE', payload: previous });
            Alert.alert('Erreur de sauvegarde', "La modification du message n'a pas pu être enregistrée.");
          }
        });
      } else {
        persistMockMessages(stateRef.current.messages.map(m => m.id === msg.id ? msg : m));
      }
    },

    markMessagesRead: () => {
      dispatch({ type: 'MARK_MESSAGES_READ' });
    },

    setChannelRead: (channelId) => {
      dispatch({ type: 'SET_CHANNEL_READ', payload: { channelId, timestamp: nowTimestampFR() } });
    },

    addTask: (t) => {
      dispatch({ type: 'ADD_TASK', payload: t });
      if (isSupabaseConfigured) {
        supabase.from('tasks').insert({
          id: t.id, title: t.title, description: t.description, status: t.status,
          priority: t.priority, start_date: t.startDate ?? null, deadline: t.deadline,
          assignee: t.assignee, progress: t.progress, company: t.company,
          chantier_id: t.chantierId ?? null, reserve_id: t.reserveId ?? null,
          comments: t.comments ?? [], history: t.history ?? [],
        }).then(({ error }: { error: any }) => {
          if (error) {
            dispatch({ type: 'DELETE_TASK', payload: t.id });
            Alert.alert('Erreur de sauvegarde', "La tâche n'a pas pu être enregistrée.");
          }
        });
      } else {
        persistMockTasks([t, ...stateRef.current.tasks]);
      }
    },

    updateTask: (t) => {
      const previous = stateRef.current.tasks.find(tk => tk.id === t.id);
      dispatch({ type: 'UPDATE_TASK', payload: t });
      if (isSupabaseConfigured) {
        supabase.from('tasks').update({
          title: t.title, description: t.description, status: t.status,
          priority: t.priority, start_date: t.startDate ?? null, deadline: t.deadline,
          assignee: t.assignee, progress: t.progress, company: t.company,
          comments: t.comments ?? [], history: t.history ?? [],
        }).eq('id', t.id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_TASK', payload: previous });
            Alert.alert('Erreur de sauvegarde', "La tâche n'a pas pu être mise à jour.");
          }
        });
      } else {
        persistMockTasks(stateRef.current.tasks.map(tk => tk.id === t.id ? t : tk));
      }
    },

    deleteTask: (id) => {
      const previous = stateRef.current.tasks.find(t => t.id === id);
      dispatch({ type: 'DELETE_TASK', payload: id });
      if (isSupabaseConfigured) {
        supabase.from('tasks').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'ADD_TASK', payload: previous });
            Alert.alert('Erreur de suppression', "La tâche n'a pas pu être supprimée.");
          }
        });
      } else {
        persistMockTasks(stateRef.current.tasks.filter(t => t.id !== id));
      }
    },

    addTaskComment: (taskId, content, author = 'Utilisateur') => {
      const task = stateRef.current.tasks.find(t => t.id === taskId);
      if (!task) return;
      const actualAuthor = currentUserNameRef.current || author;
      const comment: Comment = {
        id: genId(), author: actualAuthor, content,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      const updatedComments = [...(task.comments ?? []), comment];
      dispatch({ type: 'ADD_TASK_COMMENT', payload: { taskId, comment } });
      if (isSupabaseConfigured) {
        supabase.from('tasks').update({ comments: updatedComments }).eq('id', taskId).then(({ error }: { error: any }) => {
          if (error) {
            dispatch({ type: 'UPDATE_TASK', payload: task });
            Alert.alert('Erreur de sauvegarde', "Le commentaire n'a pas pu être enregistré.");
          }
        });
      } else {
        const updatedTasks = stateRef.current.tasks.map(t =>
          t.id === taskId ? { ...t, comments: updatedComments } : t
        );
        persistMockTasks(updatedTasks);
      }
    },

    addPhoto: (p) => {
      dispatch({ type: 'ADD_PHOTO', payload: p });
      if (isSupabaseConfigured) {
        supabase.from('photos').insert({
          id: p.id, comment: p.comment, location: p.location,
          taken_at: p.takenAt, taken_by: p.takenBy, color_code: p.colorCode, uri: p.uri,
        }).then(({ error }: { error: any }) => {
          if (error) {
            dispatch({ type: 'DELETE_PHOTO', payload: p.id });
            Alert.alert('Erreur de sauvegarde', "La photo n'a pas pu être enregistrée sur le serveur.");
          }
        });
      } else {
        persistMockPhotos([p, ...stateRef.current.photos]);
      }
    },

    deletePhoto: (id) => {
      const previous = stateRef.current.photos.find(p => p.id === id);
      dispatch({ type: 'DELETE_PHOTO', payload: id });
      if (isSupabaseConfigured) {
        supabase.from('photos').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'ADD_PHOTO', payload: previous });
            Alert.alert('Erreur de suppression', "La photo n'a pas pu être supprimée.");
          }
        });
      } else {
        persistMockPhotos(stateRef.current.photos.filter(p => p.id !== id));
      }
    },

    addDocument: (d) => {
      dispatch({ type: 'ADD_DOCUMENT', payload: d });
      if (isSupabaseConfigured) {
        supabase.from('documents').insert({
          id: d.id, name: d.name, type: d.type, category: d.category,
          uploaded_at: d.uploadedAt, size: d.size, version: d.version, uri: d.uri,
        }).then(({ error }: { error: any }) => {
          if (error) {
            dispatch({ type: 'DELETE_DOCUMENT', payload: d.id });
            Alert.alert('Erreur de sauvegarde', "Le document n'a pas pu être enregistré sur le serveur.");
          }
        });
      }
    },

    deleteDocument: (id) => {
      const previous = stateRef.current.documents.find(d => d.id === id);
      dispatch({ type: 'DELETE_DOCUMENT', payload: id });
      if (isSupabaseConfigured) {
        supabase.from('documents').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'ADD_DOCUMENT', payload: previous });
            Alert.alert('Erreur de suppression', "Le document n'a pas pu être supprimé.");
          }
        });
      }
    },

    addCustomChannel,
    removeCustomChannel,
    addGroupChannel,
    removeGroupChannel,
    renameChannel,
    addChannelMember,
    removeChannelMember,
    pinChannel,
    unpinChannel,
    maxPinnedChannels: MAX_PINNED,
    getOrCreateDMChannel,

    addVisite: (v) => {
      dispatch({ type: 'ADD_VISITE', payload: v });
      persistMockVisites([v, ...stateRef.current.visites]);
      if (isSupabaseConfigured) {
        supabase.from('visites').insert(fromVisite(v)).then(({ error }: { error: any }) => {
          if (error) console.warn('Erreur sauvegarde visite:', error.message);
        });
      }
    },
    updateVisite: (v) => {
      const previous = stateRef.current.visites.find(x => x.id === v.id);
      dispatch({ type: 'UPDATE_VISITE', payload: v });
      persistMockVisites(stateRef.current.visites.map(x => x.id === v.id ? v : x));
      if (isSupabaseConfigured) {
        const { id, ...fields } = fromVisite(v);
        supabase.from('visites').update(fields).eq('id', v.id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_VISITE', payload: previous });
            console.warn('Erreur mise à jour visite:', error.message);
          }
        });
      }
    },
    deleteVisite: (id) => {
      const previous = stateRef.current.visites.find(v => v.id === id);
      dispatch({ type: 'DELETE_VISITE', payload: id });
      persistMockVisites(stateRef.current.visites.filter(v => v.id !== id));
      if (isSupabaseConfigured) {
        supabase.from('visites').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'ADD_VISITE', payload: previous });
            console.warn('Erreur suppression visite:', error.message);
          }
        });
      }
    },
    linkReserveToVisite: (reserveId, visiteId) => {
      const visite = stateRef.current.visites.find(v => v.id === visiteId);
      if (!visite) return;
      if (visite.reserveIds.includes(reserveId)) return;
      const updated = { ...visite, reserveIds: [...visite.reserveIds, reserveId] };
      dispatch({ type: 'UPDATE_VISITE', payload: updated });
      persistMockVisites(stateRef.current.visites.map(x => x.id === visiteId ? updated : x));
      if (isSupabaseConfigured) {
        supabase.from('visites').update({ reserve_ids: updated.reserveIds }).eq('id', visiteId).then(({ error }: { error: any }) => {
          if (error) console.warn('Erreur liaison réserve/visite:', error.message);
        });
      }
    },

    addLot: (l) => {
      dispatch({ type: 'ADD_LOT', payload: l });
      persistMockLots([...stateRef.current.lots, l]);
      if (isSupabaseConfigured) {
        supabase.from('lots').insert(fromLot(l)).then(({ error }: { error: any }) => {
          if (error) console.warn('Erreur sauvegarde lot:', error.message);
        });
      }
    },
    updateLot: (l) => {
      const previous = stateRef.current.lots.find(x => x.id === l.id);
      dispatch({ type: 'UPDATE_LOT', payload: l });
      persistMockLots(stateRef.current.lots.map(x => x.id === l.id ? l : x));
      if (isSupabaseConfigured) {
        const { id, ...fields } = fromLot(l);
        supabase.from('lots').update(fields).eq('id', l.id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_LOT', payload: previous });
            console.warn('Erreur mise à jour lot:', error.message);
          }
        });
      }
    },
    deleteLot: (id) => {
      const previous = stateRef.current.lots.find(l => l.id === id);
      dispatch({ type: 'DELETE_LOT', payload: id });
      persistMockLots(stateRef.current.lots.filter(l => l.id !== id));
      if (isSupabaseConfigured) {
        supabase.from('lots').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'ADD_LOT', payload: previous });
            console.warn('Erreur suppression lot:', error.message);
          }
        });
      }
    },

    batchUpdateReserves: (ids, updates, author) => {
      const actualAuthor = author ?? currentUserNameRef.current ?? 'Système';
      const statusLabels: Record<string, string> = {
        open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
        verification: 'Vérification', closed: 'Clôturé',
      };
      const now = new Date().toISOString().slice(0, 10);
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
        if (updates.company && updates.company !== reserve.company) {
          historyEntries.push({
            id: genId(), action: 'Entreprise modifiée (lot)', author: actualAuthor, createdAt: now,
            oldValue: reserve.company, newValue: updates.company,
          });
        }
        const isClosing = updates.status === 'closed' && reserve.status !== 'closed';
        const r: Reserve = {
          ...reserve,
          ...updates,
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
              status: r.status, company: r.company, deadline: r.deadline,
              priority: r.priority, history: r.history,
              closed_at: r.closedAt ?? null, closed_by: r.closedBy ?? null,
            }).eq('id', r.id)
          )
        ).then(results => {
          const failed = results.some((res: any) => res.error);
          if (failed && !hasError) {
            hasError = true;
            dispatch({ type: 'BATCH_UPDATE_RESERVES', payload: previousReserves });
            Alert.alert('Erreur de sauvegarde', "Certaines réserves n'ont pas pu être mises à jour. Les modifications ont été annulées.");
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
      const revNum = (parent.revisionNumber ?? 1) + 1;
      const revCode = `R${String(revNum).padStart(2, '0')}`;
      const updatedParent: SitePlan = { ...parent, isLatestRevision: false };
      const versionedNew: SitePlan = {
        ...newPlan,
        parentPlanId,
        revisionNumber: revNum,
        revisionCode: revCode,
        isLatestRevision: true,
      };
      dispatch({ type: 'UPDATE_SITE_PLAN', payload: updatedParent });
      dispatch({ type: 'ADD_SITE_PLAN', payload: versionedNew });
      const updatedPlans = allPlans.map(p => p.id === parentPlanId ? updatedParent : p).concat([versionedNew]);
      persistMockSitePlans(updatedPlans);
    },

    migrateReservesToPlan: (fromPlanId, toPlanId) => {
      const toMigrate = stateRef.current.reserves.filter(
        r => r.planId === fromPlanId && r.status !== 'closed'
      );
      if (toMigrate.length === 0) return 0;
      const migrated = toMigrate.map(r => ({ ...r, planId: toPlanId }));
      dispatch({ type: 'BATCH_UPDATE_RESERVES', payload: migrated });
      const allUpdated = stateRef.current.reserves.map(r => {
        const m = migrated.find(x => x.id === r.id);
        return m ?? r;
      });
      persistMockReserves(allUpdated);
      return migrated.length;
    },

    addOpr: (o) => {
      dispatch({ type: 'ADD_OPR', payload: o });
      persistMockOprs([o, ...stateRef.current.oprs]);
      if (isSupabaseConfigured) {
        supabase.from('oprs').insert(fromOpr(o)).then(({ error }: { error: any }) => {
          if (error) console.warn('Erreur sauvegarde OPR:', error.message);
        });
      }
    },
    updateOpr: (o) => {
      const previous = stateRef.current.oprs.find(x => x.id === o.id);
      dispatch({ type: 'UPDATE_OPR', payload: o });
      persistMockOprs(stateRef.current.oprs.map(x => x.id === o.id ? o : x));
      if (isSupabaseConfigured) {
        const { id, ...fields } = fromOpr(o);
        supabase.from('oprs').update(fields).eq('id', o.id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'UPDATE_OPR', payload: previous });
            console.warn('Erreur mise à jour OPR:', error.message);
          }
        });
      }
    },
    deleteOpr: (id) => {
      const previous = stateRef.current.oprs.find(o => o.id === id);
      dispatch({ type: 'DELETE_OPR', payload: id });
      persistMockOprs(stateRef.current.oprs.filter(o => o.id !== id));
      if (isSupabaseConfigured) {
        supabase.from('oprs').delete().eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            if (previous) dispatch({ type: 'ADD_OPR', payload: previous });
            console.warn('Erreur suppression OPR:', error.message);
          }
        });
      }
    },

    activeChantier: state.chantiers.find(c => c.id === state.activeChantierId) ?? null,

    addChantier: (c: Chantier, plans: SitePlan[]) => {
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
    },

    updateChantier: (c: Chantier) => {
      dispatch({ type: 'UPDATE_CHANTIER', payload: c });
      const updated = stateRef.current.chantiers.map(ch => ch.id === c.id ? c : ch);
      persistMockChantiers(updated);
    },

    deleteChantier: (id: string) => {
      dispatch({ type: 'DELETE_CHANTIER', payload: id });
      const newChantiers = stateRef.current.chantiers.filter(c => c.id !== id);
      const newSitePlans = stateRef.current.sitePlans.filter(p => p.chantierId !== id);
      const newReserves = stateRef.current.reserves.filter(r => r.chantierId !== id);
      const newTasks = stateRef.current.tasks.filter(t => t.chantierId !== id);
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
    },

    setActiveChantier: (id: string) => {
      dispatch({ type: 'SET_ACTIVE_CHANTIER', payload: id });
      AsyncStorage.setItem(ACTIVE_CHANTIER_KEY, id).catch(() => {});
    },

    addSitePlan: (p: SitePlan) => {
      dispatch({ type: 'ADD_SITE_PLAN', payload: p });
      const updated = [...stateRef.current.sitePlans, p];
      persistMockSitePlans(updated);
    },

    updateSitePlan: (p: SitePlan) => {
      dispatch({ type: 'UPDATE_SITE_PLAN', payload: p });
      const updated = stateRef.current.sitePlans.map(sp => sp.id === p.id ? p : sp);
      persistMockSitePlans(updated);
    },

    deleteSitePlan: (id: string) => {
      dispatch({ type: 'DELETE_SITE_PLAN', payload: id });
      const updated = stateRef.current.sitePlans.filter(p => p.id !== id);
      persistMockSitePlans(updated);
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
