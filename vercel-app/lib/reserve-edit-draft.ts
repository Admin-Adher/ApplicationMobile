import { canonicalReserveMediaRef } from '../../lib/reservePhotoIntegrity';

export type ReserveDraft = {
  kind: 'reserve' | 'observation';
  title: string;
  description: string;
  chantierId: string;
  building: string;
  buildingId: string;
  level: string;
  levelId: string;
  zone: string;
  priority: string;
  status: string;
  deadline: string;
  planId: string;
  planX?: number | null;
  planY?: number | null;
  lotId: string;
  visiteId: string;
  companies: string[];
  photos: WebPhotoDraft[];
};

export type WebPhotoAnnotationPoint = {
  x: number;
  y: number;
};

export type WebPhotoAnnotationTool = 'dot' | 'arrow' | 'rect' | 'text' | 'measure' | 'pen';

export type WebPhotoAnnotation = {
  id: string;
  x: number;
  y: number;
  color: string;
  label: string;
  tool?: WebPhotoAnnotationTool;
  x2?: number;
  y2?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  points?: WebPhotoAnnotationPoint[];
  strokeWidth?: number;
  // Convention commune web/mobile : 'image' = x, y et points sont des % du
  // rectangle réel de l'image (dimensions naturelles). Absent = annotation
  // legacy, % du conteneur d'origine (rendue sur toute la surface du cadre).
  coordSpace?: 'image';
};

export type WebPhotoDraft = {
  id: string;
  uri: string;
  name?: string;
  kind?: 'defect' | 'resolution';
  file?: File;
  existing?: boolean;
  annotations?: WebPhotoAnnotation[];
  // Objet photo JSONB d'origine (photos existantes) : sert de base au patch de
  // sauvegarde pour ne pas réécrire takenAt/takenBy ni perdre les champs non
  // re-mappés (label, gpsLat/gpsLon/gpsAccuracy...).
  original?: Record<string, any>;
};

const FORM_FIELDS = {
  kind: 'kind', title: 'title', description: 'description', chantierId: 'chantier_id',
  building: 'building', buildingId: 'building_id', level: 'level', levelId: 'level_id',
  zone: 'zone', priority: 'priority', deadline: 'deadline', planId: 'plan_id',
  planX: 'plan_x', planY: 'plan_y', lotId: 'lot_id', visiteId: 'visite_id', companies: 'companies',
} as const satisfies Partial<Record<keyof ReserveDraft, string>>;
const FIELD_ENTRIES = Object.entries(FORM_FIELDS) as [keyof typeof FORM_FIELDS, string][];

function equal(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function reserveEditPatch(base: ReserveDraft, draft: ReserveDraft, values: Record<string, unknown>) {
  return Object.fromEntries(FIELD_ENTRIES
    .filter(([field]) => !equal(base[field], draft[field]))
    .map(([, column]) => [column, values[column]]));
}

function photoKey(photo: WebPhotoDraft) {
  return photo.file ? 'file:' + photo.id : canonicalReserveMediaRef(photo.original?.uri ?? photo.uri) || 'photo:' + photo.id;
}

function photoEdits(photo: WebPhotoDraft) {
  return { kind: photo.kind, annotations: photo.annotations ?? [] };
}

export function reserveGalleryChanged(base: WebPhotoDraft[], draft: WebPhotoDraft[]) {
  const values = (photos: WebPhotoDraft[]) => photos.map(photo => [photoKey(photo), photoEdits(photo)]);
  return !equal(values(base), values(draft));
}

export function recoverReserveDraft(
  latest: ReserveDraft,
  patch: Record<string, unknown>,
  status?: string,
  gallery?: { saved: WebPhotoDraft[]; base?: WebPhotoDraft[]; removeIds: unknown[] },
): ReserveDraft {
  const fields = Object.fromEntries(FIELD_ENTRIES
    .filter(([, column]) => Object.hasOwn(patch, column))
    .map(([field, column]) => [
      field, patch[column] ?? (field === 'planX' || field === 'planY' ? null : ''),
    ]));

  if (!gallery) return { ...latest, ...fields, status: status ?? latest.status };
  const basePhotos = new Map(gallery.base?.map(photo => [photoKey(photo), photo]));
  const savedPhotos = new Map(gallery.saved.map(photo => [photoKey(photo), photo]));
  const latestIds = new Set(latest.photos.map(photo => photo.id));
  const photos = latest.photos.flatMap(photo => {
    const key = photoKey(photo);
    const base = basePhotos.get(key);
    const saved = savedPhotos.get(key);
    if (!saved && (base || (!gallery.base && gallery.removeIds.includes(photo.id)))) return [];
    if (!saved) return [photo];
    return [{
      ...photo,
      kind: !base || base.kind !== saved.kind ? saved.kind : photo.kind,
      annotations: !base || !equal(base.annotations ?? [], saved.annotations ?? [])
        ? saved.annotations : photo.annotations,
    }];
  });
  photos.push(...gallery.saved.filter(photo => photo.file && !latestIds.has(photo.id)));
  return { ...latest, ...fields, status: status ?? latest.status, photos };
}
