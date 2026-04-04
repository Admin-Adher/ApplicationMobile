export type ReserveStatus = 'open' | 'in_progress' | 'waiting' | 'verification' | 'closed';
export type ReservePriority = 'low' | 'medium' | 'high' | 'critical';
export type ReserveKind = 'reserve' | 'observation';
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'delayed';
export type DocumentType = 'plan' | 'report' | 'technical' | 'photo' | 'other';
export type UserRole = 'super_admin' | 'admin' | 'conducteur' | 'chef_equipe' | 'observateur' | 'sous_traitant';
export type SubscriptionStatus = 'trial' | 'active' | 'suspended' | 'expired';
export type PlanName = 'Solo' | 'Équipe' | 'Groupe';
export type IncidentSeverity = 'minor' | 'moderate' | 'major' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved';
export type ChantierStatus = 'active' | 'completed' | 'paused';
export type VisiteStatus = 'planned' | 'in_progress' | 'completed';
export type OprStatus = 'draft' | 'in_progress' | 'signed';
export type AnnotationTool = 'dot' | 'arrow' | 'rect' | 'text' | 'measure';
export type PlanDrawingTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'cloud' | 'highlight';

export interface PlanDrawingPoint {
  x: number;
  y: number;
}

export interface PlanDrawing {
  id: string;
  tool: PlanDrawingTool;
  points: PlanDrawingPoint[];
  color: string;
  strokeWidth: number;
  text?: string;
  fontSize?: number;
  opacity?: number;
  page?: number;
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  roleLabel: string;
  email: string;
  organizationId?: string;
  companyId?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  name: PlanName;
  maxUsers: number;
  priceMonthly: number;
  features: string[];
}

export interface Subscription {
  id: string;
  organizationId: string;
  planId: string;
  status: SubscriptionStatus;
  startedAt: string;
  expiresAt?: string;
  trialEndsAt?: string;
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: UserRole;
  invitedBy: string;
  token: string;
  status: 'pending' | 'accepted' | 'expired';
  createdAt: string;
  expiresAt: string;
  companyId?: string;
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

export interface ChantierZone {
  id: string;
  name: string;
}

export interface ChantierLevel {
  id: string;
  name: string;
  zones: ChantierZone[];
}

export interface ChantierBuilding {
  id: string;
  name: string;
  levels: ChantierLevel[];
}

export interface Chantier {
  id: string;
  name: string;
  address?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  status: ChantierStatus;
  createdAt: string;
  createdBy: string;
  companyIds?: string[];
  buildings?: ChantierBuilding[];
}

export interface SitePlan {
  id: string;
  chantierId: string;
  name: string;
  building?: string;
  level?: string;
  buildingId?: string;
  levelId?: string;
  uri?: string;
  fileType?: 'pdf' | 'image' | 'dxf';
  dxfName?: string;
  uploadedAt: string;
  size?: string;
  revisionCode?: string;
  revisionNumber?: number;
  parentPlanId?: string;
  isLatestRevision?: boolean;
  revisionNote?: string;
  annotations?: PlanDrawing[];
  pdfPageCount?: number;
}

export interface Lot {
  id: string;
  code: string;
  name: string;
  color: string;
  chantierId?: string;
  companyId?: string;
  cctpRef?: string;
  number?: string;
}

export interface VisiteParticipant {
  id: string;
  name: string;
  company: string;
  role?: string;
  signature?: string;
  signedAt?: string;
}

export interface Visite {
  id: string;
  chantierId: string;
  title: string;
  date: string;
  conducteur: string;
  status: VisiteStatus;
  building?: string;
  level?: string;
  zone?: string;
  notes?: string;
  reserveIds: string[];
  createdAt: string;
  conducteurSignature?: string;
  entrepriseSignature?: string;
  signedAt?: string;
  entrepriseSignataire?: string;
  participants?: VisiteParticipant[];
}

export interface OprItem {
  id: string;
  lotId?: string;
  lotName: string;
  description: string;
  status: 'ok' | 'reserve' | 'non_applicable';
  reserveId?: string;
  note?: string;
  entreprise?: string;
  deadline?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface OprSignatory {
  id: string;
  name: string;
  role: string;
  email?: string;
  signature?: string;
  signedAt?: string;
  signed?: boolean;
}

export interface Opr {
  id: string;
  chantierId: string;
  title: string;
  date: string;
  building: string;
  level: string;
  zone?: string;
  conducteur: string;
  status: OprStatus;
  items: OprItem[];
  signedBy?: string;
  signedAt?: string;
  maireOuvrage?: string;
  conducteurSignature?: string;
  moSignature?: string;
  createdAt: string;
  visitContradictoire?: string;
  visitParticipants?: Array<{ id: string; name: string; company: string; present: boolean }>;
  signatories?: OprSignatory[];
  invitedEmails?: string[];
  sessionToken?: string;
}

export interface PhotoAnnotation {
  id: string;
  x: number;
  y: number;
  color: string;
  label: string;
  tool?: AnnotationTool;
  x2?: number;
  y2?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
}

export interface ReservePhoto {
  id: string;
  uri: string;
  label?: string;
  kind: 'defect' | 'resolution';
  takenAt: string;
  takenBy: string;
  annotations?: PhotoAnnotation[];
  gpsLat?: number;
  gpsLon?: number;
  gpsAccuracy?: number;
}

export interface Reserve {
  id: string;
  title: string;
  description: string;
  building: string;
  zone: string;
  level: string;
  companies?: string[];
  company?: string;
  responsableNom?: string;
  priority: ReservePriority;
  status: ReserveStatus;
  kind?: ReserveKind;
  lotId?: string;
  visiteId?: string;
  createdAt: string;
  deadline: string;
  comments: Comment[];
  history: HistoryEntry[];
  planX?: number;
  planY?: number;
  photoUri?: string;
  photoAnnotations?: PhotoAnnotation[];
  photos?: ReservePhoto[];
  linkedTaskId?: string;
  closedAt?: string;
  closedBy?: string;
  chantierId?: string;
  planId?: string;
  enterpriseSignature?: string;
  enterpriseSignataire?: string;
  enterpriseAcknowledgedAt?: string;
  companySignatures?: Record<string, { signature: string; signataire: string; signedAt: string }>;
  gpsLat?: number;
  gpsLon?: number;
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
  phone?: string;
  siret?: string;
  insurance?: string;
  qualifications?: string;
  lots?: string[];
  email?: string;
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
  chantierId?: string;
  createdAt?: string;
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
  reserveId?: string;
  gpsLat?: number;
  gpsLon?: number;
  gpsAccuracy?: number;
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
  organizationId?: string;
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
  photoUri?: string;
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
  id?: string;
  description: string;
  responsible: string;
  deadline: string;
  status: 'done' | 'pending';
  reserveId?: string;
}

export interface MeetingReport {
  id: string;
  number?: string;
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
  chantierName?: string;
}

export interface WeatherData {
  temperature: number;
  windspeed: number;
  weathercode: number;
  description: string;
  icon: string;
  humidity?: number;
  fetchedAt?: string;
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
  weatherTemp?: number;
  weatherWind?: number;
  weatherDescription?: string;
  weatherCode?: number;
}

export interface TimeEntry {
  id: string;
  date: string;
  companyId: string;
  companyName: string;
  companyColor: string;
  workerName: string;
  arrivalTime: string;
  departureTime?: string;
  notes?: string;
  recordedBy: string;
  taskId?: string;
  taskTitle?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export type RegDocType = 'ppsps' | 'dict' | 'doe' | 'plan_prevention' | 'declaration_prealable' | 'dpae' | 'autre';
export type RegDocStatus = 'valid' | 'expiring' | 'expired' | 'missing' | 'in_progress';

export interface RegulatoryDoc {
  id: string;
  type: RegDocType;
  title: string;
  company?: string;
  reference?: string;
  issueDate?: string;
  expiryDate?: string;
  status: RegDocStatus;
  notes?: string;
  uri?: string;
  createdAt: string;
  createdBy: string;
}

export interface BTPIntegration {
  id: string;
  name: string;
  type: 'google_drive' | 'autodesk' | 'dropbox' | 'procore' | 'generic';
  enabled: boolean;
  config?: Record<string, string>;
  lastSync?: string;
  provider?: string;
  description?: string;
  logoUri?: string;
  apiKey?: string;
  webhookUrl?: string;
}

export interface ReserveWeekStat {
  week: string;
  label: string;
  created: number;
  closed: number;
}

export interface CompanyClosureStat {
  companyName: string;
  color: string;
  total: number;
  closed: number;
  rate: number;
  overdue: number;
}
