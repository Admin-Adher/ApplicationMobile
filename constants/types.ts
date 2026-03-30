export type ReserveStatus = 'open' | 'in_progress' | 'waiting' | 'verification' | 'closed';
export type ReservePriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'delayed';
export type DocumentType = 'plan' | 'report' | 'technical' | 'photo' | 'other';

export interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  action: string;
  author: string;
  createdAt: string;
  oldValue?: string;
  newValue?: string;
}

export interface Reserve {
  id: string;
  title: string;
  description: string;
  building: string;
  zone: string;
  level: string;
  company: string;
  priority: ReservePriority;
  status: ReserveStatus;
  createdAt: string;
  deadline: string;
  comments: Comment[];
  history: HistoryEntry[];
  planX: number;
  planY: number;
}

export interface Company {
  id: string;
  name: string;
  shortName: string;
  color: string;
  plannedWorkers: number;
  actualWorkers: number;
  hoursWorked: number;
  zone: string;
  contact: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: ReservePriority;
  deadline: string;
  assignee: string;
  progress: number;
  company: string;
}

export interface Document {
  id: string;
  name: string;
  type: DocumentType;
  category: string;
  uploadedAt: string;
  size: string;
  version: number;
}

export interface Photo {
  id: string;
  comment: string;
  location: string;
  takenAt: string;
  takenBy: string;
  colorCode: string;
}

export interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  type: 'message' | 'notification' | 'system';
  read: boolean;
  isMe: boolean;
}
