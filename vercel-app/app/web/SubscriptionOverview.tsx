'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import styles from './web.module.css';

type Subscription = { status: string; started_at: string | null; trial_ends_at: string | null };
type License = { subscription: Subscription; plan: { name: string; max_users: number } | null };
const STATUS: Record<string, string> = { active: 'Actif', trial: 'Essai', trialing: 'Essai', suspended: 'Suspendu', cancelled: 'Résilié', expired: 'Expiré' };

export default function SubscriptionOverview({ organization, orgId, locale, openAdmin }: {
  organization: string; orgId: string; locale: string; openAdmin: () => void;
}) {
  const [license, setLicense] = useState<License | null>();
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      const { data, error } = await supabaseBrowser.from('subscriptions').select('status,plan_id,started_at,trial_ends_at')
        .eq('organization_id', orgId).abortSignal(controller.signal).maybeSingle();
      if (error) throw error;
      if (!data) { if (!controller.signal.aborted) setLicense(null); return; }
      const result = data.plan_id ? await supabaseBrowser.from('plans').select('name,max_users')
        .eq('id', data.plan_id).abortSignal(controller.signal).maybeSingle() : null;
      if (result?.error) throw result.error;
      if (!controller.signal.aborted) setLicense({ subscription: data, plan: result?.data ?? null });
    }
    void read().catch(() => { if (!controller.signal.aborted) setError('Les informations d’abonnement sont indisponibles.'); });
    return () => controller.abort();
  }, [orgId]);

  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
  return <section className={styles.panel}>
    <h2>Abonnement</h2>
    <p>{organization}</p>
    {error ? <p role="alert">{error}</p> : license === undefined ? <p role="status">Chargement de la licence…</p>
      : license === null ? <p>Aucun abonnement configuré pour cette organisation.</p> : <dl>
        <dt>Offre</dt><dd>{license.plan?.name ?? 'Licence de l’organisation'}</dd>
        <dt>Statut</dt><dd>{STATUS[license.subscription.status] ?? license.subscription.status}</dd>
        {license.plan && <><dt>Places</dt><dd>{license.plan.max_users === -1 ? 'Illimitées' : license.plan.max_users}</dd></>}
        {license.subscription.started_at && <><dt>Début</dt><dd>{date(license.subscription.started_at)}</dd></>}
        {license.subscription.trial_ends_at && <><dt>Fin de l’essai</dt><dd>{date(license.subscription.trial_ends_at)}</dd></>}
      </dl>}
    <button type="button" className={styles.settingsGhostButton} onClick={openAdmin}>Ouvrir Pilotage</button>
  </section>;
}
