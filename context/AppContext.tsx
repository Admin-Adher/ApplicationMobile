import React, { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Reserve, Company, Task, Document, Photo, Message, Channel, ReserveStatus, ReservePriority, TaskStatus } from '@/constants/types';
import { supabase } from '@/lib/supabase';
import { initStorageBuckets } from '@/lib/storage';
import { C } from '@/constants/colors';

export const STATIC_CHANNELS: Channel[] = [
  { id: 'general', name: 'Général', description: 'Canal principal du projet', icon: 'home', color: C.primary, type: 'general' },
  { id: 'building-a', name: 'Chantier A', description: 'Messages relatifs au Bâtiment A', icon: 'business', color: '#7C3AED', type: 'building' },
  { id: 'building-b', name: 'Chantier B', description: 'Messages relatifs au Bâtiment B', icon: 'business', color: '#059669', type: 'building' },
  { id: 'building-c', name: 'Chantier C', description: 'Messages relatifs au Bâtiment C', icon: 'business', color: '#D97706', type: 'building' },
];

interface AppState {
  reserves: Reserve[];
  companies: Company[];
  tasks: Task[];
  documents: Document[];
  photos: Photo[];
  messages: Message[];
  lastReadByChannel: Record<string, string>;
  isLoading: boolean;
}

type Action =
  | { type: 'INIT'; payload: Omit<AppState, 'isLoading' | 'lastReadByChannel'> }
  | { type: 'ADD_RESERVE'; payload: Reserve }
  | { type: 'UPDATE_RESERVE'; payload: Reserve }
  | { type: 'UPDATE_RESERVE_STATUS'; payload: { id: string; status: ReserveStatus; author: string } }
  | { type: 'ADD_COMMENT'; payload: { reserveId: string; author: string; content: string } }
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
  | { type: 'ADD_PHOTO'; payload: Photo }
  | { type: 'ADD_DOCUMENT'; payload: Document }
  | { type: 'DELETE_DOCUMENT'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean };

function genId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 6);
}

function toReserve(row: any): Reserve {
  return {
    id: row.id, title: row.title, description: row.description, building: row.building,
    zone: row.zone, level: row.level, company: row.company, priority: row.priority as ReservePriority,
    status: row.status as ReserveStatus, createdAt: row.created_at, deadline: row.deadline,
    comments: row.comments ?? [], history: row.history ?? [],
    planX: row.plan_x, planY: row.plan_y, photoUri: row.photo_uri ?? undefined,
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
    priority: row.priority as ReservePriority, deadline: row.deadline,
    assignee: row.assignee, progress: row.progress, company: row.company,
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

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT':
      return { ...action.payload, lastReadByChannel: state.lastReadByChannel, isLoading: false };

    case 'ADD_RESERVE':
      return { ...state, reserves: [action.payload, ...state.reserves] };

    case 'UPDATE_RESERVE':
      return { ...state, reserves: state.reserves.map(r => r.id === action.payload.id ? action.payload : r) };

    case 'UPDATE_RESERVE_STATUS': {
      const { id, status, author } = action.payload;
      const labels: Record<ReserveStatus, string> = {
        open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé',
      };
      return {
        ...state,
        reserves: state.reserves.map(r => {
          if (r.id !== id) return r;
          const updated = {
            ...r, status,
            history: [...r.history, { id: genId(), action: 'Statut modifié', author, createdAt: new Date().toISOString().slice(0, 10), oldValue: labels[r.status], newValue: labels[status] }],
          };
          supabase.from('reserves').update({ status: updated.status, history: updated.history }).eq('id', id);
          return updated;
        }),
      };
    }

    case 'ADD_COMMENT': {
      const { reserveId, author, content } = action.payload;
      return {
        ...state,
        reserves: state.reserves.map(r => {
          if (r.id !== reserveId) return r;
          const updated = { ...r, comments: [...r.comments, { id: genId(), author, content, createdAt: new Date().toISOString().slice(0, 10) }] };
          supabase.from('reserves').update({ comments: updated.comments }).eq('id', reserveId);
          return updated;
        }),
      };
    }

    case 'ADD_COMPANY': {
      const c = action.payload;
      supabase.from('companies').insert({ id: c.id, name: c.name, short_name: c.shortName, color: c.color, planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers, hours_worked: c.hoursWorked, zone: c.zone, contact: c.contact });
      return { ...state, companies: [...state.companies, c] };
    }

    case 'UPDATE_COMPANY':
      supabase.from('companies').update({ actual_workers: action.payload.actualWorkers }).eq('id', action.payload.id);
      return { ...state, companies: state.companies.map(c => c.id === action.payload.id ? { ...c, actualWorkers: action.payload.actualWorkers } : c) };

    case 'ADD_MESSAGE':
      supabase.from('messages').insert(fromMessage(action.payload)).catch(() => {});
      return { ...state, messages: [...state.messages, action.payload] };

    case 'INCOMING_MESSAGE':
      if (state.messages.find(m => m.id === action.payload.id)) return state;
      return { ...state, messages: [...state.messages, action.payload] };

    case 'DELETE_MESSAGE':
      supabase.from('messages').delete().eq('id', action.payload).catch(() => {});
      return { ...state, messages: state.messages.filter(m => m.id !== action.payload) };

    case 'UPDATE_MESSAGE':
      supabase.from('messages').update(fromMessage(action.payload)).eq('id', action.payload.id).catch(() => {});
      return { ...state, messages: state.messages.map(m => m.id === action.payload.id ? action.payload : m) };

    case 'MARK_MESSAGES_READ':
      supabase.from('messages').update({ read: true }).eq('is_me', false).catch(() => {});
      return { ...state, messages: state.messages.map(m => ({ ...m, read: true })) };

    case 'SET_CHANNEL_READ': {
      const newLastRead = { ...state.lastReadByChannel, [action.payload.channelId]: action.payload.timestamp };
      AsyncStorage.setItem('lastReadByChannel', JSON.stringify(newLastRead)).catch(() => {});
      return { ...state, lastReadByChannel: newLastRead };
    }

    case 'SET_LAST_READ':
      return { ...state, lastReadByChannel: action.payload };

    case 'ADD_TASK':
      supabase.from('tasks').insert({ id: action.payload.id, title: action.payload.title, description: action.payload.description, status: action.payload.status, priority: action.payload.priority, deadline: action.payload.deadline, assignee: action.payload.assignee, progress: action.payload.progress, company: action.payload.company });
      return { ...state, tasks: [action.payload, ...state.tasks] };

    case 'UPDATE_TASK':
      supabase.from('tasks').update({ title: action.payload.title, description: action.payload.description, status: action.payload.status, priority: action.payload.priority, deadline: action.payload.deadline, assignee: action.payload.assignee, progress: action.payload.progress, company: action.payload.company }).eq('id', action.payload.id);
      return { ...state, tasks: state.tasks.map(t => t.id === action.payload.id ? action.payload : t) };

    case 'DELETE_TASK':
      supabase.from('tasks').delete().eq('id', action.payload);
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.payload) };

    case 'ADD_PHOTO':
      supabase.from('photos').insert({ id: action.payload.id, comment: action.payload.comment, location: action.payload.location, taken_at: action.payload.takenAt, taken_by: action.payload.takenBy, color_code: action.payload.colorCode, uri: action.payload.uri });
      return { ...state, photos: [action.payload, ...state.photos] };

    case 'ADD_DOCUMENT':
      supabase.from('documents').insert({ id: action.payload.id, name: action.payload.name, type: action.payload.type, category: action.payload.category, uploaded_at: action.payload.uploadedAt, size: action.payload.size, version: action.payload.version, uri: action.payload.uri });
      return { ...state, documents: [action.payload, ...state.documents] };

    case 'DELETE_DOCUMENT':
      supabase.from('documents').delete().eq('id', action.payload);
      return { ...state, documents: state.documents.filter(d => d.id !== action.payload) };

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

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
  updateReserveStatus: (id: string, status: ReserveStatus, author?: string) => void;
  addComment: (reserveId: string, content: string, author?: string) => void;
  addCompany: (c: Company) => void;
  updateCompanyWorkers: (id: string, actual: number) => void;
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
  addPhoto: (p: Photo) => void;
  addDocument: (d: Document) => void;
  deleteDocument: (id: string) => void;
  unreadCount: number;
  stats: {
    total: number; open: number; inProgress: number;
    waiting: number; verification: number; closed: number;
    progress: number; totalWorkers: number; plannedWorkers: number;
  };
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    reserves: [], companies: [], tasks: [],
    documents: [], photos: [], messages: [],
    lastReadByChannel: {}, isLoading: true,
  });

  const [notification, setNotification] = useState<{ msg: Message; channelName: string; channelColor: string; channelIcon: string } | null>(null);

  const currentUserNameRef = useRef<string>('');
  const activeChannelIdRef = useRef<string | null>(null);
  const channelsRef = useRef<Channel[]>([...STATIC_CHANNELS]);

  function dismissNotification() {
    setNotification(null);
  }

  function setActiveChannelId(id: string | null) {
    activeChannelIdRef.current = id;
    if (id) {
      setNotification(prev => (prev?.msg.channelId === id ? null : prev));
    }
  }

  async function loadAll() {
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
        { data: reserves },
        { data: companies },
        { data: tasks },
        { data: documents },
        { data: photos },
        { data: messages },
      ] = await Promise.all([
        supabase.from('reserves').select('*').order('created_at', { ascending: false }),
        supabase.from('companies').select('*'),
        supabase.from('tasks').select('*'),
        supabase.from('documents').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('photos').select('*').order('taken_at', { ascending: false }),
        supabase.from('messages').select('*').order('timestamp', { ascending: true }),
      ]);

      const storedLastRead = await AsyncStorage.getItem('lastReadByChannel').catch(() => null);
      if (storedLastRead) {
        dispatch({ type: 'SET_LAST_READ', payload: JSON.parse(storedLastRead) });
      }

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
        },
      });
    } catch (err) {
      console.warn('Supabase load error:', err);
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        loadAll();
      } else if (event === 'SIGNED_OUT') {
        currentUserNameRef.current = '';
        dispatch({ type: 'INIT', payload: { reserves: [], companies: [], tasks: [], documents: [], photos: [], messages: [] } });
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) loadAll();
      else dispatch({ type: 'SET_LOADING', payload: false });
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const globalSub = supabase
      .channel('global-messages-v2')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const userName = currentUserNameRef.current;
        const msg = toMessage(payload.new, userName);
        if (!msg.isMe) {
          dispatch({ type: 'INCOMING_MESSAGE', payload: msg });
          if (activeChannelIdRef.current !== msg.channelId) {
            const ch = channelsRef.current.find(c => c.id === msg.channelId);
            setNotification({
              msg,
              channelName: ch?.name ?? msg.channelId,
              channelColor: ch?.color ?? C.primary,
              channelIcon: ch?.icon ?? 'chatbubbles',
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

  const channels: Channel[] = [
    ...STATIC_CHANNELS,
    ...state.companies.map(co => ({
      id: `company-${co.id}`,
      name: co.name,
      description: `Canal de l'entreprise ${co.name}`,
      icon: 'people' as const,
      color: co.color,
      type: 'company' as const,
    })),
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

  const value: AppContextValue = {
    ...state, stats, unreadCount, channels, unreadByChannel, notification,
    setActiveChannelId,
    dismissNotification,
    addReserve: (r) => {
      supabase.from('reserves').insert({
        id: r.id, title: r.title, description: r.description, building: r.building,
        zone: r.zone, level: r.level, company: r.company, priority: r.priority,
        status: r.status, created_at: r.createdAt, deadline: r.deadline,
        comments: r.comments, history: r.history, plan_x: r.planX, plan_y: r.planY,
        photo_uri: r.photoUri,
      });
      dispatch({ type: 'ADD_RESERVE', payload: r });
    },
    updateReserve: (r) => {
      supabase.from('reserves').update({
        title: r.title, description: r.description, building: r.building,
        zone: r.zone, level: r.level, company: r.company, priority: r.priority,
        status: r.status, deadline: r.deadline, comments: r.comments, history: r.history,
        plan_x: r.planX, plan_y: r.planY, photo_uri: r.photoUri,
      }).eq('id', r.id);
      dispatch({ type: 'UPDATE_RESERVE', payload: r });
    },
    updateReserveStatus: (id, status, author = 'Conducteur de travaux') =>
      dispatch({ type: 'UPDATE_RESERVE_STATUS', payload: { id, status, author } }),
    addComment: (reserveId, content, author = 'Conducteur de travaux') =>
      dispatch({ type: 'ADD_COMMENT', payload: { reserveId, author, content } }),
    addCompany: (c) => dispatch({ type: 'ADD_COMPANY', payload: c }),
    updateCompanyWorkers: (id, actual) =>
      dispatch({ type: 'UPDATE_COMPANY', payload: { id, actualWorkers: actual } }),
    addMessage: (channelId, content, options = {}, sender = 'Moi') => {
      const ts = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
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
    },
    incomingMessage: (msg) => dispatch({ type: 'INCOMING_MESSAGE', payload: msg }),
    deleteMessage: (id) => dispatch({ type: 'DELETE_MESSAGE', payload: id }),
    updateMessage: (msg) => dispatch({ type: 'UPDATE_MESSAGE', payload: msg }),
    markMessagesRead: () => dispatch({ type: 'MARK_MESSAGES_READ' }),
    setChannelRead: (channelId) => {
      const ts = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
      dispatch({ type: 'SET_CHANNEL_READ', payload: { channelId, timestamp: ts } });
    },
    addTask: (t) => dispatch({ type: 'ADD_TASK', payload: t }),
    updateTask: (t) => dispatch({ type: 'UPDATE_TASK', payload: t }),
    deleteTask: (id) => dispatch({ type: 'DELETE_TASK', payload: id }),
    addPhoto: (p) => dispatch({ type: 'ADD_PHOTO', payload: p }),
    addDocument: (d) => dispatch({ type: 'ADD_DOCUMENT', payload: d }),
    deleteDocument: (id) => dispatch({ type: 'DELETE_DOCUMENT', payload: id }),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
