import { Photo, Reserve, ReservePhoto } from '@/constants/types';

type ReserveLocationSource = Pick<Reserve, 'building' | 'level' | 'zone'>;

const REMOTE_URI_RE = /^https?:\/\//i;

export function isRemotePdfAssetUri(uri?: string | null): boolean {
  return typeof uri === 'string' && REMOTE_URI_RE.test(uri);
}

export function formatReserveLocation(
  reserve: Partial<ReserveLocationSource>,
  emptyLabel = 'Non renseignée',
): string {
  const parts = [
    reserve.building ? `Bât. ${reserve.building}` : '',
    reserve.level ?? '',
    reserve.zone ?? '',
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : emptyLabel;
}

export function getReservePdfPhotos(reserve: Pick<Reserve, 'id' | 'createdAt' | 'photoUri' | 'photos'>): ReservePhoto[] {
  const photos: ReservePhoto[] = Array.isArray(reserve.photos) ? [...reserve.photos] : [];
  const seenUris = new Set(photos.map(photo => photo.uri).filter(Boolean));

  if (reserve.photoUri && !seenUris.has(reserve.photoUri)) {
    photos.push({
      id: `legacy-${reserve.id}`,
      uri: reserve.photoUri,
      kind: 'defect',
      takenAt: reserve.createdAt,
      takenBy: '',
    });
  }

  return photos;
}

export function buildReservePhotoIndex(photos: Photo[] = []): Map<string, ReservePhoto[]> {
  const map = new Map<string, ReservePhoto[]>();

  for (const photo of photos) {
    if (!photo.reserveId || !photo.uri) continue;
    const list = map.get(photo.reserveId) ?? [];
    list.push({
      id: photo.id,
      uri: photo.uri,
      kind: 'defect',
      takenAt: photo.takenAt,
      takenBy: photo.takenBy,
      gpsLat: photo.gpsLat,
      gpsLon: photo.gpsLon,
      gpsAccuracy: photo.gpsAccuracy,
    });
    map.set(photo.reserveId, list);
  }

  return map;
}

export function enrichReserveForPdf<T extends Reserve>(
  reserve: T,
  photosOrIndex: Photo[] | Map<string, ReservePhoto[]>,
): T {
  const index = Array.isArray(photosOrIndex)
    ? buildReservePhotoIndex(photosOrIndex)
    : photosOrIndex;
  const linkedPhotos = index.get(reserve.id) ?? [];
  const mergedPhotos = getReservePdfPhotos(reserve);
  const seenUris = new Set(mergedPhotos.map(photo => photo.uri).filter(Boolean));

  for (const photo of linkedPhotos) {
    if (!photo.uri || seenUris.has(photo.uri)) continue;
    seenUris.add(photo.uri);
    mergedPhotos.push(photo);
  }

  if (mergedPhotos.length === 0) return reserve;

  return {
    ...reserve,
    photos: mergedPhotos,
    photoUri: reserve.photoUri ?? mergedPhotos[0]?.uri,
  };
}

export function enrichReservesForPdf<T extends Reserve>(reserves: T[], photos: Photo[] = []): T[] {
  const index = buildReservePhotoIndex(photos);
  return reserves.map(reserve => enrichReserveForPdf(reserve, index));
}

export function getRemoteReservePhotosForPdf(
  reserve: Pick<Reserve, 'id' | 'createdAt' | 'photoUri' | 'photos'>,
  limit: number,
): {
  photos: Array<{ uri: string; kind?: ReservePhoto['kind'] }>;
  localOnlyCount: number;
  totalCount: number;
} {
  const allPhotos = getReservePdfPhotos(reserve);
  const remotePhotos = allPhotos
    .filter(photo => isRemotePdfAssetUri(photo.uri))
    .slice(0, limit)
    .map(photo => ({ uri: photo.uri, kind: photo.kind }));

  return {
    photos: remotePhotos,
    localOnlyCount: allPhotos.filter(photo => photo.uri && !isRemotePdfAssetUri(photo.uri)).length,
    totalCount: allPhotos.length,
  };
}

export function countLocalOnlyReservePhotos(reserves: Array<Pick<Reserve, 'id' | 'createdAt' | 'photoUri' | 'photos'>>): number {
  return reserves.reduce((total, reserve) => (
    total + getReservePdfPhotos(reserve).filter(photo => photo.uri && !isRemotePdfAssetUri(photo.uri)).length
  ), 0);
}
