export type ReserveStatus = 'open' | 'in_progress' | 'waiting' | 'verification' | 'closed';
export type ReservePriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'delayed';
export type DocumentType = 'plan' | 'report' | 'technical' | 'photo' | 'other';
export type UserRole = 'admin' | 'conducteur' | 'chef_equipe' | 'observateur';
export type IncidentSeverity = 'minor' | 'moderate' | 'major' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  roleLabel: string;
  email: string;
}

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
  planX?: number;
  planY?: number;
  photoUri?: string;
  linkedTaskId?: string;
  closedAt?: string;
  closedBy?: string;
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
  siret?: string;
  insurance?: string;
  qualifications?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: ReservePriority;
  startDate?: string;
  deadline: string;
  assignee: string;
  progress: number;
  company: string;
  reserveId?: string;
  comments?: Comment[];
  history?: HistoryEntry[];
}

export interface Document {
  id: string;
  name: string;
  type: DocumentType;
  category: string;
  uploadedAt: string;
  size: string;
  version: number;
  uri?: string;
}

export interface Photo {
  id: string;
  comment: string;
  location: string;
  takenAt: string;
  takenBy: string;
  colorCode: string;
  uri?: string;
}

export interface Message {
  id: string;
  channelId: string;
  sender: string;
  content: string;
  timestamp: string;
  type: 'message' | 'notification' | 'system';
  read: boolean;
  isMe: boolean;
  replyToId?: string;
  replyToContent?: string;
  replyToSender?: string;
  attachmentUri?: string;
  reactions: Record<string, string[]>;
  isPinned: boolean;
  readBy: string[];
  mentions: string[];
  reserveId?: string;
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  type: 'general' | 'building' | 'company' | 'custom' | 'dm' | 'group';
  dmParticipants?: string[];
  members?: string[];
  createdBy?: string;
}

export interface Profile {
  id: string;
  name: string;
  role: UserRole;
  roleLabel: string;
  email: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  location: string;
  building: string;
  reportedAt: string;
  reportedBy: string;
  status: IncidentStatus;
  witnesses: string;
  actions: string;
  closedAt?: string;
  closedBy?: string;
}

export interface AttendanceRecord {
  id: string;
  date: string;
  companyId: string;
  companyName: string;
  companyColor: string;
  workers: number;
  hoursWorked: number;
  savedBy: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  note?: string;
}

export interface Checklist {
  id: string;
  title: string;
  type: 'opr' | 'reception' | 'securite' | 'qualite' | 'custom';
  building: string;
  zone: string;
  level: string;
  createdAt: string;
  createdBy: string;
  completedAt?: string;
  items: ChecklistItem[];
  status: 'draft' | 'in_progress' | 'completed';
}

export interface MeetingReportAction {
  description: string;
  responsible: string;
  deadline: string;
  status: 'done' | 'pending';
}

export interface MeetingReport {
  id: string;
  subject: string;
  date: string;
  location: string;
  participants: string;
  agenda: string;
  notes: string;
  decisions: string[];
  actions: MeetingReportAction[];
  nextMeeting: string;
  redactedBy: string;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  author: string;
  weather: string;
  workerCount: number;
  workDone: string;
  materials: string;
  incidents: string;
  observations: string;
  visitors: string;
  createdAt: string;
}
