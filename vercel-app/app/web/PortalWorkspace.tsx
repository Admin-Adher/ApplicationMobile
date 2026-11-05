import Link from 'next/link';
import styles from './PortalWorkspace.module.css';

type PortalReserve = { id: string; title: string; building?: string; level?: string; status: string; deadline?: string };

export default function PortalWorkspace({
  company,
  reserves,
  loading,
  statusLabel,
}: {
  company?: string;
  reserves: PortalReserve[];
  loading: boolean;
  statusLabel: (status: string) => string;
}) {
  return (
    <main className={styles.page}>
      <header>
        <Link href="/web">BuildTrack</Link>
        <p>Portail sous-traitant</p>
        <h1>{company || 'Réserves de l’entreprise'}</h1>
      </header>
      {loading ? <p role="status">Chargement des réserves…</p> : !company ? (
        <p role="alert">Cette entreprise est inaccessible avec votre compte.</p>
      ) : reserves.length === 0 ? <p>Aucune réserve active pour cette entreprise.</p> : (
        <ul>
          {reserves.map(reserve => (
            <li key={reserve.id}>
              <Link href={'/web?reserve=' + encodeURIComponent(reserve.id)}>
                <strong>{reserve.title || reserve.id}</strong>
                <span>{[reserve.building, reserve.level, statusLabel(reserve.status), reserve.deadline === '—' ? '' : reserve.deadline].filter(Boolean).join(' · ')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
