import { ReserveStatus, ReservePriority } from '@/constants/types';
import { C } from '@/constants/colors';

export const RESERVE_BUILDINGS = ['A', 'B', 'C'];
export const RESERVE_ZONES = ['Zone Nord', 'Zone Sud', 'Zone Est', 'Zone Ouest', 'Zone Centre'];
export const RESERVE_LEVELS = ['Sous-sol', 'RDC', 'R+1', 'R+2', 'R+3'];
export const RESERVE_PRIORITIES: { value: ReservePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Basse', color: C.low },
  { value: 'medium', label: 'Moyenne', color: C.medium },
  { value: 'high', label: 'Haute', color: C.high },
  { value: 'critical', label: 'Critique', color: C.critical },
];

export const RESERVE_TEMPLATES: { category: string; icon: string; items: { title: string; description: string }[] }[] = [
  {
    category: 'Gros oeuvre',
    icon: 'construct-outline',
    items: [
      { title: 'Fissure enduit', description: 'Fissure constatée sur l\'enduit. À reprendre avec produit adapté et teinte de finition.' },
      { title: 'Reprise enduit', description: 'Enduit à reprendre sur la zone défectueuse. Vérifier l\'accrochage et homogénéité.' },
      { title: 'Ragréage sol', description: 'Sol à ragrée avant pose de revêtement final. Respecter les niveaux de référence.' },
      { title: 'Humidité / traces', description: 'Traces d\'humidité constatées. Identifier l\'origine (infiltration / condensation) et traiter.' },
      { title: 'Ferraillage apparent', description: 'Armature béton apparente. Traitement anti-rouille et reprise du béton requis.' },
    ],
  },
  {
    category: 'Menuiseries',
    icon: 'grid-outline',
    items: [
      { title: 'Réglage porte', description: 'Porte mal réglée : fermeture difficile ou gêne au passage. Réglage des charnières requis.' },
      { title: 'Joint manquant', description: 'Joint d\'étanchéité absent ou décollé sur menuiserie. Remplacer avec joint adapté.' },
      { title: 'Vitre à remplacer', description: 'Vitrage fissuré / brisé ou non conforme aux spécifications. Remplacement nécessaire.' },
      { title: 'Serrure défectueuse', description: 'Serrure bloquée, clé ne tourne pas ou mécanisme défaillant. Remplacement requis.' },
      { title: 'Seuil manquant', description: 'Seuil de porte absent ou mal posé. Pose et finition requises pour assurer l\'étanchéité.' },
    ],
  },
  {
    category: 'Peinture / Finitions',
    icon: 'color-palette-outline',
    items: [
      { title: 'Peinture à reprendre', description: 'Peinture rayée, manquante ou mal appliquée. Reprise de peinture avec même teinte.' },
      { title: 'Fissure plâtrerie', description: 'Fissure sur enduit ou plâtre intérieur. Rebouchage, ponçage et reprise de peinture.' },
      { title: 'Salissures finitions', description: 'Salissures ou taches sur finitions. Nettoyage ou remplacement du revêtement requis.' },
      { title: 'Angle non protégé', description: 'Angle vif sans profilé de protection. Pose d\'un listel d\'angle requis.' },
      { title: 'Faux plafond incomplet', description: 'Dalle ou plaque de faux plafond manquante ou mal posée. Compléter et aligner.' },
    ],
  },
  {
    category: 'Électricité',
    icon: 'flash-outline',
    items: [
      { title: 'Prise non fonctionnelle', description: 'Prise de courant hors service. Vérification électrique et remise en état obligatoires.' },
      { title: 'Interrupteur manquant', description: 'Interrupteur absent ou plaque non posée. Finaliser l\'installation et la finition.' },
      { title: 'Luminaire absent', description: 'Point lumineux non équipé : câble non raccordé ou luminaire non posé.' },
      { title: 'Tableau incomplet', description: 'Tableau électrique incomplet, non étiqueté ou protections manquantes. Mise en conformité.' },
      { title: 'Câble non gainé', description: 'Câble apparent sans gaine de protection. Mise sous gaine ou rebouchage requis.' },
    ],
  },
  {
    category: 'Plomberie',
    icon: 'water-outline',
    items: [
      { title: 'Fuite constatée', description: 'Fuite d\'eau détectée. Localisation précise et réparation immédiate nécessaires.' },
      { title: 'Robinetterie défectueuse', description: 'Robinet qui goutte ou mécanisme défaillant. Remplacement du joint ou de la cartouche.' },
      { title: 'Évacuation bouchée', description: 'Évacuation obstruée : mauvaise évacuation constatée. Débouchage et vérification réseau.' },
      { title: 'Siphon manquant', description: 'Siphon absent ou non installé sur point d\'évacuation. Pose requise avant usage.' },
      { title: 'Pression insuffisante', description: 'Pression d\'eau insuffisante au point de puisage. Vérifier réducteur et réseau.' },
    ],
  },
  {
    category: 'Revêtements',
    icon: 'layers-outline',
    items: [
      { title: 'Carrelage fissuré', description: 'Carrelage fissuré ou décollé (bruit creux). Dépose et repose avec mortier adapté.' },
      { title: 'Parquet mal posé', description: 'Lames de parquet bombées, mal alignées ou mal fixées. Reprise de pose nécessaire.' },
      { title: 'Joint carrelage', description: 'Joints de carrelage manquants, incomplets ou teinte non conforme. À compléter.' },
      { title: 'Plinthes manquantes', description: 'Plinthes non posées ou incomplètes. Pose et finition aux angles requises.' },
      { title: 'Revêtement non conforme', description: 'Revêtement non conforme au CCTP (teinte, matériau, dimensions). Remplacement requis.' },
    ],
  },
];

export function genReserveId(reserves: { id: string }[], lot?: { code: string } | null): string {
  if (lot?.code) {
    const prefix = lot.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const existing = new Set(reserves.map(r => r.id));
    let max = 0;
    for (const r of reserves) {
      const m = r.id.match(new RegExp(`^${prefix}-(\\d+)$`));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    let next = max + 1;
    let candidate = `${prefix}-${String(next).padStart(3, '0')}`;
    while (existing.has(candidate)) {
      next++;
      candidate = `${prefix}-${String(next).padStart(3, '0')}`;
    }
    return candidate;
  }
  const existing = new Set(reserves.map(r => r.id));
  let max = 0;
  for (const r of reserves) {
    const m = r.id.match(/RSV-(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let next = max + 1;
  let candidate = `RSV-${String(next).padStart(3, '0')}`;
  while (existing.has(candidate)) {
    next++;
    candidate = `RSV-${String(next).padStart(3, '0')}`;
  }
  return candidate;
}

export function isOverdue(deadline: string, status: ReserveStatus): boolean {
  if (status === 'closed' || status === 'verification' || deadline === '—' || !deadline) return false;
  const parsed = parseDeadline(deadline);
  if (!parsed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
}

export function isDueSoon(deadline: string, status: ReserveStatus, days = 3): boolean {
  if (status === 'closed' || status === 'verification' || deadline === '—' || !deadline) return false;
  const parsed = parseDeadline(deadline);
  if (!parsed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + days);
  return parsed >= today && parsed <= limit;
}

export function parseDeadline(deadline: string): Date | null {
  if (!deadline || deadline === '—') return null;
  const parts = deadline.split('/');
  if (parts.length === 3) {
    const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(deadline);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(raw: string): string {
  if (!raw || raw === '—') return '—';
  const parts = raw.split('/');
  if (parts.length === 3) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [y, m, d] = raw.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return raw;
}

export function deadlineDaysLeft(deadline: string): number | null {
  const d = parseDeadline(deadline);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function validateDeadline(s: string): boolean {
  if (!s) return true;
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return false;
  const [d, m, y] = s.split('/').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getDate() === d && date.getMonth() === m - 1 && date.getFullYear() === y;
}

export function formatRelativeDate(dateStr: string): string {
  if (!dateStr || dateStr === '—') return '—';
  const date = parseDeadline(dateStr) ?? new Date(dateStr);
  if (!date || isNaN(date.getTime())) return formatDate(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "aujourd'hui";
  if (diffDays === 1) return 'hier';
  if (diffDays > 1 && diffDays < 7) return `il y a ${diffDays} j`;
  if (diffDays >= 7 && diffDays < 30) return `il y a ${Math.floor(diffDays / 7)} sem.`;
  if (diffDays >= 30) return formatDate(dateStr);
  if (diffDays < 0) return formatDate(dateStr);
  return formatDate(dateStr);
}
