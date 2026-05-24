import { ReserveStatus, ReservePriority } from '@/constants/types';
import { RESERVE_PRIORITY_COLORS, RESERVE_PRIORITY_LABELS } from '@/lib/reserveLabels';

export const RESERVE_BUILDINGS: string[] = [];
export const RESERVE_ZONES: string[] = [];
export const RESERVE_LEVELS: string[] = [];
export const RESERVE_PRIORITIES: { value: ReservePriority; label: string; color: string }[] = [
  { value: 'low', label: RESERVE_PRIORITY_LABELS.low, color: RESERVE_PRIORITY_COLORS.low },
  { value: 'medium', label: RESERVE_PRIORITY_LABELS.medium, color: RESERVE_PRIORITY_COLORS.medium },
  { value: 'high', label: RESERVE_PRIORITY_LABELS.high, color: RESERVE_PRIORITY_COLORS.high },
  { value: 'critical', label: RESERVE_PRIORITY_LABELS.critical, color: RESERVE_PRIORITY_COLORS.critical },
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

type ReserveTemplate = typeof RESERVE_TEMPLATES[number];

const RESERVE_TEMPLATES_EN: ReserveTemplate[] = [
  { category: 'Structural work', icon: 'construct-outline', items: [
    { title: 'Render crack', description: 'Crack observed in the render. Repair with a suitable product and matching finish colour.' },
    { title: 'Render repair', description: 'Defective render area to be repaired. Check adhesion and finish consistency.' },
    { title: 'Floor levelling', description: 'Floor to be levelled before final floor covering. Respect reference levels.' },
    { title: 'Moisture / staining', description: 'Moisture marks observed. Identify the source, infiltration or condensation, then treat.' },
    { title: 'Exposed reinforcement', description: 'Concrete reinforcement is exposed. Anti-corrosion treatment and concrete repair required.' },
  ] },
  { category: 'Joinery', icon: 'grid-outline', items: [
    { title: 'Door adjustment', description: 'Door is poorly adjusted: difficult closing or obstruction. Adjust hinges.' },
    { title: 'Missing seal', description: 'Seal is missing or detached on joinery. Replace with a suitable seal.' },
    { title: 'Glass replacement', description: 'Glass is cracked, broken or not compliant with specifications. Replacement required.' },
    { title: 'Defective lock', description: 'Lock is blocked, key is hard to turn or mechanism is faulty. Replacement required.' },
    { title: 'Missing threshold', description: 'Door threshold is missing or poorly installed. Install and finish to ensure watertightness.' },
  ] },
  { category: 'Painting / Finishes', icon: 'color-palette-outline', items: [
    { title: 'Paint touch-up', description: 'Paint is scratched, missing or poorly applied. Touch up with the same colour.' },
    { title: 'Plaster crack', description: 'Crack in interior plaster or coating. Fill, sand and repaint.' },
    { title: 'Finish stains', description: 'Dirt or stains on finishes. Clean or replace the covering as required.' },
    { title: 'Unprotected corner', description: 'Sharp corner without protection profile. Install a suitable corner trim.' },
    { title: 'Incomplete suspended ceiling', description: 'Suspended ceiling tile or board missing or poorly installed. Complete and align.' },
  ] },
  { category: 'Electrical', icon: 'flash-outline', items: [
    { title: 'Socket not working', description: 'Power socket out of service. Electrical check and repair required.' },
    { title: 'Missing switch', description: 'Switch or cover plate missing. Complete installation and finish.' },
    { title: 'Missing light fixture', description: 'Light point not equipped: cable not connected or fixture not installed.' },
    { title: 'Incomplete panel', description: 'Electrical panel incomplete, unlabeled or missing protections. Bring into compliance.' },
    { title: 'Unprotected cable', description: 'Visible cable without protective conduit. Add conduit or make good.' },
  ] },
  { category: 'Plumbing', icon: 'water-outline', items: [
    { title: 'Leak observed', description: 'Water leak detected. Locate precisely and repair immediately.' },
    { title: 'Defective tapware', description: 'Tap is dripping or mechanism is faulty. Replace gasket or cartridge.' },
    { title: 'Blocked drain', description: 'Drain is blocked. Unblock and check the network.' },
    { title: 'Missing trap', description: 'Trap missing or not installed on drain point. Install before use.' },
    { title: 'Insufficient pressure', description: 'Insufficient water pressure at draw-off point. Check reducer and network.' },
  ] },
  { category: 'Floor / Wall coverings', icon: 'layers-outline', items: [
    { title: 'Cracked tile', description: 'Tile cracked or debonded. Remove and reinstall with suitable mortar.' },
    { title: 'Poorly laid parquet', description: 'Parquet boards are warped, misaligned or poorly fixed. Re-laying required.' },
    { title: 'Tile grout', description: 'Tile grout missing, incomplete or colour not compliant. Complete grout.' },
    { title: 'Missing skirting boards', description: 'Skirting boards missing or incomplete. Install and finish corners.' },
    { title: 'Non-compliant covering', description: 'Covering not compliant with specification: colour, material or dimensions. Replacement required.' },
  ] },
];

const RESERVE_TEMPLATES_ES: ReserveTemplate[] = [
  { category: 'Obra gruesa', icon: 'construct-outline', items: [
    { title: 'Fisura en revestimiento', description: 'Fisura observada en el revestimiento. Reparar con producto adecuado y color de acabado previsto.' },
    { title: 'Reparación de revestimiento', description: 'Zona de revestimiento defectuosa a reparar. Verificar adherencia y homogeneidad.' },
    { title: 'Nivelación de suelo', description: 'Suelo a nivelar antes del revestimiento final. Respetar los niveles de referencia.' },
    { title: 'Humedad / manchas', description: 'Manchas de humedad observadas. Identificar origen, infiltración o condensación, y tratar.' },
    { title: 'Armadura expuesta', description: 'Armadura de hormigón expuesta. Tratamiento anticorrosión y reparación del hormigón requeridos.' },
  ] },
  { category: 'Carpintería', icon: 'grid-outline', items: [
    { title: 'Ajuste de puerta', description: 'Puerta mal ajustada: cierre difícil u obstrucción. Ajustar bisagras.' },
    { title: 'Junta faltante', description: 'Junta de estanqueidad ausente o despegada. Sustituir por junta adecuada.' },
    { title: 'Cristal a sustituir', description: 'Cristal fisurado, roto o no conforme a especificaciones. Sustitución necesaria.' },
    { title: 'Cerradura defectuosa', description: 'Cerradura bloqueada, llave difícil de girar o mecanismo defectuoso. Sustitución requerida.' },
    { title: 'Umbral faltante', description: 'Umbral de puerta ausente o mal instalado. Colocación y acabado para asegurar estanqueidad.' },
  ] },
  { category: 'Pintura / Acabados', icon: 'color-palette-outline', items: [
    { title: 'Repaso de pintura', description: 'Pintura rayada, faltante o mal aplicada. Repasar con el mismo color.' },
    { title: 'Fisura en yeso', description: 'Fisura en yeso o revestimiento interior. Rellenar, lijar y repintar.' },
    { title: 'Manchas en acabados', description: 'Suciedad o manchas en acabados. Limpiar o sustituir el revestimiento.' },
    { title: 'Esquina sin protección', description: 'Esquina viva sin perfil de protección. Instalar perfil adecuado.' },
    { title: 'Falso techo incompleto', description: 'Placa de falso techo faltante o mal colocada. Completar y alinear.' },
  ] },
  { category: 'Electricidad', icon: 'flash-outline', items: [
    { title: 'Toma no funciona', description: 'Toma de corriente fuera de servicio. Revisión eléctrica y reparación obligatorias.' },
    { title: 'Interruptor faltante', description: 'Interruptor o placa ausente. Finalizar instalación y acabado.' },
    { title: 'Luminaria ausente', description: 'Punto de luz sin equipar: cable no conectado o luminaria no instalada.' },
    { title: 'Cuadro incompleto', description: 'Cuadro eléctrico incompleto, sin etiquetas o con protecciones faltantes. Poner en conformidad.' },
    { title: 'Cable sin tubo', description: 'Cable visible sin conducto de protección. Colocar tubo o reparar acabado.' },
  ] },
  { category: 'Fontanería', icon: 'water-outline', items: [
    { title: 'Fuga observada', description: 'Fuga de agua detectada. Localizar con precisión y reparar inmediatamente.' },
    { title: 'Grifería defectuosa', description: 'Grifo que gotea o mecanismo defectuoso. Sustituir junta o cartucho.' },
    { title: 'Desagüe obstruido', description: 'Desagüe obstruido. Desatascar y verificar la red.' },
    { title: 'Sifón faltante', description: 'Sifón ausente o no instalado en punto de evacuación. Instalar antes del uso.' },
    { title: 'Presión insuficiente', description: 'Presión de agua insuficiente en el punto de consumo. Verificar reductor y red.' },
  ] },
  { category: 'Revestimientos', icon: 'layers-outline', items: [
    { title: 'Baldosa fisurada', description: 'Baldosa fisurada o despegada. Retirar y colocar de nuevo con mortero adecuado.' },
    { title: 'Parquet mal instalado', description: 'Lamas de parquet abombadas, desalineadas o mal fijadas. Reinstalación necesaria.' },
    { title: 'Junta de baldosas', description: 'Juntas de baldosas faltantes, incompletas o color no conforme. Completar.' },
    { title: 'Rodapiés faltantes', description: 'Rodapiés no colocados o incompletos. Instalar y rematar esquinas.' },
    { title: 'Revestimiento no conforme', description: 'Revestimiento no conforme al pliego: color, material o dimensiones. Sustitución requerida.' },
  ] },
];

export function getReserveTemplates(language?: string | null): ReserveTemplate[] {
  const normalized = String(language ?? '').toLowerCase();
  if (normalized.startsWith('en')) return RESERVE_TEMPLATES_EN;
  if (normalized.startsWith('es')) return RESERVE_TEMPLATES_ES;
  return RESERVE_TEMPLATES;
}

export function levelSortKey(name: string): number {
  const t = (name ?? '').trim();
  if (/^(rdc|r\.?d\.?c\.?|rc|rez)/i.test(t)) return 0;
  const m1 = t.match(/^r\s*([+\-])\s*(\d+)/i);
  if (m1) return parseInt(m1[2], 10) * (m1[1] === '-' ? -1 : 1);
  const m2 = t.match(/^([+\-]?\d+)$/);
  if (m2) return parseInt(m2[1], 10);
  const m3 = t.match(/(?:ss|s\.?s\.?|sous.?sol\s*)(\d+)/i);
  if (m3) return -parseInt(m3[1], 10);
  if (/sous.?sol|s\.?s\.?/i.test(t)) return -1;
  return 999;
}

export function compareLevels(a: string, b: string): number {
  const ka = levelSortKey(a);
  const kb = levelSortKey(b);
  if (ka !== kb) return ka - kb;
  return a.localeCompare(b, 'fr', { numeric: true });
}

export function genReserveId(reserves: { id: string }[], lot?: { code: string } | null): string {
  // Fix 4: append a short random suffix to avoid collision when two users create simultaneously
  const suffix = () => Math.random().toString(36).slice(2, 5).toUpperCase();
  if (lot?.code) {
    const prefix = lot.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const existing = new Set(reserves.map(r => r.id));
    let max = 0;
    for (const r of reserves) {
      const m = r.id.match(new RegExp(`^${prefix}-(\\d+)`));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    let next = max + 1;
    let candidate = `${prefix}-${String(next).padStart(3, '0')}-${suffix()}`;
    while (existing.has(candidate)) {
      next++;
      candidate = `${prefix}-${String(next).padStart(3, '0')}-${suffix()}`;
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
  let candidate = `RSV-${String(next).padStart(3, '0')}-${suffix()}`;
  while (existing.has(candidate)) {
    next++;
    candidate = `RSV-${String(next).padStart(3, '0')}-${suffix()}`;
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
