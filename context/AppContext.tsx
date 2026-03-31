import React, { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Reserve, Company, Task, Document, Photo, Message, Channel, Profile, Comment, ReserveStatus, ReservePriority, TaskStatus } from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { initStorageBuckets } from '@/lib/storage';
import { C } from '@/constants/colors';
import { genId } from '@/lib/utils';

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
const MOCK_PHOTOS_KEY = 'buildtrack_mock_photos_v2';
const MOCK_MESSAGES_KEY = 'buildtrack_mock_messages_v1';
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
}

type Action =
  | { type: 'INIT'; payload: Omit<AppState, 'isLoading' | 'lastReadByChannel' | 'customChannels' | 'groupChannels' | 'pinnedChannelIds' | 'channelMembersOverride'> }
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
  | { type: 'SET_CHANNEL_MEMBERS_OVERRIDE'; payload: Record<string, string[]> };

function toReserve(row: any): Reserve {
  return {
    id: row.id, title: row.title, description: row.description, building: row.building,
    zone: row.zone, level: row.level, company: row.company, priority: row.priority as ReservePriority,
    status: row.status as ReserveStatus, createdAt: row.created_at, deadline: row.deadline,
    comments: row.comments ?? [], history: row.history ?? [],
    planX: row.plan_x, planY: row.plan_y, photoUri: row.photo_uri ?? undefined,
    closedAt: row.closed_at ?? undefined, closedBy: row.closed_by ?? undefined,
  };
}

function toCompany(row: any): Company {
  return {
    id: row.id, name: row.name, shortName: row.short_name, color: row.color,
    plannedWorkers: row.planned_workers, actualWorkers: row.actual_workers,
    hoursWorked: row.hours_worked, zone: row.zone, contact: row.contact,
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
        isLoading: false,
      };

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

    default:
      return state;
  }
}

interface AppContextValue extends AppState {
  channels: Channel[];
  unreadByChannel: Record<string, number>;
  notification: { msg: Message; channelName: string; channelColor: string; channelIcon: string } | null;
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
}

const AppContext = createContext<AppContextValue | null>(null);

const MOCK_TODAY = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const MOCK_COMPANIES: Company[] = [
  { id: 'co1', name: 'Maçonnerie Dubois', shortName: 'Dubois', color: '#3B82F6', plannedWorkers: 8, actualWorkers: 6, hoursWorked: 320, zone: 'Zone Nord', contact: 'M. Dubois' },
  { id: 'co2', name: 'Plomberie Martin', shortName: 'Martin', color: '#10B981', plannedWorkers: 4, actualWorkers: 4, hoursWorked: 180, zone: 'Zone Sud', contact: 'Mme Martin' },
  { id: 'co3', name: 'Électricité Leroy', shortName: 'Leroy', color: '#F59E0B', plannedWorkers: 5, actualWorkers: 3, hoursWorked: 210, zone: 'Zone Est', contact: 'M. Leroy' },
  { id: 'co4', name: 'Menuiserie Petit', shortName: 'Petit', color: '#8B5CF6', plannedWorkers: 3, actualWorkers: 3, hoursWorked: 140, zone: 'Zone Ouest', contact: 'M. Petit' },
];

const MOCK_RESERVES: Reserve[] = [
  { id: 'RSV-001', title: 'Fissure mur porteur RDC', description: 'Fissure horizontale de 2 mm sur le mur porteur nord, entre les axes B3 et B4.', building: 'A', zone: 'Zone Nord', level: 'RDC', company: 'Maçonnerie Dubois', priority: 'critical', status: 'open', createdAt: '2026-03-15', deadline: '25/03/2026', comments: [], history: [{ id: 'h1', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-15' }], planX: 20, planY: 30 },
  { id: 'RSV-002', title: 'Fuite canalisation sous-sol', description: 'Fuite eau froide au niveau du coude DN50, local technique.', building: 'B', zone: 'Zone Sud', level: 'Sous-sol', company: 'Plomberie Martin', priority: 'high', status: 'in_progress', createdAt: '2026-03-18', deadline: '22/03/2026', comments: [{ id: 'c1', author: 'Marie Martin', content: 'Intervention prévue demain matin.', createdAt: '2026-03-19' }], history: [{ id: 'h2', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-18' }, { id: 'h3', action: 'Statut modifié', author: 'Jean Dupont', createdAt: '2026-03-19', oldValue: 'Ouvert', newValue: 'En cours' }], planX: 55, planY: 70 },
  { id: 'RSV-003', title: 'Défaut prise électrique R+1', description: "Prise 16A non fonctionnelle chambre 12, vérification du circuit F7.", building: 'A', zone: 'Zone Est', level: 'R+1', company: 'Électricité Leroy', priority: 'medium', status: 'verification', createdAt: '2026-03-10', deadline: '30/03/2026', comments: [], history: [{ id: 'h4', action: 'Réserve créée', author: 'Admin Système', createdAt: '2026-03-10' }], planX: 75, planY: 45 },
  { id: 'RSV-004', title: 'Porte intérieure coincée', description: "Porte chambre 8 ferme mal, gêne au passage. Seuil à reprendre.", building: 'B', zone: 'Zone Ouest', level: 'R+2', company: 'Menuiserie Petit', priority: 'low', status: 'closed', createdAt: '2026-03-05', deadline: '15/03/2026', comments: [], history: [{ id: 'h5', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-05' }, { id: 'h6', action: 'Statut modifié', author: 'Marie Martin', createdAt: '2026-03-14', oldValue: 'En cours', newValue: 'Clôturé' }], planX: 30, planY: 60 },
  { id: 'RSV-005', title: 'Finition peinture escalier', description: "Reprise peinture nécessaire sur la cage d'escalier, côté palier R+1.", building: 'C', zone: 'Zone Centre', level: 'R+1', company: 'Maçonnerie Dubois', priority: 'low', status: 'waiting', createdAt: '2026-03-20', deadline: '—', comments: [], history: [{ id: 'h7', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-20' }], planX: 50, planY: 50 },
  { id: 'RSV-006', title: 'Infiltration toiture bât. C', description: "Trace d'humidité au plafond R+3, infiltration possible au niveau de l'acrotère.", building: 'C', zone: 'Zone Nord', level: 'R+3', company: 'Maçonnerie Dubois', priority: 'high', status: 'open', createdAt: '2026-03-22', deadline: '01/04/2026', comments: [], history: [{ id: 'h8', action: 'Réserve créée', author: 'Admin Système', createdAt: '2026-03-22' }], planX: 65, planY: 20 },
  { id: 'RSV-007', title: 'Câblage réseau salle serveur', description: 'Câbles réseau non étiquetés, brassage à revoir selon plan informatique.', building: 'A', zone: 'Zone Centre', level: 'Sous-sol', company: 'Électricité Leroy', priority: 'medium', status: 'in_progress', createdAt: '2026-03-25', deadline: '05/04/2026', comments: [], history: [{ id: 'h9', action: 'Réserve créée', author: 'Jean Dupont', createdAt: '2026-03-25' }], planX: 40, planY: 80 },
  { id: 'RSV-008', title: 'Carrelage fissuré salle de bain', description: 'Carrelage salle de bain appt 14, fissure diagonale 15 cm, risque éclat.', building: 'B', zone: 'Zone Est', level: 'R+2', company: 'Maçonnerie Dubois', priority: 'medium', status: 'open', createdAt: '2026-03-28', deadline: '10/04/2026', comments: [], history: [{ id: 'h10', action: 'Réserve créée', author: 'Marie Martin', createdAt: '2026-03-28' }], planX: 80, planY: 35 },
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
  { id: 'ph1', comment: 'Fissure mur nord RSV-001', location: 'Bât. A - RDC', takenAt: '2026-03-15', takenBy: 'Jean Dupont', colorCode: '#EF4444' },
  { id: 'ph2', comment: 'État avancement dalle béton', location: 'Bât. A - RDC', takenAt: '2026-03-10', takenBy: 'Admin Système', colorCode: '#10B981' },
  { id: 'ph3', comment: 'Salle serveur — câblage réseau', location: 'Bât. A - Sous-sol', takenAt: '2026-03-25', takenBy: 'Jean Dupont', colorCode: '#F59E0B' },
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    reserves: [], companies: [], tasks: [],
    documents: [], photos: [], messages: [],
    lastReadByChannel: {}, isLoading: true,
    profiles: [], customChannels: [], groupChannels: [], pinnedChannelIds: [],
    channelMembersOverride: {},
  });

  const [notification, setNotification] = useState<{ msg: Message; channelName: string; channelColor: string; channelIcon: string } | null>(null);

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
    try {
      const sr = await AsyncStorage.getItem(MOCK_RESERVES_KEY);
      if (sr) reserves = JSON.parse(sr);
    } catch {}
    try {
      const st = await AsyncStorage.getItem(MOCK_TASKS_KEY);
      if (st) tasks = JSON.parse(st);
    } catch {}
    try {
      const sp = await AsyncStorage.getItem(MOCK_PHOTOS_KEY);
      if (sp) photos = JSON.parse(sp);
    } catch {}
    try {
      const sm = await AsyncStorage.getItem(MOCK_MESSAGES_KEY);
      if (sm) messages = JSON.parse(sm);
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
        supabase.from('profiles').select('id, name, role, email'),
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
          messages: (messages ?? []).map(r => toMessage(r, userName)),
          profiles: (profilesData ?? []).map((p: any) => ({ id: p.id, name: p.name, role: p.role, email: p.email })),
        },
      });
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        loadAll();
      } else if (event === 'SIGNED_OUT') {
        currentUserNameRef.current = '';
        dispatch({ type: 'INIT', payload: { reserves: [], companies: [], tasks: [], documents: [], photos: [], messages: [], profiles: [] } });
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) loadAll();
      else dispatch({ type: 'SET_LOADING', payload: false });
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const globalSub = supabase
      .channel('global-messages-v2')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const userName = currentUserNameRef.current;
        dispatch({ type: 'UPDATE_MESSAGE', payload: toMessage(payload.new, userName) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
        dispatch({ type: 'DELETE_MESSAGE', payload: payload.old.id });
      })
      .subscribe();

    return () => { supabase.removeChannel(globalSub); };
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
    if (!isSupabaseConfigured) {
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
  }

  const companyChannels: Channel[] = state.companies.map(co => ({
    id: `company-${co.id}`,
    name: co.name,
    description: `Canal de l'entreprise ${co.name}`,
    icon: 'people' as const,
    color: co.color,
    type: 'company' as const,
  }));

  const dmChannelIds = new Set(
    state.messages
      .filter(m => m.channelId.startsWith('dm-'))
      .map(m => m.channelId)
  );

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

  const stats = {
    total: state.reserves.length,
    open: state.reserves.filter(r => r.status === 'open').length,
    inProgress: state.reserves.filter(r => r.status === 'in_progress').length,
    waiting: state.reserves.filter(r => r.status === 'waiting').length,
    verification: state.reserves.filter(r => r.status === 'verification').length,
    closed: state.reserves.filter(r => r.status === 'closed').length,
    progress: state.reserves.length > 0
      ? Math.round((state.reserves.filter(r => r.status === 'closed').length / state.reserves.length) * 100) : 0,
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
    const updated = [...state.customChannels, newCh];
    saveCustomChannels(updated);
    return newCh;
  }

  function removeCustomChannel(id: string) {
    dispatch({ type: 'REMOVE_CUSTOM_CHANNEL', payload: id });
    const updated = state.customChannels.filter(c => c.id !== id);
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
    const updated = [...state.groupChannels, newCh];
    saveGroupChannels(updated);
    return newCh;
  }

  function removeGroupChannel(id: string) {
    dispatch({ type: 'REMOVE_GROUP_CHANNEL', payload: id });
    const updated = state.groupChannels.filter(c => c.id !== id);
    saveGroupChannels(updated);
  }

  function _updateAndPersistChannel(updatedCh: Channel) {
    dispatch({ type: 'UPDATE_CHANNEL', payload: updatedCh });
    if (updatedCh.type === 'custom') {
      saveCustomChannels(state.customChannels.map(c => c.id === updatedCh.id ? updatedCh : c));
    } else if (updatedCh.type === 'group') {
      saveGroupChannels(state.groupChannels.map(c => c.id === updatedCh.id ? updatedCh : c));
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
          supabase.from('companies').update({ name: newName }).eq('id', companyId).then(({ error }) => {
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
    if (state.pinnedChannelIds.includes(id)) return { success: false, reason: 'already_pinned' };
    if (state.pinnedChannelIds.length >= MAX_PINNED) return { success: false, reason: 'limit_reached' };
    const updated = [...state.pinnedChannelIds, id];
    dispatch({ type: 'SET_PINNED_CHANNELS', payload: updated });
    savePinnedChannels(updated);
    return { success: true };
  }

  function unpinChannel(id: string) {
    const updated = state.pinnedChannelIds.filter(pid => pid !== id);
    dispatch({ type: 'SET_PINNED_CHANNELS', payload: updated });
    savePinnedChannels(updated);
  }

  function getOrCreateDMChannel(otherName: string): Channel {
    const myName = currentUserNameRef.current;
    const chId = dmChannelId(myName, otherName);
    const existing = dmChannels.find(c => c.id === chId);
    if (existing) return existing;
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
    ...state, stats, unreadCount, channels, unreadByChannel, notification,
    setActiveChannelId,
    dismissNotification,

    addReserve: (r) => {
      if (isSupabaseConfigured) {
        supabase.from('reserves').insert({
          id: r.id, title: r.title, description: r.description, building: r.building,
          zone: r.zone, level: r.level, company: r.company, priority: r.priority,
          status: r.status, created_at: r.createdAt, deadline: r.deadline,
          comments: r.comments, history: r.history, plan_x: r.planX, plan_y: r.planY,
          photo_uri: r.photoUri,
        }).then(({ error }) => {
          if (error) console.warn('Erreur ajout réserve:', error.message);
        });
      } else {
        persistMockReserves([r, ...stateRef.current.reserves]);
      }
      dispatch({ type: 'ADD_RESERVE', payload: r });
    },

    updateReserve: (r) => {
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({
          title: r.title, description: r.description, building: r.building,
          zone: r.zone, level: r.level, company: r.company, priority: r.priority,
          status: r.status, deadline: r.deadline, comments: r.comments, history: r.history,
          plan_x: r.planX, plan_y: r.planY, photo_uri: r.photoUri,
        }).eq('id', r.id).then(({ error }) => {
          if (error) console.warn('Erreur mise à jour réserve:', error.message);
        });
      } else {
        persistMockReserves(stateRef.current.reserves.map(res => res.id === r.id ? r : res));
      }
      dispatch({ type: 'UPDATE_RESERVE', payload: r });
    },

    updateReserveFields: (r) => {
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({
          title: r.title, description: r.description, building: r.building,
          zone: r.zone, level: r.level, company: r.company, priority: r.priority,
          deadline: r.deadline, history: r.history, photo_uri: r.photoUri ?? null,
        }).eq('id', r.id).then(({ error }) => {
          if (error) console.warn('Erreur modification réserve:', error.message);
        });
      } else {
        persistMockReserves(stateRef.current.reserves.map(res => res.id === r.id ? r : res));
      }
      dispatch({ type: 'UPDATE_RESERVE_FIELDS', payload: r });
    },

    deleteReserve: (id) => {
      if (isSupabaseConfigured) {
        supabase.from('reserves').delete().eq('id', id).then(({ error }) => {
          if (error) console.warn('Erreur suppression réserve:', error.message);
        });
      } else {
        persistMockReserves(stateRef.current.reserves.filter(r => r.id !== id));
      }
      dispatch({ type: 'DELETE_RESERVE', payload: id });
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
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({
          status: updated.status, history: updated.history,
          closed_at: closedAt ?? null, closed_by: closedBy ?? null,
        }).eq('id', id).then(({ error }) => {
          if (error) console.warn('Erreur statut réserve:', error.message);
        });
      }
      dispatch({ type: 'UPDATE_RESERVE_STATUS', payload: updated });

      const company = stateRef.current.companies.find(c => c.name === reserve.company);
      if (company) {
        const notifChannelId = `company-${company.id}`;
        const ts = new Date().toLocaleString('fr-FR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }).replace(',', '');
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
        if (isSupabaseConfigured) {
          supabase.from('messages').insert(fromMessage(notifMsg)).then(({ error }) => {
            if (error) console.warn('Erreur notification canal:', error.message);
          });
        }
        dispatch({ type: 'ADD_MESSAGE', payload: notifMsg });
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
      if (isSupabaseConfigured) {
        supabase.from('reserves').update({ comments: updatedComments }).eq('id', reserveId).then(({ error }) => {
          if (error) console.warn('Erreur ajout commentaire:', error.message);
        });
      }
      dispatch({ type: 'ADD_COMMENT', payload: { reserveId, comment } });
    },

    addCompany: (c) => {
      if (isSupabaseConfigured) {
        supabase.from('companies').insert({
          id: c.id, name: c.name, short_name: c.shortName, color: c.color,
          planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
          hours_worked: c.hoursWorked, zone: c.zone, contact: c.contact,
        }).then(({ error }) => {
          if (error) console.warn('Erreur ajout entreprise:', error.message);
        });
      }
      dispatch({ type: 'ADD_COMPANY', payload: c });
    },

    updateCompanyWorkers: (id, actual) => {
      if (isSupabaseConfigured) {
        supabase.from('companies').update({ actual_workers: actual }).eq('id', id).then(({ error }) => {
          if (error) console.warn('Erreur mise à jour effectif:', error.message);
        });
      }
      dispatch({ type: 'UPDATE_COMPANY', payload: { id, actualWorkers: actual } });
    },

    updateCompanyFull: (c) => {
      if (isSupabaseConfigured) {
        supabase.from('companies').update({
          name: c.name, short_name: c.shortName, color: c.color,
          planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
          hours_worked: c.hoursWorked, zone: c.zone, contact: c.contact,
        }).eq('id', c.id).then(({ error }) => {
          if (error) console.warn('Erreur mise à jour entreprise:', error.message);
        });
      }
      dispatch({ type: 'UPDATE_COMPANY_FULL', payload: c });
    },

    deleteCompany: (id) => {
      if (isSupabaseConfigured) {
        supabase.from('companies').delete().eq('id', id).then(({ error }) => {
          if (error) console.warn('Erreur suppression entreprise:', error.message);
        });
      }
      dispatch({ type: 'DELETE_COMPANY', payload: id });
    },

    updateCompanyHours: (id, hours) => {
      if (isSupabaseConfigured) {
        supabase.from('companies').update({ hours_worked: hours }).eq('id', id).then(({ error }) => {
          if (error) console.warn('Erreur mise à jour heures:', error.message);
        });
      }
      dispatch({ type: 'UPDATE_COMPANY_HOURS', payload: { id, hours } });
    },

    reload: loadAll,
    setCurrentUser,

    addMessage: (channelId, content, options = {}, sender = 'Moi') => {
      const ts = new Date().toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).replace(',', '');
      const actualSender = currentUserNameRef.current || sender;
      const msg: Message = {
        id: genId(), channelId, sender: actualSender, content, timestamp: ts,
        type: 'message', read: true, isMe: true,
        reactions: {}, isPinned: false, readBy: [], mentions: options.mentions ?? [],
        replyToId: options.replyToId, replyToContent: options.replyToContent,
        replyToSender: options.replyToSender, attachmentUri: options.attachmentUri,
        reserveId: options.reserveId,
      };
      if (isSupabaseConfigured) {
        supabase.from('messages').insert(fromMessage(msg)).then(({ error }) => {
          if (error) console.warn('Erreur envoi message:', error.message);
        });
      }
      dispatch({ type: 'ADD_MESSAGE', payload: msg });
    },

    incomingMessage: (msg) => dispatch({ type: 'INCOMING_MESSAGE', payload: msg }),

    deleteMessage: (id) => {
      if (isSupabaseConfigured) {
        supabase.from('messages').delete().eq('id', id).then(({ error }) => {
          if (error) console.warn('Erreur suppression message:', error.message);
        });
      }
      dispatch({ type: 'DELETE_MESSAGE', payload: id });
    },

    updateMessage: (msg) => {
      if (isSupabaseConfigured) {
        supabase.from('messages').update(fromMessage(msg)).eq('id', msg.id).then(({ error }) => {
          if (error) console.warn('Erreur mise à jour message:', error.message);
        });
      }
      dispatch({ type: 'UPDATE_MESSAGE', payload: msg });
    },

    markMessagesRead: () => {
      dispatch({ type: 'MARK_MESSAGES_READ' });
    },

    setChannelRead: (channelId) => {
      const ts = new Date().toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).replace(',', '');
      dispatch({ type: 'SET_CHANNEL_READ', payload: { channelId, timestamp: ts } });
    },

    addTask: (t) => {
      if (isSupabaseConfigured) {
        supabase.from('tasks').insert({
          id: t.id, title: t.title, description: t.description, status: t.status,
          priority: t.priority, start_date: t.startDate ?? null, deadline: t.deadline,
          assignee: t.assignee, progress: t.progress, company: t.company,
          comments: t.comments ?? [], history: t.history ?? [],
        }).then(({ error }) => {
          if (error) console.warn('Erreur ajout tâche:', error.message);
        });
      } else {
        persistMockTasks([t, ...stateRef.current.tasks]);
      }
      dispatch({ type: 'ADD_TASK', payload: t });
    },

    updateTask: (t) => {
      if (isSupabaseConfigured) {
        supabase.from('tasks').update({
          title: t.title, description: t.description, status: t.status,
          priority: t.priority, start_date: t.startDate ?? null, deadline: t.deadline,
          assignee: t.assignee, progress: t.progress, company: t.company,
          comments: t.comments ?? [], history: t.history ?? [],
        }).eq('id', t.id).then(({ error }) => {
          if (error) console.warn('Erreur mise à jour tâche:', error.message);
        });
      } else {
        persistMockTasks(stateRef.current.tasks.map(tk => tk.id === t.id ? t : tk));
      }
      dispatch({ type: 'UPDATE_TASK', payload: t });
    },

    deleteTask: (id) => {
      if (isSupabaseConfigured) {
        supabase.from('tasks').delete().eq('id', id).then(({ error }) => {
          if (error) console.warn('Erreur suppression tâche:', error.message);
        });
      } else {
        persistMockTasks(stateRef.current.tasks.filter(t => t.id !== id));
      }
      dispatch({ type: 'DELETE_TASK', payload: id });
    },

    addTaskComment: (taskId, content, author = 'Utilisateur') => {
      const task = stateRef.current.tasks.find(t => t.id === taskId);
      if (!task) return;
      const actualAuthor = currentUserNameRef.current || author;
      const comment: Comment = {
        id: genId(), author: actualAuthor, content,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      dispatch({ type: 'ADD_TASK_COMMENT', payload: { taskId, comment } });
      if (!isSupabaseConfigured) {
        const updatedTasks = stateRef.current.tasks.map(t =>
          t.id === taskId ? { ...t, comments: [...(t.comments ?? []), comment] } : t
        );
        persistMockTasks(updatedTasks);
      }
    },

    addPhoto: (p) => {
      if (isSupabaseConfigured) {
        supabase.from('photos').insert({
          id: p.id, comment: p.comment, location: p.location,
          taken_at: p.takenAt, taken_by: p.takenBy, color_code: p.colorCode, uri: p.uri,
        }).then(({ error }) => {
          if (error) console.warn('Erreur ajout photo:', error.message);
        });
      } else {
        persistMockPhotos([p, ...stateRef.current.photos]);
      }
      dispatch({ type: 'ADD_PHOTO', payload: p });
    },

    deletePhoto: (id) => {
      if (isSupabaseConfigured) {
        supabase.from('photos').delete().eq('id', id).then(({ error }) => {
          if (error) console.warn('Erreur suppression photo:', error.message);
        });
      } else {
        persistMockPhotos(stateRef.current.photos.filter(p => p.id !== id));
      }
      dispatch({ type: 'DELETE_PHOTO', payload: id });
    },

    addDocument: (d) => {
      if (isSupabaseConfigured) {
        supabase.from('documents').insert({
          id: d.id, name: d.name, type: d.type, category: d.category,
          uploaded_at: d.uploadedAt, size: d.size, version: d.version, uri: d.uri,
        }).then(({ error }) => {
          if (error) console.warn('Erreur ajout document:', error.message);
        });
      }
      dispatch({ type: 'ADD_DOCUMENT', payload: d });
    },

    deleteDocument: (id) => {
      if (isSupabaseConfigured) {
        supabase.from('documents').delete().eq('id', id).then(({ error }) => {
          if (error) console.warn('Erreur suppression document:', error.message);
        });
      }
      dispatch({ type: 'DELETE_DOCUMENT', payload: id });
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
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
