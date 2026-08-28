export interface ReservePhotoLike {
  id?: unknown;
  uri?: unknown;
  reserve_id?: unknown;
  reserveId?: unknown;
  deleted_at?: unknown;
  [key: string]: unknown;
}

export interface ReserveCreateQueueOperationLike {
  table?: unknown;
  op?: unknown;
  terminal?: unknown;
  rpc?: { fn?: unknown; args?: Record<string, any> } | null;
  data?: Record<string, any> | null;
}

export interface ReservePhotoRowUpdate {
  row: ReservePhotoLike;
  patch: { uri: string };
}

export interface ReservePhotoRowReconciliation {
  staleRows: ReservePhotoLike[];
  rowsToUpdate: ReservePhotoRowUpdate[];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isLocalReserveMediaRef(value: unknown): boolean {
  const ref = stringValue(value).toLowerCase();
  return /^(file|content|ph|assets-library|blob|data):/.test(ref);
}

export function canonicalReserveMediaRef(value: unknown): string {
  const ref = stringValue(value);
  if (!ref) return '';
  if (/^btmedia:\/\//i.test(ref)) return ref.toLowerCase();
  try {
    const url = new URL(ref);
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}`;
  } catch {
    return ref.split('?')[0].split('#')[0];
  }
}

function reservePhotoId(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return stringValue((value as ReservePhotoLike).id);
}

function reserveIdFromPhoto(value: ReservePhotoLike): string {
  return stringValue(value.reserve_id ?? value.reserveId);
}

export function buildReservePhotoIndex<T extends ReservePhotoLike>(
  photos: readonly T[],
): Map<string, T[]> {
  const byReserve = new Map<string, T[]>();
  for (const photo of photos) {
    const reserveId = reserveIdFromPhoto(photo);
    if (!reserveId || photo.deleted_at) continue;
    const rows = byReserve.get(reserveId) ?? [];
    rows.push(photo);
    byReserve.set(reserveId, rows);
  }
  return byReserve;
}

export function hasPendingReserveCreateOperation(
  queue: readonly ReserveCreateQueueOperationLike[] | null | undefined,
  reserveId: string,
): boolean {
  const target = stringValue(reserveId);
  if (!target) return false;
  return (queue ?? []).some(operation => {
    if (operation.terminal === true) return false;
    if (operation.table !== 'reserves' || operation.op !== 'rpc') return false;
    if (operation.rpc?.fn !== 'create_reserve_with_photos') return false;
    const queuedReserve = operation.rpc.args?.p_reserve ?? operation.data;
    return stringValue(queuedReserve?.id) === target;
  });
}

/**
 * Reuses the server URI for a photo whose stable client ID already exists.
 *
 * A reserve can be edited while its local-first create operation is uploading.
 * The newer annotation snapshot still contains file:// URIs at that moment. If
 * those URIs are uploaded again, the same photo becomes a second storage object.
 * Rebase first, then upload only genuinely new photo IDs.
 */
export function rebasePendingReservePhotoPayload(
  payload: Record<string, any>,
  serverReserve: Record<string, any> | null | undefined,
): Record<string, any> {
  const incomingPhotos = Array.isArray(payload.photos) ? payload.photos : null;
  const serverPhotos = Array.isArray(serverReserve?.photos) ? serverReserve.photos : [];
  const serverById = new Map<string, any>();
  for (const photo of serverPhotos) {
    const id = reservePhotoId(photo);
    const uri = stringValue(photo?.uri);
    if (id && uri && !isLocalReserveMediaRef(uri)) serverById.set(id, photo);
  }

  let changed = false;
  const localToRemote = new Map<string, string>();
  const rebasedPhotos = incomingPhotos?.map((incoming: any) => {
    const id = reservePhotoId(incoming);
    const incomingUri = stringValue(incoming?.uri);
    const serverPhoto = id ? serverById.get(id) : null;
    const serverUri = stringValue(serverPhoto?.uri);
    if (!serverPhoto || !isLocalReserveMediaRef(incomingUri) || !serverUri) return incoming;
    changed = true;
    localToRemote.set(incomingUri, serverUri);
    return { ...serverPhoto, ...incoming, uri: serverUri };
  }) ?? incomingPhotos;

  let nextPhotoUri = payload.photo_uri;
  if (isLocalReserveMediaRef(nextPhotoUri)) {
    const rebased = localToRemote.get(stringValue(nextPhotoUri));
    const serverCover = stringValue(serverReserve?.photo_uri);
    const replacement = rebased || (!isLocalReserveMediaRef(serverCover) ? serverCover : '');
    if (replacement) {
      nextPhotoUri = replacement;
      changed = true;
    }
  }

  if (!changed) return payload;
  return {
    ...payload,
    ...(incomingPhotos ? { photos: rebasedPhotos } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'photo_uri') ? { photo_uri: nextPhotoUri } : {}),
  };
}

/**
 * Plans the table-row side of a reserve gallery update.
 *
 * JSONB `reserves.photos` and legacy `photos` rows are two projections of the
 * same gallery. A row absent from the desired gallery must be soft-deleted or it
 * will be merged back into the next web render. A row with the same stable ID
 * but a newer URI is updated instead of duplicated.
 */
export function planReservePhotoRowReconciliation(
  tablePhotos: readonly ReservePhotoLike[],
  reserveId: string,
  desiredPhotos: readonly ReservePhotoLike[],
): ReservePhotoRowReconciliation {
  const desiredById = new Map<string, ReservePhotoLike>();
  const desiredRefs = new Set<string>();
  for (const photo of desiredPhotos) {
    const id = reservePhotoId(photo);
    const ref = canonicalReserveMediaRef(photo.uri);
    if (id) desiredById.set(id, photo);
    if (ref) desiredRefs.add(ref);
  }

  const staleRows: ReservePhotoLike[] = [];
  const rowsToUpdate: ReservePhotoRowUpdate[] = [];
  for (const row of tablePhotos) {
    if (reserveIdFromPhoto(row) !== reserveId || row.deleted_at) continue;
    const id = reservePhotoId(row);
    const rowRef = canonicalReserveMediaRef(row.uri);
    const desiredByStableId = id ? desiredById.get(id) : null;
    if (desiredByStableId) {
      const desiredUri = stringValue(desiredByStableId.uri);
      if (desiredUri && canonicalReserveMediaRef(desiredUri) !== rowRef) {
        rowsToUpdate.push({ row, patch: { uri: desiredUri } });
      }
      continue;
    }
    if (rowRef && desiredRefs.has(rowRef)) continue;
    staleRows.push(row);
  }

  return { staleRows, rowsToUpdate };
}
