import { NextRequest, NextResponse } from 'next/server';
import type { PdfReportPayload } from '@/types/pdfReport';
import { buildGlobalReportHtml, buildGlobalReservesHtml, buildIndividualReserveHtml, buildVisitReportHtml } from '@/lib/reportBuilder';
import { sendEmail } from '@/lib/sender';
import { getReserveStatusLabel } from '@/lib/reserveLabels';
import { normalizeEmailLanguage, APP_URL, type EmailLanguage } from '@/lib/templates';
import { checkRateLimit } from '@/lib/rateLimit';
import { isOptedOut, withUnsubscribeFooter, listUnsubscribeHeaders } from '@/lib/emailOptout';
import { r2EndpointHost, r2PublicHost } from '@/lib/r2';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { authenticateRequest, createServiceClient, getOrganizationUsers, type AuthenticatedRequest } from '@/lib/server-auth';
import { collectRegistryMediaRefs, replaceResolvedMediaRefs, resolveAuthorizedMediaRefs } from '@/lib/private-media-server';

export const maxDuration = 60;
export const runtime = 'nodejs';

const ALLOWED_ORIGINS = [
  'https://buildtrack-mobile.vercel.app',
  'http://localhost:5000',
  'http://localhost:3000',
];

function safePdfFilePart(value: unknown, fallback = 'document'): string {
  const cleaned = String(value ?? fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019`]/g, '')
    .replace(/&/g, ' et ')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function buildPdfFilename(type: string, parts: unknown[] = []): string {
  const segments = [type, ...parts]
    .map(part => safePdfFilePart(part, ''))
    .filter(Boolean);
  return `${segments.length > 0 ? segments.join('_') : 'Document'}.pdf`;
}

function corsHeaders(origin: string) {
  const o = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Disposition, Server-Timing, X-BuildTrack-PDF-Transfer',
  };
}

function getServiceClient() {
  return createServiceClient();
}

function isChromiumRuntimeError(error: any) {
  const message = String(error?.message ?? error ?? '');
  return /libnss3|shared libraries|Failed to launch|TROUBLESHOOTING|executable doesn't exist|spawn/i.test(message);
}

function pdfRuntimeErrorMessage(error: any) {
  if (isChromiumRuntimeError(error)) {
    return "Le moteur PDF serveur n'est pas disponible sur cet environnement. Utilisez l'impression PDF du navigateur.";
  }
  // Message générique : les détails (message, stack, runtime) restent côté logs serveur.
  return 'Génération PDF impossible.';
}

type PdfCallerProfile = {
  id: string;
  email: string | null;
  organization_id: string | null;
  auth: AuthenticatedRequest;
};

async function authenticatedCallerProfile(req: NextRequest, supabase: any): Promise<PdfCallerProfile | null> {
  const auth = await authenticateRequest(req, supabase);
  if (!auth) return null;
  return {
    id: auth.authority.userId,
    email: auth.authority.email || null,
    organization_id: auth.authority.organizationId,
    auth,
  };
}

const MAX_PDF_EMAIL_RECIPIENTS = 20;

// Restreint les destinataires aux emails connus de l'organisation de l'appelant
// (profils ou entreprises). Les emails inconnus sont ignorés (loggés), max 20.
async function resolveAllowedRecipients(
  supabase: any,
  organizationId: string | null,
  requested: unknown,
): Promise<string[]> {
  const requestedEmails = Array.from(new Set(
    (Array.isArray(requested) ? requested : [])
      .map(value => String(value ?? '').trim().toLowerCase())
      .filter(email => email.includes('@'))
  ));
  if (requestedEmails.length === 0) return [];
  if (!organizationId) {
    console.warn('[generate-pdf] Destinataires ignorés (appelant sans organisation):', requestedEmails.join(', '));
    return [];
  }

  const allowed = new Set<string>();
  const [users, companiesResult] = await Promise.all([
    getOrganizationUsers(supabase, organizationId),
    supabase.from('companies').select('email').eq('organization_id', organizationId),
  ]);
  if (companiesResult.error) {
    console.warn('[generate-pdf] Lecture emails entreprises impossible:', companiesResult.error.message);
  }
  for (const row of [...users, ...(companiesResult.data ?? [])]) {
    const email = String(row?.email ?? '').trim().toLowerCase();
    if (email.includes('@')) allowed.add(email);
  }

  const accepted: string[] = [];
  const ignored: string[] = [];
  for (const email of requestedEmails) {
    (allowed.has(email) ? accepted : ignored).push(email);
  }
  if (ignored.length > 0) {
    console.warn('[generate-pdf] Destinataires ignorés (hors organisation):', ignored.join(', '));
  }
  if (accepted.length > MAX_PDF_EMAIL_RECIPIENTS) {
    console.warn(`[generate-pdf] Destinataires plafonnés à ${MAX_PDF_EMAIL_RECIPIENTS} (${accepted.length} demandés).`);
  }
  return accepted.slice(0, MAX_PDF_EMAIL_RECIPIENTS);
}

function compactPdfError(error: any) {
  const stack = String(error?.stack ?? '')
    .split('\n')
    .slice(0, 8)
    .join('\n');

  return {
    name: String(error?.name ?? error?.constructor?.name ?? 'Error'),
    message: String(error?.message ?? error ?? ''),
    code: error?.code ? String(error.code) : null,
    stack: stack || null,
  };
}

function basePdfDiagnostic() {
  return {
    id: randomUUID(),
    stage: 'init',
    runtime: 'nodejs',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    vercel: Boolean(process.env.VERCEL),
    vercelRegion: process.env.VERCEL_REGION ?? null,
    awsExecutionEnv: process.env.AWS_EXECUTION_ENV ?? null,
    awsLambdaRuntime: process.env.AWS_LAMBDA_JS_RUNTIME ?? null,
    hasChromiumPackUrl: Boolean(process.env.CHROMIUM_PACK_URL),
    hasPuppeteerExecutablePath: Boolean(process.env.PUPPETEER_EXECUTABLE_PATH),
    hasChromePath: Boolean(process.env.CHROME_PATH || process.env.GOOGLE_CHROME_BIN),
    ldLibraryPath: process.env.LD_LIBRARY_PATH ?? null,
    fontconfigPath: process.env.FONTCONFIG_PATH ?? null,
  } as Record<string, any>;
}

function enrichPdfError(error: any, diagnostic: Record<string, any>) {
  const enriched = error instanceof Error ? error : new Error(String(error ?? 'Erreur PDF'));
  (enriched as any).pdfDiagnostic = {
    ...diagnostic,
    error: compactPdfError(enriched),
  };
  return enriched;
}

function pdfErrorDiagnostic(error: any, context: Record<string, any>) {
  return {
    ...(error?.pdfDiagnostic ?? basePdfDiagnostic()),
    ...context,
    error: error?.pdfDiagnostic?.error ?? compactPdfError(error),
  };
}

const PDF_REMOTE_IMAGE_LIMIT = 160;
const PDF_REMOTE_IMAGE_TIMEOUT_MS = 10000;
const PDF_REMOTE_IMAGE_SOURCE_MAX_BYTES = 24 * 1024 * 1024;
const PDF_REMOTE_IMAGE_TOTAL_MAX_BYTES = 40 * 1024 * 1024;
const PDF_REMOTE_IMAGE_PER_ITEM_MAX_BYTES = 6 * 1024 * 1024;
const PDF_REMOTE_IMAGE_CONCURRENCY = 6;
const PDF_REMOTE_IMAGE_RENDER_WIDTH = 900;
const PDF_SET_CONTENT_TIMEOUT_MS = 15000;
const PDF_IMAGE_WAIT_TIMEOUT_MS = 12000;
const CHROMIUM_AL2023_LIB_PATH = '/tmp/al2023/lib';
const CHROMIUM_AL2023_LIB_SENTINEL = `${CHROMIUM_AL2023_LIB_PATH}/libnss3.so`;
const DEFAULT_CHROMIUM_PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar';

function prependEnvPath(name: string, value: string) {
  const current = process.env[name];
  if (!current) {
    process.env[name] = value;
    return process.env[name];
  }

  const parts = current.split(':').filter(Boolean);
  if (!parts.includes(value)) {
    process.env[name] = [value, ...parts].join(':');
  }
  return process.env[name];
}

function prepareServerlessChromiumEnvironment() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const amazonLinux2023Runtime =
    process.platform === 'linux' &&
    (
      (Boolean(process.env.VERCEL) && nodeMajor >= 20) ||
      /(?:20|22|24)\.x/.test(`${process.env.AWS_EXECUTION_ENV ?? ''} ${process.env.AWS_LAMBDA_JS_RUNTIME ?? ''}`)
    );

  if (!amazonLinux2023Runtime) {
    return {
      applied: false,
      nodeMajor,
      reason: 'not-amazon-linux-2023',
    };
  }

  process.env.FONTCONFIG_PATH ??= '/tmp/fonts';
  process.env.HOME ??= '/tmp';

  return {
    applied: true,
    nodeMajor,
    target: 'amazon-linux-2023',
    ldLibraryPath: prependEnvPath('LD_LIBRARY_PATH', CHROMIUM_AL2023_LIB_PATH),
    fontconfigPath: process.env.FONTCONFIG_PATH,
    home: process.env.HOME,
  };
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Identique au helper de lib/templates.ts : échappe toute valeur dynamique
// interpolée dans du HTML (corps et attributs, quotes incluses).
function escapeHtml(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function optimizeImageBufferForPdf(buffer: Buffer, contentType: string) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();

  if (mime === 'image/svg+xml') {
    return { buffer, mime: mime || 'image/svg+xml' };
  }

  try {
    const sharpModule = await import('sharp');
    const sharp = sharpModule.default ?? sharpModule;
    const optimized = await sharp(buffer)
      .rotate()
      .resize({
        width: PDF_REMOTE_IMAGE_RENDER_WIDTH,
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 68,
        mozjpeg: true,
      })
      .toBuffer();

    return { buffer: optimized, mime: 'image/jpeg' };
  } catch (error: any) {
    console.warn('[generate-pdf] Image optimization skipped:', error?.message ?? error);
    return { buffer, mime: mime || 'image/jpeg' };
  }
}

async function fetchRemoteImageAsDataUrl(url: string, remainingBudget: number) {
  if (remainingBudget <= 0) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PDF_REMOTE_IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent': 'BuildTrack PDF Renderer',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw new Error(`Unsupported content-type: ${contentType || 'unknown'}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > PDF_REMOTE_IMAGE_SOURCE_MAX_BYTES) {
      throw new Error(`Image too large: ${contentLength} bytes`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > PDF_REMOTE_IMAGE_SOURCE_MAX_BYTES) {
      throw new Error(`Image too large: ${arrayBuffer.byteLength} bytes`);
    }

    const optimized = await optimizeImageBufferForPdf(Buffer.from(arrayBuffer), contentType);
    if (optimized.buffer.byteLength > remainingBudget) {
      throw new Error(`Optimized image too large: ${optimized.buffer.byteLength} bytes`);
    }

    return {
      dataUrl: `data:${optimized.mime};base64,${optimized.buffer.toString('base64')}`,
      byteLength: optimized.buffer.byteLength,
    };
  } catch (error: any) {
    console.warn('[generate-pdf] Remote image not embedded:', error?.message ?? error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Anti-SSRF : seules les images hébergées sur l'instance Supabase du projet
// OU sur notre hôte public Cloudflare R2 (Worker *.workers.dev) peuvent être
// téléchargées côté serveur pour être inlinées dans le PDF.
function allowedRemoteImageHosts(): Set<string> {
  const hosts = new Set<string>();
  const supabaseRaw =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (supabaseRaw) {
    try { hosts.add(new URL(supabaseRaw).host.toLowerCase()); } catch {}
  }
  const r2Host = r2PublicHost();
  if (r2Host) hosts.add(r2Host.toLowerCase());
  const privateR2Host = r2EndpointHost();
  if (privateR2Host) hosts.add(privateR2Host.toLowerCase());
  return hosts;
}

function isAllowedRemoteImageUrl(rawUrl: string, allowedHosts: Set<string>): boolean {
  if (allowedHosts.size === 0) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return allowedHosts.has(parsed.host.toLowerCase());
  } catch {
    return false;
  }
}

async function inlineRemoteImagesForPdf(html: string) {
  const srcRegex = /\bsrc="(https?:\/\/[^"]+)"/gi;
  const matches = Array.from(html.matchAll(srcRegex));
  const uniqueAttrs = Array.from(new Set(matches.map(match => match[1]).filter(Boolean)));

  if (uniqueAttrs.length === 0) return html;

  const allowedHosts = allowedRemoteImageHosts();
  const disallowed = new Set<string>();
  const fetchable: string[] = [];

  for (const attrValue of uniqueAttrs) {
    const url = decodeHtmlAttribute(attrValue);
    if (isAllowedRemoteImageUrl(url, allowedHosts)) {
      fetchable.push(attrValue);
    } else {
      disallowed.add(attrValue);
      console.warn('[generate-pdf] Remote image blocked (host non autorisé):', url.slice(0, 160));
    }
  }

  const attributes = fetchable.slice(0, PDF_REMOTE_IMAGE_LIMIT);
  const replacements = new Map<string, string>();
  let budget = PDF_REMOTE_IMAGE_TOTAL_MAX_BYTES;

  for (let index = 0; index < attributes.length && budget > 0; index += PDF_REMOTE_IMAGE_CONCURRENCY) {
    const batch = attributes.slice(index, index + PDF_REMOTE_IMAGE_CONCURRENCY);
    const itemBudget = Math.min(budget, PDF_REMOTE_IMAGE_PER_ITEM_MAX_BYTES);
    const results = await Promise.all(batch.map(async attrValue => ({
      attrValue,
      result: await fetchRemoteImageAsDataUrl(decodeHtmlAttribute(attrValue), itemBudget),
    })));

    for (const { attrValue, result } of results) {
      if (!result || result.byteLength > budget) continue;
      replacements.set(attrValue, result.dataUrl);
      budget -= result.byteLength;
      if (budget <= 0) break;
    }
  }

  if (replacements.size === 0 && disallowed.size === 0) return html;

  return html.replace(srcRegex, (fullMatch, attrValue: string) => {
    if (disallowed.has(attrValue)) return '';
    const replacement = replacements.get(attrValue);
    return replacement ? `src="${escapeHtmlAttribute(replacement)}"` : fullMatch;
  });
}

async function waitForPdfImages(page: any) {
  try {
    return await page.evaluate(async (timeoutMs: number) => {
      const images = Array.from(document.images);
      const summary = {
        total: images.length,
        loaded: 0,
        failed: 0,
        timedOut: false,
      };

      await Promise.race([
        Promise.all(images.map(image => {
          if (image.complete && image.naturalWidth > 0) {
            summary.loaded += 1;
            return image.decode?.().catch(() => undefined) ?? Promise.resolve();
          }

          return new Promise(resolve => {
            const done = (loaded: boolean) => {
              if (loaded && image.naturalWidth > 0) summary.loaded += 1;
              else summary.failed += 1;
              resolve(undefined);
            };
            const timer = window.setTimeout(() => done(false), 9000);
            image.addEventListener('load', () => {
              window.clearTimeout(timer);
              done(true);
            }, { once: true });
            image.addEventListener('error', () => {
              window.clearTimeout(timer);
              done(false);
            }, { once: true });
          }).then(() => image.decode?.().catch(() => undefined));
        })),
        new Promise<void>(resolve => {
          window.setTimeout(() => {
            summary.timedOut = true;
            resolve();
          }, timeoutMs);
        }),
      ]);

      return summary;
    }, PDF_IMAGE_WAIT_TIMEOUT_MS);
  } catch (error: any) {
    console.warn('[generate-pdf] Image wait skipped:', error?.message ?? error);
    return {
      total: null,
      loaded: null,
      failed: null,
      timedOut: true,
      error: error?.message ?? String(error),
    };
  }
}

function localChromiumExecutablePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : null,
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe` : null,
    process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe` : null,
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe` : null,
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe` : null,
    process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe` : null,
  ]
    .map(value => String(value ?? '').trim())
    .filter(Boolean);

  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

async function loadChromiumRuntime() {
  const attempts: any[] = [];
  try {
    return {
      chromium: (await import('@sparticuz/chromium')).default as any,
      bundled: true,
      packageName: '@sparticuz/chromium',
      attempts,
    };
  } catch (error: any) {
    attempts.push({ packageName: '@sparticuz/chromium', error: compactPdfError(error) });
    try {
      return {
        chromium: (await import('@sparticuz/chromium-min')).default as any,
        bundled: false,
        packageName: '@sparticuz/chromium-min',
        attempts,
      };
    } catch (fallbackError: any) {
      attempts.push({ packageName: '@sparticuz/chromium-min', error: compactPdfError(fallbackError) });
      const err = new Error('Chromium runtime introuvable');
      (err as any).chromiumImportAttempts = attempts;
      throw err;
    }
  }
}

async function resolvePuppeteerExecutablePath(chromium: any, bundled: boolean) {
  const localExecutablePath = localChromiumExecutablePath();
  if (localExecutablePath) {
    return { executablePath: localExecutablePath, local: true, source: 'local-browser' };
  }

  if (bundled && !process.env.CHROMIUM_PACK_URL) {
    return {
      executablePath: await chromium.executablePath(),
      local: false,
      source: '@sparticuz/chromium',
    };
  }

  const chromiumUrl =
    process.env.CHROMIUM_PACK_URL ??
    DEFAULT_CHROMIUM_PACK_URL;

  return {
    executablePath: await (chromium as any).executablePath(chromiumUrl),
    local: false,
    source: process.env.CHROMIUM_PACK_URL ? 'CHROMIUM_PACK_URL' : 'default-pack-url',
    chromiumUrl,
  };
}

let pdfBrowserPromise: Promise<any> | null = null;

async function launchPdfBrowser(diagnostic: Record<string, any>) {
  let puppeteer: typeof import('puppeteer-core');
  let chromium: any;
  let bundledChromium = false;

  try {
    diagnostic.stage = 'load-runtime';
    const chromiumRuntime = await loadChromiumRuntime();
    chromium = chromiumRuntime.chromium;
    bundledChromium = chromiumRuntime.bundled;
    diagnostic.chromiumPackage = chromiumRuntime.packageName;
    diagnostic.bundledChromium = chromiumRuntime.bundled;
    diagnostic.chromiumImportAttempts = chromiumRuntime.attempts;
    puppeteer = (await import('puppeteer-core')).default as any;
    diagnostic.puppeteerLoaded = true;
  } catch (importErr: any) {
    console.error('[generate-pdf] Import error:', importErr?.message);
    diagnostic.importAttempts = importErr?.chromiumImportAttempts ?? null;
    throw enrichPdfError(new Error('Puppeteer non disponible sur ce runtime'), diagnostic);
  }

  diagnostic.stage = 'configure-chromium';
  if ('setHeadlessMode' in chromium) {
    chromium.setHeadlessMode = 'shell';
  }
  if ('setGraphicsMode' in chromium) {
    chromium.setGraphicsMode = false;
  }

  diagnostic.stage = 'resolve-executable';
  const runtime = await resolvePuppeteerExecutablePath(chromium, bundledChromium);
  diagnostic.executableSource = runtime.source;
  diagnostic.executablePath = runtime.executablePath;
  diagnostic.usesLocalBrowser = runtime.local;
  diagnostic.chromiumUrl = runtime.chromiumUrl ?? null;
  diagnostic.chromiumTmpExists = process.platform === 'linux' ? existsSync('/tmp/chromium') : null;
  diagnostic.al2023LibPath = process.platform === 'linux' ? CHROMIUM_AL2023_LIB_PATH : null;
  diagnostic.al2023LibExists = process.platform === 'linux' ? existsSync(CHROMIUM_AL2023_LIB_SENTINEL) : null;
  diagnostic.ldLibraryPathAfterResolve = process.env.LD_LIBRARY_PATH ?? null;

  diagnostic.stage = 'launch-browser';
  const headlessMode = runtime.local ? true : 'shell';
  const chromiumArgs = runtime.local
    ? ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox']
    : await (puppeteer as any).defaultArgs({
        args: (chromium as any).args ?? [],
        headless: headlessMode,
      });
  const launchArgs = Array.from(new Set([
    ...chromiumArgs,
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-sandbox',
  ]));
  diagnostic.headlessMode = headlessMode;
  diagnostic.launchArgCount = launchArgs.length;
  const browser = await (puppeteer as any).launch({
    args: launchArgs,
    defaultViewport: runtime.local
      ? { width: 1280, height: 720 }
      : ((chromium as any).defaultViewport ?? { width: 1920, height: 1080 }),
    executablePath: runtime.executablePath,
    headless: headlessMode,
  });
  diagnostic.browserLaunched = true;
  diagnostic.browserReused = false;
  return browser;
}

async function acquirePdfBrowser(diagnostic: Record<string, any>) {
  if (pdfBrowserPromise) {
    try {
      const browser = await pdfBrowserPromise;
      if (browser?.isConnected?.()) {
        diagnostic.browserReused = true;
        return browser;
      }
    } catch {
      // La promesse de lancement défaillante sera remplacée ci-dessous.
    }
    pdfBrowserPromise = null;
  }

  const launchPromise = launchPdfBrowser(diagnostic);
  pdfBrowserPromise = launchPromise;
  try {
    const browser = await launchPromise;
    browser.once?.('disconnected', () => {
      if (pdfBrowserPromise === launchPromise) pdfBrowserPromise = null;
    });
    return browser;
  } catch (error) {
    if (pdfBrowserPromise === launchPromise) pdfBrowserPromise = null;
    throw error;
  }
}

async function renderPdfBuffer(html: string): Promise<Buffer> {
  let browser: any = null;
  let page: any = null;
  const chromiumEnvironment = prepareServerlessChromiumEnvironment();
  const diagnostic: Record<string, any> = {
    ...basePdfDiagnostic(),
    htmlLength: html.length,
    chromiumEnvironment,
  };

  try {
    diagnostic.stage = 'prepare-renderer';
    const browserPromise = acquirePdfBrowser(diagnostic);
    const inlineStartedAt = Date.now();
    const htmlPromise = inlineRemoteImagesForPdf(html).then(pdfHtml => {
      diagnostic.remoteImageInliningMs = Date.now() - inlineStartedAt;
      return pdfHtml;
    });
    [browser, html] = await Promise.all([browserPromise, htmlPromise]);
    diagnostic.inlinedHtmlLength = html.length;

    diagnostic.stage = 'new-page';
    page = await browser.newPage();
    const blockedExternalRequests: string[] = [];
    await page.setRequestInterception(true);
    page.on('request', (request: any) => {
      const requestUrl = String(request.url?.() ?? '');
      if (/^https?:\/\//i.test(requestUrl)) {
        if (blockedExternalRequests.length < 12) {
          blockedExternalRequests.push(requestUrl.slice(0, 240));
        }
        request.abort().catch(() => undefined);
        return;
      }
      request.continue().catch(() => undefined);
    });
    diagnostic.externalRequestBlocking = 'http-and-https';
    diagnostic.stage = 'set-content';
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: PDF_SET_CONTENT_TIMEOUT_MS });
    diagnostic.blockedExternalRequestCount = blockedExternalRequests.length;
    diagnostic.blockedExternalRequestSample = blockedExternalRequests;
    diagnostic.stage = 'wait-images';
    diagnostic.imageWait = await waitForPdfImages(page);

    diagnostic.stage = 'render-pdf';
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    });
    diagnostic.stage = 'done';
    diagnostic.pdfBytes = pdfBuffer.length;
    return pdfBuffer;
  } catch (error: any) {
    if (browser && !browser.isConnected?.()) pdfBrowserPromise = null;
    console.error('[generate-pdf] PDF diagnostic:', {
      ...diagnostic,
      error: compactPdfError(error),
    });
    throw enrichPdfError(error, diagnostic);
  } finally {
    if (page) {
      await page.close().catch((closeError: any) => {
        console.warn('[generate-pdf] Page close error:', closeError?.message ?? closeError);
      });
    }
  }
}

async function resolveRecipientLanguage(email: string, fallback?: string | null): Promise<EmailLanguage> {
  const supabase = getServiceClient();
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!supabase || !normalizedEmail) return normalizeEmailLanguage(fallback);
  const { data, error } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (error) {
    console.warn('[generate-pdf] preferred_language indisponible:', error.message);
    return normalizeEmailLanguage(fallback);
  }
  return normalizeEmailLanguage(data?.preferred_language ?? fallback);
}

const PDF_EMAIL_COPY = {
  fr: {
    hello: 'Bonjour,',
    individualTitle: 'Fiche de réserve',
    individualSubject: (title: string, chantier: string) => `Fiche réserve — ${title} (${chantier})`,
    individualIntro: (title: string) => `Veuillez trouver ci-joint la fiche de réserve <strong>${title}</strong>.`,
    status: 'Statut',
    building: 'Bâtiment',
    level: 'Niveau',
    allCompanies: 'Toutes les entreprises',
    reportSubject: (kind: string, chantier: string, company: string) => `Rapport des ${kind} — ${chantier} (${company})`,
    reportTitle: (kind: string) => `Rapport des ${kind}`,
    reportIntro: (kind: string, chantier: string, company: string, date: string) => `Veuillez trouver ci-joint le rapport des ${kind} pour <strong>${chantier}</strong> (${company}), généré le ${date}.`,
    reserveCount: (count: number) => `réserve${count !== 1 ? 's' : ''} exportée${count !== 1 ? 's' : ''}`,
    reservesKind: 'réserves',
    plansKind: 'plans',
  },
  en: {
    hello: 'Hello,',
    individualTitle: 'Issue sheet',
    individualSubject: (title: string, chantier: string) => `Issue sheet — ${title} (${chantier})`,
    individualIntro: (title: string) => `Please find attached the issue sheet for <strong>${title}</strong>.`,
    status: 'Status',
    building: 'Building',
    level: 'Level',
    allCompanies: 'All companies',
    reportSubject: (kind: string, chantier: string, company: string) => `${kind} report — ${chantier} (${company})`,
    reportTitle: (kind: string) => `${kind} report`,
    reportIntro: (kind: string, chantier: string, company: string, date: string) => `Please find attached the ${kind.toLowerCase()} report for <strong>${chantier}</strong> (${company}), generated on ${date}.`,
    reserveCount: (count: number) => `${count === 1 ? 'issue' : 'issues'} exported`,
    reservesKind: 'Issues',
    plansKind: 'Plans',
  },
  es: {
    hello: 'Hola,',
    individualTitle: 'Ficha de reserva',
    individualSubject: (title: string, chantier: string) => `Ficha de reserva — ${title} (${chantier})`,
    individualIntro: (title: string) => `Adjuntamos la ficha de reserva <strong>${title}</strong>.`,
    status: 'Estado',
    building: 'Edificio',
    level: 'Nivel',
    allCompanies: 'Todas las empresas',
    reportSubject: (kind: string, chantier: string, company: string) => `Informe de ${kind} — ${chantier} (${company})`,
    reportTitle: (kind: string) => `Informe de ${kind}`,
    reportIntro: (kind: string, chantier: string, company: string, date: string) => `Adjuntamos el informe de ${kind} para <strong>${chantier}</strong> (${company}), generado el ${date}.`,
    reserveCount: (count: number) => `${count === 1 ? 'reserva exportada' : 'reservas exportadas'}`,
    reservesKind: 'reservas',
    plansKind: 'planos',
  },
} as const;

const PDF_LOCALES: Record<EmailLanguage, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
};

const STATUS_LABELS: Record<EmailLanguage, Record<string, string>> = {
  fr: {},
  en: { open: 'Open', in_progress: 'In progress', waiting: 'Pending', verification: 'Verification', closed: 'Closed' },
  es: { open: 'Abierta', in_progress: 'En curso', waiting: 'En espera', verification: 'Verificación', closed: 'Cerrada' },
};

function reserveStatusForEmail(status: string | undefined, language: EmailLanguage) {
  if (language === 'fr') return getReserveStatusLabel(status, true);
  return STATUS_LABELS[language][status ?? ''] ?? status ?? '—';
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const headers = corsHeaders(origin);
  const acceptsBinaryPdf = req.headers.get('accept')
    ?.split(',')
    .some(value => value.trim().toLowerCase().startsWith('application/pdf')) ?? false;

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: 'Configuration Supabase serveur manquante' },
      { status: 500, headers }
    );
  }

  const callerProfile = await authenticatedCallerProfile(req, supabase);
  if (!callerProfile) {
    return NextResponse.json(
      { success: false, error: 'Session invalide' },
      { status: 401, headers }
    );
  }

  const rate = checkRateLimit(`generate-pdf:${callerProfile.id}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: 'Trop de générations PDF. Réessayez dans quelques instants.' },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    let payload: any;
    try {
      payload = await req.json();
    } catch (parseError: any) {
      const message = String(parseError?.message ?? '').toLowerCase();
      const status = message.includes('too large') || message.includes('entity') ? 413 : 400;
      return NextResponse.json(
        {
          success: false,
          error: status === 413
            ? 'Export PDF trop volumineux. Réduisez le périmètre ou filtrez par entreprise, puis réessayez.'
            : 'Payload PDF invalide.',
        },
        { status, headers }
      );
    }
    const mediaRefs = Array.from(collectRegistryMediaRefs(payload));
    if (mediaRefs.length > 0) {
      const resolved = await resolveAuthorizedMediaRefs(callerProfile.auth, mediaRefs, 600);
      payload = replaceResolvedMediaRefs(
        payload,
        new Map(resolved.map(asset => [asset.ref, asset.url])),
      );
    }
    const type: string = payload.type ?? 'plans';

    let html: string;

    if (type === 'global_reserves') {
      if (!payload.chantierName || !Array.isArray(payload.reserves)) {
        return NextResponse.json(
          { success: false, error: 'Payload invalide (global_reserves)' },
          { status: 400, headers }
        );
      }
      html = buildGlobalReservesHtml(payload);
    } else if (type === 'individual_reserve') {
      if (!payload.reserve || !payload.chantierName) {
        return NextResponse.json(
          { success: false, error: 'Payload invalide (individual_reserve)' },
          { status: 400, headers }
        );
      }
      html = buildIndividualReserveHtml(payload);
    } else if (type === 'visit_report') {
      if (!payload.chantierName || !payload.visit || !Array.isArray(payload.reserves)) {
        return NextResponse.json(
          { success: false, error: 'Payload invalide (visit_report)' },
          { status: 400, headers }
        );
      }
      html = buildVisitReportHtml(payload);
    } else {
      const plansPayload = payload as PdfReportPayload;
      if (!plansPayload.chantierName || !Array.isArray(plansPayload.reserves) || !Array.isArray(plansPayload.plans)) {
        return NextResponse.json(
          { success: false, error: 'Payload invalide (plans)' },
          { status: 400, headers }
        );
      }
      html = buildGlobalReportHtml(plansPayload);
    }

    let pdfBuffer: Buffer;
    const pdfStartedAt = Date.now();
    try {
      pdfBuffer = await renderPdfBuffer(html);
    } catch (pdfError: any) {
      const friendlyError = pdfRuntimeErrorMessage(pdfError);
      const diagnostic = pdfErrorDiagnostic(pdfError, {
        payloadType: type,
        reserveCount: Array.isArray(payload.reserves) ? payload.reserves.length : null,
        planCount: Array.isArray(payload.plans) ? payload.plans.length : null,
        hasSendByEmail: Boolean(payload.sendByEmail),
        htmlLength: html.length,
      });
      console.error('[generate-pdf] PDF runtime unavailable:', diagnostic);

      // Le diagnostic complet (runtime, région, stack…) reste côté logs serveur :
      // seul un identifiant de corrélation est renvoyé au client.
      if (!payload.sendByEmail) {
        return NextResponse.json(
          {
            success: true,
            fallback: 'browser_print',
            printHtml: html,
            message: friendlyError,
          },
          {
            headers: {
              ...headers,
              'X-BuildTrack-PDF-Fallback': 'browser_print',
              'X-BuildTrack-PDF-Diagnostic-Id': String(diagnostic.id ?? ''),
            },
          }
        );
      }

      return NextResponse.json(
        { success: false, error: friendlyError },
        {
          status: 503,
          headers: {
            ...headers,
            'X-BuildTrack-PDF-Diagnostic-Id': String(diagnostic.id ?? ''),
          },
        }
      );
    }

    if (payload.sendByEmail && Array.isArray(payload.recipients) && payload.recipients.length > 0) {
      const allowedRecipients = await resolveAllowedRecipients(
        supabase,
        callerProfile.organization_id ?? null,
        payload.recipients,
      );
      if (!allowedRecipients.length) {
        return NextResponse.json({ success: false, error: 'Aucun destinataire autorisé.' }, { status: 403, headers });
      }
      const deliveries = await Promise.allSettled(
        allowedRecipients.map(async (to: string) => {
          if (await isOptedOut(supabase, to)) {
            return { success: false, suppressed: true };
          }
          const language = await resolveRecipientLanguage(to, payload.language);
          const copy = PDF_EMAIL_COPY[language];
          const dateStr = new Date(payload.generatedAt || Date.now()).toLocaleDateString(PDF_LOCALES[language], {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          });

          let filename: string;
          let subject: string;
          let emailHtml: string;

          if (type === 'individual_reserve') {
            const r = payload.reserve;
            const title = r.title || r.id;
            filename = buildPdfFilename('Reserve', [(r.id as string) || 'reserve', r.title, payload.chantierName]);
            subject = copy.individualSubject(title, payload.chantierName);
            const sLabel = reserveStatusForEmail(r.status, language);
            emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
              <div style="background:#003082;padding:24px 32px;border-radius:8px 8px 0 0">
                <div style="color:#fff;font-size:20px;font-weight:700">${copy.individualTitle}</div>
                <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">${escapeHtml(payload.chantierName)}</div>
              </div>
              <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <p style="margin:0 0 16px 0">${copy.hello}</p>
                <p style="margin:0 0 16px 0">${copy.individualIntro(escapeHtml(title))}</p>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0">
                  <div style="font-size:13px;color:#64748b">${copy.status} : <strong>${escapeHtml(sLabel)}</strong></div>
                  <div style="font-size:13px;color:#64748b;margin-top:4px">${copy.building} : <strong>${escapeHtml(r.building || '—')}</strong> · ${copy.level} : <strong>${escapeHtml(r.level || '—')}</strong></div>
                </div>
                <p style="margin:16px 0 0 0;color:#64748b;font-size:12px">— BuildTrack</p>
              </div>
            </div>`;
          } else {
            const companyFilter = payload.companyFilter as string | null;
            const companyLabel = companyFilter ?? copy.allCompanies;
            const count = Array.isArray(payload.reserves) ? (payload.reserves as any[]).length : 0;
            const companyPart = companyFilter ? companyLabel : null;
            filename = buildPdfFilename(type === 'global_reserves' ? 'Rapport_Reserves' : 'Rapport_Plans', [
              payload.chantierName,
              companyPart,
            ]);
            const reportKind = type === 'global_reserves' ? copy.reservesKind : copy.plansKind;
            subject = copy.reportSubject(reportKind, payload.chantierName, companyLabel);
            emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
              <div style="background:#003082;padding:24px 32px;border-radius:8px 8px 0 0">
                <div style="color:#fff;font-size:20px;font-weight:700">${copy.reportTitle(reportKind)}</div>
                <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">${escapeHtml(payload.chantierName)} · ${escapeHtml(companyLabel)}</div>
              </div>
              <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <p style="margin:0 0 16px 0">${copy.hello}</p>
                <p style="margin:0 0 16px 0">${copy.reportIntro(reportKind, escapeHtml(payload.chantierName), escapeHtml(companyLabel), escapeHtml(dateStr))}</p>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
                  <div style="font-size:32px;font-weight:800;color:#003082">${count}</div>
                  <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">${copy.reserveCount(count)}</div>
                </div>
                <p style="margin:16px 0 0 0;color:#64748b;font-size:12px">— BuildTrack</p>
              </div>
            </div>`;
          }

          return sendEmail({
            to,
            subject,
            html: withUnsubscribeFooter(emailHtml, APP_URL, to, language),
            headers: listUnsubscribeHeaders(APP_URL, to),
            attachments: [
              {
                filename,
                content: Buffer.from(pdfBuffer),
                contentType: 'application/pdf',
              },
            ],
          });
        })
      );
      const accepted = deliveries.filter(result => result.status === 'fulfilled' && result.value.success).length;
      if (accepted !== deliveries.length) {
        return NextResponse.json({ success: false, code: 'email_delivery_incomplete', accepted,
          failed: deliveries.length - accepted,
          error: `Envoi incomplet : ${accepted}/${deliveries.length} accepté(s) par le serveur mail. Ne renvoyez pas le rapport à tous les destinataires.`,
        }, { status: 502, headers });
      }
    }
    const responseHeaders = {
      ...headers,
      'Cache-Control': 'private, no-store',
      'Server-Timing': `generate-pdf;dur=${Date.now() - pdfStartedAt}`,
    };
    if (!payload.sendByEmail && acceptsBinaryPdf) {
      const filename = type === 'individual_reserve'
        ? buildPdfFilename('BuildTrack_reserve', [payload.reserve?.id, payload.chantierName])
        : buildPdfFilename('BuildTrack', [type, payload.chantierName]);
      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          ...responseHeaders,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-BuildTrack-PDF-Transfer': 'binary',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    return NextResponse.json({ success: true, pdfBase64 }, {
      headers: { ...responseHeaders, 'X-BuildTrack-PDF-Transfer': 'base64' },
    });
  } catch (err: any) {
    console.error('[generate-pdf] Erreur:', err?.stack ?? err?.message ?? err);
    return NextResponse.json(
      { success: false, error: 'Génération PDF impossible.' },
      { status: 500, headers }
    );
  }
}
