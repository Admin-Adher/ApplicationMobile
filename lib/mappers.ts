import {
  Reserve, Company, Task, Document, Photo, Message, Profile,
  Chantier, SitePlan, Visite, Lot, Opr,
  ReservePriority, ReserveStatus, TaskStatus, ChantierStatus,
  VisiteStatus, OprStatus,
} from '@/constants/types';

export function toReserve(row: any): Reserve {
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

export function toCompany(row: any): Company {
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

export function toTask(row: any): Task {
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

export function toDocument(row: any): Document {
  return {
    id: row.id, name: row.name, type: row.type, category: row.category,
    uploadedAt: row.uploaded_at, size: row.size, version: row.version, uri: row.uri ?? undefined,
  };
}

export function toPhoto(row: any): Photo {
  return {
    id: row.id, comment: row.comment, location: row.location,
    takenAt: row.taken_at, takenBy: row.taken_by, colorCode: row.color_code, uri: row.uri ?? undefined,
    reserveId: row.reserve_id ?? undefined,
  };
}

export function toVisite(row: any): Visite {
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

export function fromVisite(v: Visite, orgId?: string | null): Record<string, any> {
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

export function toLot(row: any): Lot {
  return {
    id: row.id, code: row.code, name: row.name, color: row.color,
    chantierId: row.chantier_id ?? undefined,
    companyId: row.company_id ?? undefined,
    cctpRef: row.cctp_ref ?? undefined,
    number: row.number ?? undefined,
  };
}

export function fromLot(l: Lot, orgId?: string | null): Record<string, any> {
  return {
    id: l.id, code: l.code, name: l.name, color: l.color,
    chantier_id: l.chantierId ?? null,
    company_id: l.companyId ?? null,
    cctp_ref: l.cctpRef ?? null,
    number: l.number ?? null,
    organization_id: orgId ?? null,
  };
}

export function toOpr(row: any): Opr {
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

export function fromOpr(o: Opr, orgId?: string | null): Record<string, any> {
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

export function toChantier(row: any): Chantier {
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

export function toSitePlan(row: any): SitePlan {
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

export function fromMessage(m: Message): Record<string, any> {
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

export function toProfile(row: any) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    roleLabel: row.role_label,
    email: row.email,
    organizationId: row.organization_id ?? undefined,
    companyId: row.company_id ?? undefined,
  };
}

export function reconcilePlanIds(
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
