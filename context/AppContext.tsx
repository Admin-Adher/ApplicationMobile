import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { Reserve, Company, Task, Document, Photo, Message, ReserveStatus, ReservePriority, TaskStatus } from '@/constants/types';
import { supabase } from '@/lib/supabase';

interface AppState {
  reserves: Reserve[];
  companies: Company[];
  tasks: Task[];
  documents: Document[];
  photos: Photo[];
  messages: Message[];
  isLoading: boolean;
}

type Action =
  | { type: 'INIT'; payload: Omit<AppState, 'isLoading'> }
  | { type: 'ADD_RESERVE'; payload: Reserve }
  | { type: 'UPDATE_RESERVE'; payload: Reserve }
  | { type: 'UPDATE_RESERVE_STATUS'; payload: { id: string; status: ReserveStatus; author: string } }
  | { type: 'ADD_COMMENT'; payload: { reserveId: string; author: string; content: string } }
  | { type: 'UPDATE_COMPANY'; payload: { id: string; actualWorkers: number } }
  | { type: 'ADD_MESSAGE'; payload: { content: string; sender: string } }
  | { type: 'MARK_MESSAGES_READ' }
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
    id: row.id,
    title: row.title,
    description: row.description,
    building: row.building,
    zone: row.zone,
    level: row.level,
    company: row.company,
    priority: row.priority as ReservePriority,
    status: row.status as ReserveStatus,
    createdAt: row.created_at,
    deadline: row.deadline,
    comments: row.comments ?? [],
    history: row.history ?? [],
    planX: row.plan_x,
    planY: row.plan_y,
    photoUri: row.photo_uri ?? undefined,
  };
}

function toCompany(row: any): Company {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    color: row.color,
    plannedWorkers: row.planned_workers,
    actualWorkers: row.actual_workers,
    hoursWorked: row.hours_worked,
    zone: row.zone,
    contact: row.contact,
  };
}

function toTask(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as ReservePriority,
    deadline: row.deadline,
    assignee: row.assignee,
    progress: row.progress,
    company: row.company,
  };
}

function toDocument(row: any): Document {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    category: row.category,
    uploadedAt: row.uploaded_at,
    size: row.size,
    version: row.version,
    uri: row.uri ?? undefined,
  };
}

function toPhoto(row: any): Photo {
  return {
    id: row.id,
    comment: row.comment,
    location: row.location,
    takenAt: row.taken_at,
    takenBy: row.taken_by,
    colorCode: row.color_code,
    uri: row.uri ?? undefined,
  };
}

function toMessage(row: any): Message {
  return {
    id: row.id,
    sender: row.sender,
    content: row.content,
    timestamp: row.timestamp,
    type: row.type,
    read: row.read,
    isMe: row.is_me,
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT':
      return { ...action.payload, isLoading: false };

    case 'ADD_RESERVE':
      return { ...state, reserves: [action.payload, ...state.reserves] };

    case 'UPDATE_RESERVE':
      return { ...state, reserves: state.reserves.map(r => r.id === action.payload.id ? action.payload : r) };

    case 'UPDATE_RESERVE_STATUS': {
      const { id, status, author } = action.payload;
      const labels: Record<ReserveStatus, string> = {
        open: 'Ouvert', in_progress: 'En cours',
        waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé',
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

    case 'UPDATE_COMPANY':
      supabase.from('companies').update({ actual_workers: action.payload.actualWorkers }).eq('id', action.payload.id);
      return { ...state, companies: state.companies.map(c => c.id === action.payload.id ? { ...c, actualWorkers: action.payload.actualWorkers } : c) };

    case 'ADD_MESSAGE': {
      const msg: Message = {
        id: genId(),
        sender: action.payload.sender,
        content: action.payload.content,
        timestamp: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ''),
        type: 'message',
        read: true,
        isMe: true,
      };
      supabase.from('messages').insert({ id: msg.id, sender: msg.sender, content: msg.content, timestamp: msg.timestamp, type: msg.type, read: msg.read, is_me: msg.isMe });
      return { ...state, messages: [...state.messages, msg] };
    }

    case 'MARK_MESSAGES_READ':
      supabase.from('messages').update({ read: true }).eq('is_me', false);
      return { ...state, messages: state.messages.map(m => ({ ...m, read: true })) };

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
  addReserve: (r: Reserve) => void;
  updateReserve: (r: Reserve) => void;
  updateReserveStatus: (id: string, status: ReserveStatus, author?: string) => void;
  addComment: (reserveId: string, content: string, author?: string) => void;
  updateCompanyWorkers: (id: string, actual: number) => void;
  addMessage: (content: string, sender?: string) => void;
  markMessagesRead: () => void;
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
    documents: [], photos: [], messages: [], isLoading: true,
  });

  useEffect(() => {
    async function init() {
      try {
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

        dispatch({
          type: 'INIT',
          payload: {
            reserves: (reserves ?? []).map(toReserve),
            companies: (companies ?? []).map(toCompany),
            tasks: (tasks ?? []).map(toTask),
            documents: (documents ?? []).map(toDocument),
            photos: (photos ?? []).map(toPhoto),
            messages: (messages ?? []).map(toMessage),
          },
        });
      } catch (err) {
        console.warn('Supabase init error:', err);
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }
    init();
  }, []);

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

  const unreadCount = state.messages.filter(m => !m.read && !m.isMe).length;

  const value: AppContextValue = {
    ...state, stats, unreadCount,
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
    updateCompanyWorkers: (id, actual) =>
      dispatch({ type: 'UPDATE_COMPANY', payload: { id, actualWorkers: actual } }),
    addMessage: (content, sender = 'Moi') =>
      dispatch({ type: 'ADD_MESSAGE', payload: { content, sender } }),
    markMessagesRead: () => dispatch({ type: 'MARK_MESSAGES_READ' }),
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
