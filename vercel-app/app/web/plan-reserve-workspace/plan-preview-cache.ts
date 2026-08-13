'use client';

const PLAN_PREVIEW_CACHE = 'buildtrack-private-plan-previews-v1';
const PLAN_PREVIEW_PATH = '/__buildtrack_private_plan_preview__/v1/';
const PLAN_PREVIEW_MAX_ENTRIES = 32;
const PLAN_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
const PLAN_PREVIEW_MAX_DIMENSION = 1_600;
const ALLOWED_PREVIEW_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg']);

export type PlanPreviewRecord = {
  blob: Blob;
  width: number;
  height: number;
};

type PlanPreviewIdentity = {
  userId: string;
  planKey: string;
};

type StoredPlanPreview = PlanPreviewIdentity & PlanPreviewRecord;

function cacheStorage() {
  return typeof globalThis !== 'undefined' && 'caches' in globalThis
    ? globalThis.caches
    : null;
}

async function sha256(value: string) {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const bytes = new TextEncoder().encode(value);
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function previewOrigin() {
  return typeof location !== 'undefined' && /^https?:$/i.test(location.protocol)
    ? location.origin
    : 'https://buildtrack.invalid';
}

async function previewOwnerPath(userId: string) {
  const ownerHash = await sha256(`owner\0${userId}`);
  if (!ownerHash) throw new Error('Secure preview cache hashing unavailable.');
  return `${PLAN_PREVIEW_PATH}${ownerHash}/`;
}

export async function createPlanPreviewCacheUrl({ userId, planKey }: PlanPreviewIdentity) {
  const ownerPath = await previewOwnerPath(userId);
  const entryHash = await sha256(`preview\0${userId}\0${planKey}`);
  if (!entryHash) throw new Error('Secure preview cache hashing unavailable.');
  return `${previewOrigin()}${ownerPath}${entryHash}`;
}

function validPreviewBlob(blob: Blob) {
  return ALLOWED_PREVIEW_TYPES.has(blob.type.toLowerCase())
    && blob.size > 0
    && blob.size <= PLAN_PREVIEW_MAX_BYTES;
}

function positiveDimension(value: string | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function readPlanPreview(identity: PlanPreviewIdentity): Promise<PlanPreviewRecord | null> {
  if (!identity.userId || !identity.planKey) return null;
  const storage = cacheStorage();
  if (!storage) return null;
  try {
    const cache = await storage.open(PLAN_PREVIEW_CACHE);
    const response = await cache.match(await createPlanPreviewCacheUrl(identity));
    if (!response) return null;
    const blob = await response.blob();
    if (!validPreviewBlob(blob)) return null;
    return {
      blob,
      width: positiveDimension(response.headers.get('X-BuildTrack-Preview-Width')),
      height: positiveDimension(response.headers.get('X-BuildTrack-Preview-Height')),
    };
  } catch {
    return null;
  }
}

async function prunePlanPreviews(cache: Cache, userId: string) {
  const ownerPath = await previewOwnerPath(userId);
  const keys = (await cache.keys()).filter(request => new URL(request.url).pathname.startsWith(ownerPath));
  if (keys.length <= PLAN_PREVIEW_MAX_ENTRIES) return;
  const dated = await Promise.all(keys.map(async request => {
    const response = await cache.match(request);
    return {
      request,
      cachedAt: Number(response?.headers.get('X-BuildTrack-Cached-At') ?? 0),
    };
  }));
  dated.sort((left, right) => right.cachedAt - left.cachedAt);
  await Promise.all(dated.slice(PLAN_PREVIEW_MAX_ENTRIES).map(entry => cache.delete(entry.request)));
}

export async function writePlanPreview({ userId, planKey, blob, width, height }: StoredPlanPreview) {
  if (!userId || !planKey || !validPreviewBlob(blob)) return false;
  const storage = cacheStorage();
  if (!storage) return false;
  try {
    const cache = await storage.open(PLAN_PREVIEW_CACHE);
    const url = await createPlanPreviewCacheUrl({ userId, planKey });
    await cache.put(url, new Response(blob, {
      headers: {
        'Content-Type': blob.type,
        'X-BuildTrack-Cached-At': String(Date.now()),
        'X-BuildTrack-Preview-Width': String(Math.max(0, Math.round(width))),
        'X-BuildTrack-Preview-Height': String(Math.max(0, Math.round(height))),
      },
    }));
    await prunePlanPreviews(cache, userId);
    return true;
  } catch {
    return false;
  }
}

export async function clearPlanPreviewsForUser(userId: string) {
  if (!userId) return;
  const storage = cacheStorage();
  if (!storage) return;
  try {
    const cache = await storage.open(PLAN_PREVIEW_CACHE);
    const ownerPath = await previewOwnerPath(userId);
    const keys = (await cache.keys()).filter(request => new URL(request.url).pathname.startsWith(ownerPath));
    await Promise.all(keys.map(request => cache.delete(request)));
  } catch {
    // Cache cleanup must never block sign-out or account switching.
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
}

export async function rasterizePlanPreview(canvas: HTMLCanvasElement): Promise<PlanPreviewRecord | null> {
  if (!canvas.width || !canvas.height || typeof document === 'undefined') return null;
  try {
    const ratio = Math.min(1, PLAN_PREVIEW_MAX_DIMENSION / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * ratio));
    const height = Math.max(1, Math.round(canvas.height * ratio));
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d', { alpha: false });
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(canvas, 0, 0, width, height);
    const webp = await canvasBlob(output, 'image/webp', 0.78);
    const blob = webp && validPreviewBlob(webp)
      ? webp
      : await canvasBlob(output, 'image/jpeg', 0.82);
    return blob && validPreviewBlob(blob) ? { blob, width, height } : null;
  } catch {
    return null;
  }
}
