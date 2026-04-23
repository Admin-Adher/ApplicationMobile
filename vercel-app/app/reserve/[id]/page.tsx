import { createClient } from '@supabase/supabase-js';
import { verifyReserveToken } from '@/lib/reserve-token';

export const dynamic = 'force-dynamic';

const BRAND = '#1A2742';
const ACCENT = '#FFCB00';

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critique', color: '#DC2626' },
  high:     { label: 'Haute',    color: '#EA580C' },
  medium:   { label: 'Moyenne',  color: '#D97706' },
  low:      { label: 'Faible',   color: '#16A34A' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open:         { label: 'Ouverte',    color: '#DC2626' },
  in_progress:  { label: 'En cours',   color: '#2563EB' },
  waiting:      { label: 'En attente', color: '#D97706' },
  verification: { label: 'À vérifier', color: '#7C3AED' },
  closed:       { label: 'Levée',      color: '#16A34A' },
};

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

function ErrorPage({ title, message }: { title: string; message: string }) {
  return (
    <div style={S.page}>
      <div style={S.card}>
        <Header />
        <div style={{ padding: 40, textAlign: 'center' as const }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <h1 style={{ color: BRAND, fontSize: 22, margin: '0 0 12px' }}>{title}</h1>
          <p style={{ color: '#5E738A', fontSize: 14, lineHeight: 1.5 }}>{message}</p>
        </div>
        <Footer />
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

function Footer() {
  return (
    <div style={{ background: '#F4F7FB', padding: '16px 24px', textAlign: 'center' as const, color: '#8899BB', fontSize: 11 }}>
      Page sécurisée par lien privé — ne pas partager. © Bouygues Construction
    </div>
  );
}

export default async function ReservePublicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;

  if (!t) {
    return <ErrorPage title="Lien invalide" message="Ce lien ne contient pas de jeton d'accès. Veuillez utiliser le lien envoyé par email." />;
  }

  let payload;
  try {
    payload = verifyReserveToken(t, id);
  } catch (e: any) {
    return <ErrorPage title="Configuration manquante" message={e?.message ?? 'Service indisponible.'} />;
  }
  if (!payload) {
    return <ErrorPage title="Lien expiré ou invalide" message="Le jeton d'accès est invalide ou a expiré. Demandez à l'expéditeur de vous renvoyer un nouvel email." />;
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return <ErrorPage title="Service indisponible" message="La connexion à la base de données n'est pas configurée." />;
  }

  const { data: reserve } = await supabase
    .from('reserves')
    .select('id, title, description, building, level, zone, company, companies, priority, status, deadline, created_at, chantier_id, comments, history')
    .eq('id', id)
    .maybeSingle();

  if (!reserve) {
    return <ErrorPage title="Réserve introuvable" message="Cette réserve a été supprimée ou n'existe plus." />;
  }

  const [{ data: chantier }, { data: photos }] = await Promise.all([
    reserve.chantier_id
      ? supabase.from('chantiers').select('id, name').eq('id', reserve.chantier_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
    supabase
      .from('photos')
      .select('id, comment, location, taken_at, taken_by, uri')
      .eq('reserve_id', id)
      .order('taken_at', { ascending: false })
      .limit(20),
  ]);

  const prio = PRIORITY_LABELS[reserve.priority] ?? PRIORITY_LABELS.medium;
  const stat = STATUS_LABELS[reserve.status] ?? { label: reserve.status, color: BRAND };
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
              Réf. {reserve.id.slice(0, 8)}
            </div>
            <h1 style={{ color: BRAND, fontSize: 22, margin: '4px 0 10px', lineHeight: 1.25 }}>
              {reserve.title}
            </h1>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
              <Badge color={prio.color} text={prio.label.toUpperCase()} />
              <Badge color={stat.color} text={stat.label.toUpperCase()} />
            </div>
          </div>

          <Section label="Chantier">
            {chantier?.name ?? <em style={{ color: '#8899BB' }}>Non rattaché</em>}
          </Section>

          {locParts.length > 0 && (
            <Section label="Localisation">{locParts.join(' • ')}</Section>
          )}

          {involvedCompanies.length > 0 && (
            <Section label="Entreprise(s)">{involvedCompanies.join(', ')}</Section>
          )}

          <Section label="Échéance">
            <span style={{ color: reserve.deadline && reserve.status !== 'closed' && new Date(reserve.deadline) < new Date() ? '#DC2626' : '#1A2742', fontWeight: 600 }}>
              {fmtDate(reserve.deadline)}
            </span>
          </Section>

          <Section label="Créée le">{fmtDate(reserve.created_at)}</Section>

          {reserve.description && (
            <div style={{ margin: '18px 0' }}>
              <div style={S.sectionLabel}>Description</div>
              <div style={{
                background: '#F4F7FB', padding: 14, borderRadius: 8,
                color: '#334155', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const,
              }}>
                {reserve.description}
              </div>
            </div>
          )}

          {photos && photos.length > 0 && (
            <div style={{ margin: '18px 0' }}>
              <div style={S.sectionLabel}>Photos ({photos.length})</div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 8,
              }}>
                {photos.map((p: any) => (
                  <a key={p.id} href={p.uri} target="_blank" rel="noopener noreferrer"
                     style={{ display: 'block', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 6, background: '#E5EAF1' }}>
                    {p.uri && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.uri} alt={p.comment || 'photo'}
                           style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {comments.length > 0 && (
            <div style={{ margin: '18px 0' }}>
              <div style={S.sectionLabel}>Commentaires ({comments.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                {comments.slice(-10).map((c: any, i: number) => (
                  <div key={i} style={{ background: '#F4F7FB', padding: '10px 12px', borderRadius: 6, fontSize: 13 }}>
                    <div style={{ color: '#5E738A', fontSize: 11, marginBottom: 4 }}>
                      <strong style={{ color: BRAND }}>{c.author ?? c.by ?? 'Anonyme'}</strong>
                      {c.created_at || c.at ? <> — {fmtDate(c.created_at ?? c.at)}</> : null}
                    </div>
                    <div style={{ color: '#1F2937', whiteSpace: 'pre-wrap' as const }}>{c.text ?? c.content ?? String(c)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div style={{ margin: '18px 0' }}>
              <div style={S.sectionLabel}>Historique</div>
              <ul style={{ margin: 0, padding: '0 0 0 18px', color: '#5E738A', fontSize: 12, lineHeight: 1.6 }}>
                {history.slice(-8).map((h: any, i: number) => (
                  <li key={i}>
                    {h.at ? <span style={{ color: '#8899BB' }}>{fmtDate(h.at)} — </span> : null}
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
              Ouvrir dans l'app BuildTrack →
            </a>
            <div style={{ padding: 12, background: '#FFF8E1', borderRadius: 8, fontSize: 12, color: '#7A5C00', textAlign: 'center' as const }}>
              Pour ajouter un commentaire, modifier le statut ou téléverser une photo, ouvrez la réserve depuis l'application.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' as const, fontSize: 11, color: '#8899BB' }}>
              Pas encore l'app ?
              <a href="https://apps.apple.com/app/buildtrack" style={{ color: BRAND, textDecoration: 'none', fontWeight: 600 }}>App Store</a>
              <span>·</span>
              <a href="https://play.google.com/store/apps/details?id=com.buildtrack.app" style={{ color: BRAND, textDecoration: 'none', fontWeight: 600 }}>Google Play</a>
            </div>
          </div>
        </div>

        <Footer />
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
