import { createClient } from '@supabase/supabase-js';
import { verifyReserveToken } from '@/lib/reserve-token';
import {
  getReservePriorityColor,
  getReserveStatusColor,
} from '@/lib/reserveLabels';
import { getReserveDescriptionText } from '@/lib/reserveDescription';
import { presignR2Read } from '@/lib/r2';

export const dynamic = 'force-dynamic';

// Couleur de marque alignée sur l'app web et les emails (#003082).
const BRAND = '#003082';
const ACCENT = '#FFCB00';

type PublicLang = 'fr' | 'en' | 'es';

const PUBLIC_COPY: Record<PublicLang, {
  footer: string;
  invalidLinkTitle: string;
  invalidLinkText: string;
  configMissingTitle: string;
  serviceUnavailable: string;
  expiredTitle: string;
  expiredText: string;
  dbMissingText: string;
  notFoundTitle: string;
  notFoundText: string;
  ref: string;
  project: string;
  noProject: string;
  location: string;
  companies: string;
  deadline: string;
  createdOn: string;
  description: string;
  photos: string;
  photoAlt: string;
  comments: string;
  history: string;
  anonymous: string;
  openApp: string;
  actionHint: string;
  noApp: string;
  priorityLabels: Record<string, string>;
  statusLabels: Record<string, string>;
}> = {
  fr: {
    footer: 'Page sécurisée par lien privé — ne pas partager. © Bouygues Construction',
    invalidLinkTitle: 'Lien invalide',
    invalidLinkText: "Ce lien ne contient pas de jeton d'accès. Veuillez utiliser le lien envoyé par email.",
    configMissingTitle: 'Configuration manquante',
    serviceUnavailable: 'Service indisponible.',
    expiredTitle: 'Lien expiré ou invalide',
    expiredText: "Le jeton d'accès est invalide ou a expiré. Demandez à l'expéditeur de vous renvoyer un nouvel email.",
    dbMissingText: "La connexion à la base de données n'est pas configurée.",
    notFoundTitle: 'Réserve introuvable',
    notFoundText: "Cette réserve a été supprimée ou n'existe plus.",
    ref: 'Réf.',
    project: 'Chantier',
    noProject: 'Non rattaché',
    location: 'Localisation',
    companies: 'Entreprise(s)',
    deadline: 'Échéance',
    createdOn: 'Créée le',
    description: 'Description',
    photos: 'Photos',
    photoAlt: 'photo',
    comments: 'Commentaires',
    history: 'Historique',
    anonymous: 'Anonyme',
    openApp: "Ouvrir dans l'app BuildTrack →",
    actionHint: "Pour ajouter un commentaire, modifier le statut ou téléverser une photo, ouvrez la réserve depuis l'application.",
    noApp: "Pas encore l'app ?",
    priorityLabels: { critical: 'Critique', high: 'Haute', medium: 'Moyenne', low: 'Basse' },
    statusLabels: { open: 'Ouverte', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturée' },
  },
  en: {
    footer: 'Secure page via private link — do not share. © Bouygues Construction',
    invalidLinkTitle: 'Invalid link',
    invalidLinkText: 'This link does not contain an access token. Please use the link sent by email.',
    configMissingTitle: 'Missing configuration',
    serviceUnavailable: 'Service unavailable.',
    expiredTitle: 'Expired or invalid link',
    expiredText: 'The access token is invalid or has expired. Ask the sender to send you a new email.',
    dbMissingText: 'The database connection is not configured.',
    notFoundTitle: 'Issue not found',
    notFoundText: 'This issue has been deleted or no longer exists.',
    ref: 'Ref.',
    project: 'Project',
    noProject: 'Not linked',
    location: 'Location',
    companies: 'Company/companies',
    deadline: 'Due date',
    createdOn: 'Created on',
    description: 'Description',
    photos: 'Photos',
    photoAlt: 'photo',
    comments: 'Comments',
    history: 'History',
    anonymous: 'Anonymous',
    openApp: 'Open in the BuildTrack app →',
    actionHint: 'To add a comment, change the status or upload a photo, open this issue in the app.',
    noApp: 'No app yet?',
    priorityLabels: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' },
    statusLabels: { open: 'Open', in_progress: 'In progress', waiting: 'Pending', verification: 'Verification', closed: 'Closed' },
  },
  es: {
    footer: 'Página segura mediante enlace privado — no compartir. © Bouygues Construction',
    invalidLinkTitle: 'Enlace no válido',
    invalidLinkText: 'Este enlace no contiene un token de acceso. Usa el enlace enviado por correo.',
    configMissingTitle: 'Configuración incompleta',
    serviceUnavailable: 'Servicio no disponible.',
    expiredTitle: 'Enlace caducado o no válido',
    expiredText: 'El token de acceso no es válido o ha caducado. Pide al remitente que te envíe un nuevo correo.',
    dbMissingText: 'La conexión a la base de datos no está configurada.',
    notFoundTitle: 'Incidencia no encontrada',
    notFoundText: 'Esta incidencia se eliminó o ya no existe.',
    ref: 'Ref.',
    project: 'Obra',
    noProject: 'No vinculada',
    location: 'Ubicación',
    companies: 'Empresa(s)',
    deadline: 'Fecha límite',
    createdOn: 'Creada el',
    description: 'Descripción',
    photos: 'Fotos',
    photoAlt: 'foto',
    comments: 'Comentarios',
    history: 'Historial',
    anonymous: 'Anónimo',
    openApp: 'Abrir en la app BuildTrack →',
    actionHint: 'Para añadir un comentario, cambiar el estado o subir una foto, abre esta incidencia en la aplicación.',
    noApp: '¿Aún no tienes la app?',
    priorityLabels: { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' },
    statusLabels: { open: 'Abierta', in_progress: 'En curso', waiting: 'En espera', verification: 'Verificación', closed: 'Cerrada' },
  },
};

function publicLang(value?: string | null): PublicLang {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('es')) return 'es';
  return 'fr';
}

function publicLocale(lang: PublicLang): string {
  if (lang === 'en') return 'en-GB';
  if (lang === 'es') return 'es-ES';
  return 'fr-FR';
}

function labelFor(labels: Record<string, string>, value?: string | null): string {
  if (!value) return '—';
  return labels[value] ?? value;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function publicAssetRef(raw: any) {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value || /^file:\/\//i.test(value)) return '';
  return value;
}

function publicPhotoRef(photo: any) {
  const raw =
    photo?.uri ??
    photo?.photoUri ??
    photo?.photo_uri ??
    photo?.url ??
    photo?.public_url ??
    photo?.publicUrl ??
    photo?.signed_url ??
    photo?.signedUrl ??
    photo?.download_url ??
    photo?.downloadUrl ??
    photo?.storage_path ??
    photo?.storagePath ??
    photo?.file_path ??
    photo?.filePath ??
    photo?.path ??
    '';
  return publicAssetRef(raw);
}

function publicReservePhotoItems(reserve: any, photoRows: any[] = []) {
  const embeddedPhotos = Array.isArray(reserve?.photos) ? reserve.photos : [];
  const legacyUri = reserve?.photo_uri ?? reserve?.photoUri;
  const legacyPhotos = legacyUri ? [{ id: `${reserve.id}-legacy`, uri: legacyUri, comment: 'Photo' }] : [];
  const tablePhotos = photoRows.filter(photo => {
    const reserveId = photo.reserve_id ?? photo.reserveId;
    return !reserveId || String(reserveId) === String(reserve.id);
  });
  const byKey = new Map<string, any>();
  [...embeddedPhotos, ...legacyPhotos, ...tablePhotos].forEach(photo => {
    const uri = publicPhotoRef(photo);
    if (!uri) return;
    byKey.set(String(photo.id ?? uri), { ...photo, uri });
  });
  return Array.from(byKey.values());
}

async function signedPublicReservePhotos(supabase: any, reserveId: string, photoItems: any[]) {
  const refs = Array.from(new Set(
    photoItems.map(photo => String(photo?.uri ?? '').trim()).filter(Boolean),
  ));
  const passthrough = new Set(refs.filter(ref => /^(data:|blob:)/i.test(ref)));
  const requested = refs.filter(ref => !passthrough.has(ref));
  const signedByRef = new Map<string, string>();
  if (requested.length > 0) {
    const { data, error } = await supabase.rpc('server_get_public_reserve_media', {
      p_reserve_id: reserveId,
      p_refs: requested.slice(0, 100),
    });
    if (error) {
      console.warn('[public reserve] résolution média refusée:', error.message);
    } else {
      await Promise.all((data ?? []).map(async (asset: any) => {
        let url = '';
        if (asset.provider === 'r2') {
          url = (await presignR2Read(asset.object_key, 600)).url;
        } else {
          const { data: signed, error: signError } = await supabase.storage
            .from(asset.bucket)
            .createSignedUrl(asset.object_key, 600);
          if (!signError) url = signed?.signedUrl ?? '';
        }
        if (url) signedByRef.set(String(asset.requested_ref), url);
      }));
    }
  }
  return photoItems.flatMap(photo => {
    const ref = String(photo?.uri ?? '');
    const uri = passthrough.has(ref) ? ref : signedByRef.get(ref);
    return uri ? [{ ...photo, uri }] : [];
  });
}

// Les dates en base sont du texte hérité de 2 formats : ISO (web) et dd/mm/yyyy (mobile).
function parsePublicDate(value?: string | null): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw || raw === '—' || raw === 'â€”') return null;
  const fr = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (fr) {
    const date = new Date(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]), Number(fr[4] ?? 0), Number(fr[5] ?? 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isPublicReserveOverdue(reserve: any): boolean {
  if (!reserve?.deadline || ['closed', 'verification'].includes(String(reserve.status ?? ''))) return false;
  const deadline = parsePublicDate(reserve.deadline);
  if (!deadline) return false;
  deadline.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return deadline < today;
}

function fmtDate(value?: string | null, lang: PublicLang = 'fr'): string {
  const date = parsePublicDate(value);
  if (!date) return '—';
  return date.toLocaleDateString(publicLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' });
}

function ErrorPage({ title, message, lang = 'fr' }: { title: string; message: string; lang?: PublicLang }) {
  return (
    <div style={S.page}>
      <div style={S.card}>
        <Header />
        <div style={{ padding: 40, textAlign: 'center' as const }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <h1 style={{ color: BRAND, fontSize: 22, margin: '0 0 12px' }}>{title}</h1>
          <p style={{ color: '#5E738A', fontSize: 14, lineHeight: 1.5 }}>{message}</p>
        </div>
        <Footer lang={lang} />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div style={{ background: BRAND, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 40, height: 40, background: ACCENT, color: BRAND,
        borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: 22,
      }}>B</div>
      <div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>Bouygues</div>
        <div style={{ color: '#FFFFFFB0', fontSize: 12 }}>Construction — BuildTrack</div>
      </div>
    </div>
  );
}

function Footer({ lang = 'fr' }: { lang?: PublicLang }) {
  const c = PUBLIC_COPY[lang] ?? PUBLIC_COPY.fr;
  return (
    <div style={{ background: '#F4F7FB', padding: '16px 24px', textAlign: 'center' as const, color: '#8899BB', fontSize: 11 }}>
      {c.footer}
    </div>
  );
}

export default async function ReservePublicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; lang?: string }>;
}) {
  const { id } = await params;
  const { t, lang: langParam } = await searchParams;
  const lang = publicLang(langParam);
  const c = PUBLIC_COPY[lang] ?? PUBLIC_COPY.fr;

  if (!t) {
    return <ErrorPage lang={lang} title={c.invalidLinkTitle} message={c.invalidLinkText} />;
  }

  let payload;
  try {
    payload = verifyReserveToken(t, id);
  } catch (e: any) {
    return <ErrorPage lang={lang} title={c.configMissingTitle} message={e?.message ?? c.serviceUnavailable} />;
  }
  if (!payload) {
    return <ErrorPage lang={lang} title={c.expiredTitle} message={c.expiredText} />;
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return <ErrorPage lang={lang} title={c.serviceUnavailable} message={c.dbMissingText} />;
  }

  const { data: reserve } = await supabase
    .from('reserves')
    .select('id, title, description, building, level, zone, company, companies, priority, status, deadline, created_at, chantier_id, comments, history, photo_uri, photos')
    .eq('id', id)
    .maybeSingle();

  if (!reserve) {
    return <ErrorPage lang={lang} title={c.notFoundTitle} message={c.notFoundText} />;
  }

  const [{ data: chantier }, { data: photoRows }] = await Promise.all([
    reserve.chantier_id
      ? supabase.from('chantiers').select('id, name').eq('id', reserve.chantier_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
    supabase
      .from('photos')
      .select('*')
      .eq('reserve_id', id)
      .order('taken_at', { ascending: false })
      .limit(20),
  ]);
  const photos = await signedPublicReservePhotos(
    supabase,
    id,
    publicReservePhotoItems(reserve, photoRows ?? []),
  );

  const prio = {
    label: labelFor(c.priorityLabels, reserve.priority),
    color: getReservePriorityColor(reserve.priority),
  };
  const stat = {
    label: labelFor(c.statusLabels, reserve.status),
    color: getReserveStatusColor(reserve.status),
  };
  const descriptionText = getReserveDescriptionText(reserve.description, reserve.title, '');
  const locParts = [reserve.building, reserve.level, reserve.zone].filter(Boolean);
  const involvedCompanies: string[] = Array.isArray(reserve.companies)
    ? (reserve.companies as string[])
    : (reserve.company ? [reserve.company] : []);

  const comments: any[] = Array.isArray(reserve.comments) ? reserve.comments : [];
  const history: any[] = Array.isArray(reserve.history) ? reserve.history : [];

  return (
    <div style={S.page}>
      <div style={S.card}>
        <Header />

        <div style={{ padding: '24px 28px' }}>
          {/* Title block */}
          <div style={{
            borderLeft: `4px solid ${prio.color}`,
            paddingLeft: 14, marginBottom: 18,
          }}>
            <div style={{ fontSize: 11, color: '#8899BB', textTransform: 'uppercase' as const, letterSpacing: 0.5, fontWeight: 700 }}>
              {c.ref} {reserve.id.slice(0, 8)}
            </div>
            <h1 style={{ color: BRAND, fontSize: 22, margin: '4px 0 10px', lineHeight: 1.25 }}>
              {reserve.title}
            </h1>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
              <Badge color={prio.color} text={prio.label.toUpperCase()} />
              <Badge color={stat.color} text={stat.label.toUpperCase()} />
            </div>
          </div>

          <Section label={c.project}>
            {chantier?.name ?? <em style={{ color: '#8899BB' }}>{c.noProject}</em>}
          </Section>

          {locParts.length > 0 && (
            <Section label={c.location}>{locParts.join(' • ')}</Section>
          )}

          {involvedCompanies.length > 0 && (
            <Section label={c.companies}>{involvedCompanies.join(', ')}</Section>
          )}

          <Section label={c.deadline}>
            <span style={{ color: isPublicReserveOverdue(reserve) ? '#DC2626' : BRAND, fontWeight: 600 }}>
              {fmtDate(reserve.deadline, lang)}
            </span>
          </Section>

          <Section label={c.createdOn}>{fmtDate(reserve.created_at, lang)}</Section>

          {descriptionText && (
            <div style={{ margin: '18px 0' }}>
              <div style={S.sectionLabel}>{c.description}</div>
              <div style={{
                background: '#F4F7FB', padding: 14, borderRadius: 8,
                color: '#334155', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const,
              }}>
                {descriptionText}
              </div>
            </div>
          )}

          {photos && photos.length > 0 && (
            <div style={{ margin: '18px 0' }}>
              <div style={S.sectionLabel}>{c.photos} ({photos.length})</div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 8,
              }}>
                {photos.map((p: any) => (
                  <a key={p.id ?? p.uri} href={p.uri} target="_blank" rel="noopener noreferrer"
                     style={{ display: 'block', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 6, background: '#E5EAF1' }}>
                    {p.uri && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.uri} alt={p.comment || c.photoAlt}
                           style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {comments.length > 0 && (
            <div style={{ margin: '18px 0' }}>
              <div style={S.sectionLabel}>{c.comments} ({comments.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                {comments.slice(-10).map((comment: any, i: number) => (
                  <div key={i} style={{ background: '#F4F7FB', padding: '10px 12px', borderRadius: 6, fontSize: 13 }}>
                    <div style={{ color: '#5E738A', fontSize: 11, marginBottom: 4 }}>
                      <strong style={{ color: BRAND }}>{comment.author ?? comment.by ?? c.anonymous}</strong>
                      {comment.created_at || comment.at ? <> — {fmtDate(comment.created_at ?? comment.at, lang)}</> : null}
                    </div>
                    <div style={{ color: '#1F2937', whiteSpace: 'pre-wrap' as const }}>{comment.text ?? comment.content ?? String(comment)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div style={{ margin: '18px 0' }}>
              <div style={S.sectionLabel}>{c.history}</div>
              <ul style={{ margin: 0, padding: '0 0 0 18px', color: '#5E738A', fontSize: 12, lineHeight: 1.6 }}>
                {history.slice(-8).map((h: any, i: number) => (
                  <li key={i}>
                    {h.at ? <span style={{ color: '#8899BB' }}>{fmtDate(h.at, lang)} — </span> : null}
                    {h.action ?? h.text ?? JSON.stringify(h)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
            <a
              href={`buildtrack://reserve/${encodeURIComponent(reserve.id)}`}
              style={{
                display: 'block', textAlign: 'center' as const,
                background: BRAND, color: '#fff', textDecoration: 'none',
                padding: '14px 20px', borderRadius: 8, fontWeight: 700, fontSize: 14,
              }}
            >
              {c.openApp}
            </a>
            <div style={{ padding: 12, background: '#FFF8E1', borderRadius: 8, fontSize: 12, color: '#7A5C00', textAlign: 'center' as const }}>
              {c.actionHint}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' as const, fontSize: 11, color: '#8899BB' }}>
              {c.noApp}
              <a href="https://apps.apple.com/app/buildtrack" style={{ color: BRAND, textDecoration: 'none', fontWeight: 600 }}>App Store</a>
              <span>·</span>
              <a href="https://play.google.com/store/apps/details?id=com.buildtrack.app" style={{ color: BRAND, textDecoration: 'none', fontWeight: 600 }}>Google Play</a>
            </div>
          </div>
        </div>

        <Footer lang={lang} />
      </div>
    </div>
  );
}

function Badge({ color, text }: { color: string; text: string }) {
  return (
    <span style={{
      background: color + '18', color, fontSize: 11, fontWeight: 700,
      padding: '4px 10px', borderRadius: 12, letterSpacing: 0.3,
    }}>{text}</span>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 0', fontSize: 14, borderBottom: '1px solid #EEF2F7' }}>
      <div style={{ color: '#8899BB', fontSize: 12, fontWeight: 600, minWidth: 110 }}>{label}</div>
      <div style={{ color: BRAND, flex: 1 }}>{children}</div>
    </div>
  );
}

const S = {
  page: {
    minHeight: '100vh',
    background: '#EEF2F7',
    padding: '24px 12px',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  } as const,
  card: {
    maxWidth: 720,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 12,
    overflow: 'hidden' as const,
    boxShadow: '0 4px 24px rgba(26,39,66,0.08)',
  },
  sectionLabel: {
    color: '#8899BB', fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 8,
  },
};
