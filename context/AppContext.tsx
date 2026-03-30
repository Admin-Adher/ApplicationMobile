import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { Reserve, Company, Task, Document, Photo, Message, ReserveStatus, ReservePriority, TaskStatus } from '@/constants/types';
import { loadData, saveData, isInitialized, setInitialized } from '@/lib/storage';
import {
  MOCK_RESERVES, MOCK_COMPANIES, MOCK_TASKS,
  MOCK_DOCUMENTS, MOCK_PHOTOS, MOCK_MESSAGES,
} from '@/lib/mockData';

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

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT':
      return { ...action.payload, isLoading: false };

    case 'ADD_RESERVE':
      return { ...state, reserves: [action.payload, ...state.reserves] };

    case 'UPDATE_RESERVE':
      return {
        ...state,
        reserves: state.reserves.map(r => r.id === action.payload.id ? action.payload : r),
      };

    case 'UPDATE_RESERVE_STATUS': {
      const { id, status, author } = action.payload;
      const statusLabels: Record<ReserveStatus, string> = {
        open: 'Ouvert', in_progress: 'En cours',
        waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé',
      };
      return {
        ...state,
        reserves: state.reserves.map(r => {
          if (r.id !== id) return r;
          const oldLabel = statusLabels[r.status];
          const newLabel = statusLabels[status];
          return {
            ...r,
            status,
            history: [
              ...r.history,
              { id: genId(), action: 'Statut modifié', author, createdAt: new Date().toISOString().slice(0, 10), oldValue: oldLabel, newValue: newLabel },
            ],
          };
        }),
      };
    }

    case 'ADD_COMMENT': {
      const { reserveId, author, content } = action.payload;
      return {
        ...state,
        reserves: state.reserves.map(r => {
          if (r.id !== reserveId) return r;
          return {
            ...r,
            comments: [
              ...r.comments,
              { id: genId(), author, content, createdAt: new Date().toISOString().slice(0, 10) },
            ],
          };
        }),
      };
    }

    case 'UPDATE_COMPANY':
      return {
        ...state,
        companies: state.companies.map(c =>
          c.id === action.payload.id ? { ...c, actualWorkers: action.payload.actualWorkers } : c
        ),
      };

    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: genId(),
            sender: action.payload.sender,
            content: action.payload.content,
            timestamp: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ''),
            type: 'message',
            read: true,
            isMe: true,
          },
        ],
      };

    case 'MARK_MESSAGES_READ':
      return {
        ...state,
        messages: state.messages.map(m => ({ ...m, read: true })),
      };

    case 'ADD_TASK':
      return { ...state, tasks: [action.payload, ...state.tasks] };

    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map(t => t.id === action.payload.id ? action.payload : t),
      };

    case 'DELETE_TASK':
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.payload) };

    case 'ADD_PHOTO':
      return { ...state, photos: [action.payload, ...state.photos] };

    case 'ADD_DOCUMENT':
      return { ...state, documents: [action.payload, ...state.documents] };

    case 'DELETE_DOCUMENT':
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
    reserves: [],
    companies: [],
    tasks: [],
    documents: [],
    photos: [],
    messages: [],
    isLoading: true,
  });

  useEffect(() => {
    async function init() {
      const initialized = await isInitialized();
      if (!initialized) {
        await Promise.all([
          saveData('RESERVES', MOCK_RESERVES),
          saveData('COMPANIES', MOCK_COMPANIES),
          saveData('TASKS', MOCK_TASKS),
          saveData('DOCUMENTS', MOCK_DOCUMENTS),
          saveData('PHOTOS', MOCK_PHOTOS),
          saveData('MESSAGES', MOCK_MESSAGES),
        ]);
        await setInitialized();
        dispatch({
          type: 'INIT',
          payload: {
            reserves: MOCK_RESERVES,
            companies: MOCK_COMPANIES,
            tasks: MOCK_TASKS,
            documents: MOCK_DOCUMENTS,
            photos: MOCK_PHOTOS,
            messages: MOCK_MESSAGES,
          },
        });
      } else {
        const [reserves, companies, tasks, documents, photos, messages] = await Promise.all([
          loadData<Reserve[]>('RESERVES'),
          loadData<Company[]>('COMPANIES'),
          loadData<Task[]>('TASKS'),
          loadData<Document[]>('DOCUMENTS'),
          loadData<Photo[]>('PHOTOS'),
          loadData<Message[]>('MESSAGES'),
        ]);
        dispatch({
          type: 'INIT',
          payload: {
            reserves: reserves ?? MOCK_RESERVES,
            companies: companies ?? MOCK_COMPANIES,
            tasks: tasks ?? MOCK_TASKS,
            documents: documents ?? MOCK_DOCUMENTS,
            photos: photos ?? MOCK_PHOTOS,
            messages: messages ?? MOCK_MESSAGES,
          },
        });
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!state.isLoading) saveData('RESERVES', state.reserves);
  }, [state.reserves, state.isLoading]);

  useEffect(() => {
    if (!state.isLoading) saveData('COMPANIES', state.companies);
  }, [state.companies, state.isLoading]);

  useEffect(() => {
    if (!state.isLoading) saveData('MESSAGES', state.messages);
  }, [state.messages, state.isLoading]);

  useEffect(() => {
    if (!state.isLoading) saveData('TASKS', state.tasks);
  }, [state.tasks, state.isLoading]);

  useEffect(() => {
    if (!state.isLoading) saveData('PHOTOS', state.photos);
  }, [state.photos, state.isLoading]);

  useEffect(() => {
    if (!state.isLoading) saveData('DOCUMENTS', state.documents);
  }, [state.documents, state.isLoading]);

  const stats = {
    total: state.reserves.length,
    open: state.reserves.filter(r => r.status === 'open').length,
    inProgress: state.reserves.filter(r => r.status === 'in_progress').length,
    waiting: state.reserves.filter(r => r.status === 'waiting').length,
    verification: state.reserves.filter(r => r.status === 'verification').length,
    closed: state.reserves.filter(r => r.status === 'closed').length,
    progress: state.reserves.length > 0
      ? Math.round((state.reserves.filter(r => r.status === 'closed').length / state.reserves.length) * 100)
      : 0,
    totalWorkers: state.companies.reduce((sum, c) => sum + c.actualWorkers, 0),
    plannedWorkers: state.companies.reduce((sum, c) => sum + c.plannedWorkers, 0),
  };

  const unreadCount = state.messages.filter(m => !m.read && !m.isMe).length;

  const value: AppContextValue = {
    ...state,
    stats,
    unreadCount,
    addReserve: (r) => dispatch({ type: 'ADD_RESERVE', payload: r }),
    updateReserve: (r) => dispatch({ type: 'UPDATE_RESERVE', payload: r }),
    updateReserveStatus: (id, status, author = 'Conducteur de travaux') =>
      dispatch({ type: 'UPDATE_RESERVE_STATUS', payload: { id, status, author } }),
    addComment: (reserveId, content, author = 'Conducteur de travaux') =>
      dispatch({ type: 'ADD_COMMENT', payload: { reserveId, author, content } }),
    updateCompanyWorkers: (id, actual) =>
      dispatch({ type: 'UPDATE_COMPANY', payload: { id, actualWorkers: actual } }),
    addMessage: (content, sender = 'Moi') => dispatch({ type: 'ADD_MESSAGE', payload: { content, sender } }),
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
