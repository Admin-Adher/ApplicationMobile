import { Photo, PhotoAnnotation, Reserve, ReservePhoto } from '@/constants/types';

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
  photos: Array<{ uri: string; kind?: ReservePhoto['kind']; annotations?: PhotoAnnotation[] | null }>;
  localOnlyCount: number;
  totalCount: number;
} {
  const allPhotos = getReservePdfPhotos(reserve);
  const remotePhotos = allPhotos
    .filter(photo => isRemotePdfAssetUri(photo.uri))
    .slice(0, limit)
    // annotations incluses : elles voyagent jusqu'au générateur PDF serveur
    // (rapports envoyés par email) qui les rend en surimpression SVG.
    .map(photo => ({ uri: photo.uri, kind: photo.kind, annotations: photo.annotations }));

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
  /** Annotations dessinées sur la photo, rendues en surimpression dans le PDF. */
  annotations?: PhotoAnnotation[] | null;
};

/**
 * Calque d'annotations à superposer sur une photo de PDF. Valable quand la
 * boîte de l'<img> épouse l'image (width fixe + height:auto) : les positions
 * en % s'appliquent alors indifféremment aux annotations coordSpace 'image'
 * et aux annotations legacy (% du conteneur d'origine, rendues pleine boîte
 * partout ailleurs). Traits crayon en SVG (non-scaling-stroke), marqueurs en
 * <div> positionnés pour éviter la distorsion du viewBox étiré.
 */
export function buildPhotoAnnotationsOverlayHtml(annotations?: PhotoAnnotation[] | null): string {
  const list = (annotations ?? []).filter(a => a && typeof a.x === 'number' && typeof a.y === 'number');
  if (list.length === 0) return '';

  const rnd = (v: number) => Math.round(v * 100) / 100;
  const svgParts: string[] = [];
  const divParts: string[] = [];

  for (const a of list) {
    const color = escapePdfHtml(a.color || '#EF4444');
    if (a.tool === 'pen') {
      const pts = a.points?.length ? a.points : [{ x: a.x, y: a.y }];
      if (pts.length >= 2) {
        svgParts.push(`<polyline points="${pts.map(p => `${rnd(p.x)},${rnd(p.y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`);
      } else {
        divParts.push(`<div style="position:absolute;left:${rnd(pts[0].x)}%;top:${rnd(pts[0].y)}%;width:6px;height:6px;border-radius:3px;background:${color};transform:translate(-50%,-50%);"></div>`);
      }
      continue;
    }
    const x = rnd(a.x);
    const y = rnd(a.y);
    if (a.tool === 'text') {
      divParts.push(`<div style="position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-50%);max-width:75%;background:${color}CC;border:1px solid ${color};border-radius:4px;padding:1px 4px;color:${a.color === '#FFFFFF' ? '#000' : '#fff'};font-size:7px;font-weight:700;line-height:1.25;">${escapePdfHtml(a.label ?? '')}</div>`);
    } else if (a.tool === 'measure') {
      divParts.push(`<div style="position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-50%);background:${color}DD;border-radius:6px;padding:1px 4px;color:#fff;font-size:7px;font-weight:700;white-space:nowrap;">⟷ ${escapePdfHtml(a.label ?? '')}</div>`);
    } else if (a.tool === 'rect') {
      divParts.push(`<div style="position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-50%);width:18px;height:13px;border:2px solid ${color};border-radius:2px;"></div>`);
    } else {
      const sym = a.tool === 'arrow' ? '↗' : escapePdfHtml((a.label ?? '').slice(0, 2) || '•');
      divParts.push(`<div style="position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-50%);min-width:12px;height:12px;border-radius:7px;background:${color};border:1px solid #fff;color:#fff;font-size:7px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 2px;">${sym}</div>`);
    }
  }

  const svg = svgParts.length
    ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;">${svgParts.join('')}</svg>`
    : '';
  return `${svg}${divParts.join('')}`;
}

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
    // Dimensions auto plafonnées (jamais de largeur fixe sans plafond de
    // hauteur) : la boîte épouse toujours l'image — le calque d'annotations
    // en % reste aligné — et une photo portrait ne s'étire plus démesurément.
    const overlay = buildPhotoAnnotationsOverlayHtml(p.annotations);
    return `<div style="margin-top:6px;page-break-inside:avoid;">
      <div style="position:relative;display:inline-block;max-width:100%;">
        <img src="${escapePdfHtml(p.src)}" onerror="this.style.opacity='0.15'"
          style="width:auto;height:auto;max-width:${width}px;max-height:150px;display:block;border-radius:4px;border:1px solid #DDE4EE;background:#F9FAFB;" />${overlay}
      </div>${badge}
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
