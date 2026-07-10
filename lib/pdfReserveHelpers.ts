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

// ─────────────────────────────────────────────────────────────────────────────
// Colonne « Observation » façon rapport de pendientes : les photos de chaque
// réserve sont empilées verticalement DANS la cellule du tableau, sous le
// texte, au lieu d'une section « bande de photos » séparée après le tableau.
// ─────────────────────────────────────────────────────────────────────────────

export type ResolvedReservePdfPhoto = {
  /** Data-URL (ou URI de secours) déjà résolue pour l'embed PDF. */
  src: string;
  kind?: ReservePhoto['kind'];
};

/**
 * Pile verticale de miniatures pour la cellule « Observation » d'un tableau de
 * réserves (miniatures ~110 px, coins arrondis, bord discret — même rendu que
 * le rapport de référence). Les libellés sont passés déjà traduits pour que le
 * helper reste indépendant d'i18n. Retourne '' sans photo.
 */
export function buildReservePhotoStackHtml(
  photos: ResolvedReservePdfPhoto[],
  opts?: {
    /** Note « +N photo(s) non incluses », déjà traduite. */
    omittedNote?: string | null;
    /** Badge sous chaque photo de levée (ex. « Levée ») ; les constats n'ont pas de badge. */
    resolvedLabel?: string | null;
    /** Largeur des miniatures en px (défaut 110, comme le rapport de référence). */
    width?: number;
  },
): string {
  const width = opts?.width ?? 110;
  const imgs = (photos ?? []).filter(p => p?.src).map(p => {
    const badge = p.kind === 'resolution' && opts?.resolvedLabel
      ? `<div style="margin-top:1px;"><span style="display:inline-block;padding:0 6px;border-radius:7px;font-size:8px;font-weight:700;background:#ECFDF5;color:#059669;">${escapePdfHtml(opts.resolvedLabel)}</span></div>`
      : '';
    return `<div style="margin-top:6px;page-break-inside:avoid;">
      <img src="${escapePdfHtml(p.src)}" onerror="this.style.opacity='0.15'"
        style="width:${width}px;max-width:100%;height:auto;max-height:150px;object-fit:cover;display:block;border-radius:4px;border:1px solid #DDE4EE;background:#F9FAFB;" />${badge}
    </div>`;
  }).join('');

  if (!imgs) return '';

  const omitted = opts?.omittedNote
    ? `<div style="margin-top:4px;font-size:9px;color:#94A3B8;">${escapePdfHtml(opts.omittedNote)}</div>`
    : '';

  return `${imgs}${omitted}`;
}

/** Échappement HTML minimal local (évite un import circulaire avec pdfBase). */
function escapePdfHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
