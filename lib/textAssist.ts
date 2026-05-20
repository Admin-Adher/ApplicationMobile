export type TextAssistLanguage = 'fr' | 'en' | 'es';
export type TextAssistContext = 'description' | 'comment' | 'message' | 'generic';

export const TEXT_ASSIST_LANGUAGES: Array<{ code: TextAssistLanguage; label: string; title: string }> = [
  { code: 'fr', label: 'FR', title: 'Francais' },
  { code: 'en', label: 'EN', title: 'Anglais' },
  { code: 'es', label: 'ES', title: 'Espagnol' },
];

type LexiconEntry = Record<TextAssistLanguage, string[]>;

const TEXT_ASSIST_TRANSLATION_CACHE_VERSION = 'v2';

const PHRASEBOOK: LexiconEntry[] = [
  { fr: ['aucune description fournie', 'pas de description'], en: ['no description provided'], es: ['sin descripcion'] },
  { fr: ['aucun commentaire', 'pas de commentaire'], en: ['no comment'], es: ['sin comentario'] },
  { fr: ['merci de traiter cette reserve'], en: ['please handle this punch item'], es: ['por favor gestionar esta incidencia'] },
  { fr: ['merci de traiter', 'merci de prendre en charge'], en: ['please handle'], es: ['por favor gestionar'] },
  { fr: ['merci de verifier', 'a verifier svp'], en: ['please check'], es: ['por favor verificar'] },
  { fr: ['merci de corriger'], en: ['please correct'], es: ['por favor corregir'] },
  { fr: ['merci de confirmer'], en: ['please confirm'], es: ['por favor confirmar'] },
  { fr: ['peux tu verifier', 'pouvez vous verifier'], en: ['can you check'], es: ['puedes verificar'] },
  { fr: ['besoin d un retour', 'besoin de retour'], en: ['feedback needed'], es: ['se necesita respuesta'] },
  { fr: ['je suis sur place'], en: ['I am on site'], es: ['estoy en obra'] },
  { fr: ['intervention a planifier'], en: ['intervention to be scheduled'], es: ['intervencion por planificar'] },
  { fr: ['intervention planifiee'], en: ['intervention scheduled'], es: ['intervencion planificada'] },
  { fr: ['intervention faite', 'intervention realisee'], en: ['intervention completed'], es: ['intervencion realizada'] },
  { fr: ['travaux realises', 'travaux termines'], en: ['works completed'], es: ['trabajos realizados'] },
  { fr: ['travaux non termines'], en: ['works not completed'], es: ['trabajos no terminados'] },
  { fr: ['travaux en cours'], en: ['works in progress'], es: ['trabajos en curso'] },
  { fr: ['demande de levee'], en: ['clearance request'], es: ['solicitud de levantamiento'] },
  { fr: ['reserve levee'], en: ['punch item cleared'], es: ['incidencia levantada'] },
  { fr: ['reserve a lever'], en: ['punch item to clear'], es: ['incidencia por levantar'] },
  { fr: ['non conforme'], en: ['non-compliant'], es: ['no conforme'] },
  { fr: ['conforme apres verification'], en: ['compliant after verification'], es: ['conforme tras verificacion'] },
  { fr: ['action attendue'], en: ['expected action'], es: ['accion esperada'] },
  { fr: ['a valider'], en: ['to be validated'], es: ['por validar'] },
  { fr: ['a planifier'], en: ['to be scheduled'], es: ['por planificar'] },
  { fr: ['a reprendre'], en: ['to be redone'], es: ['por rehacer'] },
  { fr: ['a corriger'], en: ['to be corrected'], es: ['por corregir'] },
  { fr: ['a nettoyer'], en: ['to be cleaned'], es: ['por limpiar'] },
  { fr: ['a remplacer'], en: ['to be replaced'], es: ['por reemplazar'] },
  { fr: ['a poser'], en: ['to be installed'], es: ['por instalar'] },
  { fr: ['a deposer'], en: ['to be removed'], es: ['por retirar'] },
  { fr: ['avant reception'], en: ['before handover'], es: ['antes de la recepcion'] },
  { fr: ['pendant la visite'], en: ['during the inspection'], es: ['durante la visita'] },
  { fr: ['au rdc', 'en rdc'], en: ['on the ground floor'], es: ['en planta baja'] },
  { fr: ['au niveau rdc'], en: ['on ground floor level'], es: ['en el nivel planta baja'] },
  { fr: ['dans la zone cuisine', 'zone cuisine'], en: ['in the kitchen area'], es: ['en la zona de cocina'] },
  { fr: ['dans la zone sanitaire', 'zone sanitaire'], en: ['in the sanitary area'], es: ['en la zona sanitaria'] },
  { fr: ['dans la zone'], en: ['in the area'], es: ['en la zona'] },
  { fr: ['dans le batiment'], en: ['in the building'], es: ['en el edificio'] },
  { fr: ['dans le logement'], en: ['in the unit'], es: ['en la vivienda'] },
  { fr: ['dans la piece'], en: ['in the room'], es: ['en la sala'] },
  { fr: ['dans la cuisine'], en: ['in the kitchen'], es: ['en la cocina'] },
  { fr: ['dans la salle de bain', 'dans la sdb'], en: ['in the bathroom'], es: ['en el bano'] },
  { fr: ['dans le couloir'], en: ['in the corridor'], es: ['en el pasillo'] },
  { fr: ['dans la chambre'], en: ['in the bedroom'], es: ['en el dormitorio'] },
  { fr: ['dans le sejour'], en: ['in the living room'], es: ['en la sala de estar'] },
  { fr: ['photo ajoutee'], en: ['photo added'], es: ['foto agregada'] },
  { fr: ['voir photo', 'voir photos'], en: ['see photo'], es: ['ver foto'] },
  { fr: ['voir plan'], en: ['see drawing'], es: ['ver plano'] },
  { fr: ['la porte ne ferme pas', 'porte ne ferme pas'], en: ['the door does not close'], es: ['la puerta no cierra'] },
  { fr: ['la porte ferme mal', 'porte ferme mal'], en: ['the door closes poorly'], es: ['la puerta cierra mal'] },
  { fr: ['la porte est mal ajustee', 'porte mal ajustee'], en: ['the door is poorly adjusted'], es: ['la puerta esta mal ajustada'] },
  { fr: ['la fenetre ne ferme pas', 'fenetre ne ferme pas'], en: ['the window does not close'], es: ['la ventana no cierra'] },
  { fr: ['poignee manquante'], en: ['missing handle'], es: ['manilla faltante'] },
  { fr: ['joint silicone manquant'], en: ['missing silicone sealant'], es: ['junta de silicona faltante'] },
  { fr: ['joint a refaire'], en: ['sealant to be redone'], es: ['junta por rehacer'] },
  { fr: ['carrelage casse'], en: ['broken tile'], es: ['baldosa rota'] },
  { fr: ['carrelage fissure'], en: ['cracked tile'], es: ['baldosa fisurada'] },
  { fr: ['carrelage decolle'], en: ['loose tile'], es: ['baldosa despegada'] },
  { fr: ['plinthe manquante'], en: ['missing skirting board'], es: ['rodapie faltante'] },
  { fr: ['plinthe abimee'], en: ['damaged skirting board'], es: ['rodapie danado'] },
  { fr: ['peinture a reprendre'], en: ['paint to be redone'], es: ['pintura por rehacer'] },
  { fr: ['retouche peinture'], en: ['paint touch-up'], es: ['retoque de pintura'] },
  { fr: ['fuite sous lavabo'], en: ['leak under washbasin'], es: ['fuga bajo el lavabo'] },
  { fr: ['fuite sous evier'], en: ['leak under sink'], es: ['fuga bajo el fregadero'] },
  { fr: ['infiltration au plafond'], en: ['water ingress at ceiling'], es: ['filtracion en el techo'] },
  { fr: ['trace d humidite'], en: ['moisture mark'], es: ['marca de humedad'] },
  { fr: ['nettoyage a faire'], en: ['cleaning required'], es: ['limpieza pendiente'] },
  { fr: ['zone non accessible'], en: ['area not accessible'], es: ['zona no accesible'] },
  { fr: ['acces impossible'], en: ['access impossible'], es: ['acceso imposible'] },
  { fr: ['rdv chantier', 'reunion chantier'], en: ['site meeting'], es: ['reunion de obra'] },
  { fr: ['probleme resolu'], en: ['issue resolved'], es: ['problema resuelto'] },
  { fr: ['probleme non resolu'], en: ['issue not resolved'], es: ['problema no resuelto'] },
  { fr: ['ne fonctionne pas'], en: ['does not work'], es: ['no funciona'] },
  { fr: ['fonctionne correctement'], en: ['works correctly'], es: ['funciona correctamente'] },
];

const LEXICON: LexiconEntry[] = [
  { fr: ['reserve', 'remarque'], en: ['punch item', 'observation'], es: ['incidencia', 'observacion'] },
  { fr: ['chantier', 'site'], en: ['construction site', 'site'], es: ['obra', 'sitio'] },
  { fr: ['entreprise'], en: ['company'], es: ['empresa'] },
  { fr: ['sous traitant'], en: ['subcontractor'], es: ['subcontratista'] },
  { fr: ['conducteur travaux'], en: ['site manager'], es: ['jefe de obra'] },
  { fr: ['maitre d ouvrage'], en: ['client'], es: ['promotor'] },
  { fr: ['maitre d oeuvre'], en: ['project manager'], es: ['direccion facultativa'] },
  { fr: ['batiment'], en: ['building'], es: ['edificio'] },
  { fr: ['niveau', 'etage'], en: ['level', 'floor'], es: ['nivel', 'planta'] },
  { fr: ['rez de chaussee', 'rdc'], en: ['ground floor', 'ground floor'], es: ['planta baja', 'planta baja'] },
  { fr: ['zone'], en: ['area'], es: ['zona'] },
  { fr: ['cuisine'], en: ['kitchen'], es: ['cocina'] },
  { fr: ['salle de bain', 'sdb'], en: ['bathroom'], es: ['bano'] },
  { fr: ['sanitaire'], en: ['sanitary area'], es: ['zona sanitaria'] },
  { fr: ['couloir'], en: ['corridor'], es: ['pasillo'] },
  { fr: ['chambre'], en: ['bedroom'], es: ['dormitorio'] },
  { fr: ['sejour'], en: ['living room'], es: ['sala de estar'] },
  { fr: ['bureau'], en: ['office'], es: ['oficina'] },
  { fr: ['hall'], en: ['lobby'], es: ['vestibulo'] },
  { fr: ['escalier'], en: ['staircase'], es: ['escalera'] },
  { fr: ['local technique'], en: ['technical room'], es: ['cuarto tecnico'] },
  { fr: ['piece', 'local'], en: ['room'], es: ['sala'] },
  { fr: ['logement'], en: ['unit'], es: ['vivienda'] },
  { fr: ['appartement'], en: ['apartment'], es: ['apartamento'] },
  { fr: ['plan'], en: ['drawing'], es: ['plano'] },
  { fr: ['epingle', 'pin'], en: ['pin'], es: ['pin'] },
  { fr: ['constat'], en: ['observation'], es: ['observacion'] },
  { fr: ['commentaire'], en: ['comment'], es: ['comentario'] },
  { fr: ['description'], en: ['description'], es: ['descripcion'] },
  { fr: ['priorite'], en: ['priority'], es: ['prioridad'] },
  { fr: ['urgent'], en: ['urgent'], es: ['urgente'] },
  { fr: ['critique'], en: ['critical'], es: ['critico'] },
  { fr: ['moyenne'], en: ['medium'], es: ['media'] },
  { fr: ['faible'], en: ['low'], es: ['baja'] },
  { fr: ['ouvert'], en: ['open'], es: ['abierto'] },
  { fr: ['en cours'], en: ['in progress'], es: ['en curso'] },
  { fr: ['en attente'], en: ['pending'], es: ['pendiente'] },
  { fr: ['verification'], en: ['verification'], es: ['verificacion'] },
  { fr: ['cloture'], en: ['closed'], es: ['cerrado'] },
  { fr: ['levee'], en: ['cleared'], es: ['levantada'] },
  { fr: ['refusee'], en: ['rejected'], es: ['rechazada'] },
  { fr: ['manquant', 'manquante', 'absence de'], en: ['missing', 'missing', 'missing'], es: ['faltante', 'faltante', 'falta de'] },
  { fr: ['endommage', 'abime', 'casse'], en: ['damaged', 'damaged', 'broken'], es: ['danado', 'danado', 'roto'] },
  { fr: ['sale'], en: ['dirty'], es: ['sucio'] },
  { fr: ['rayure'], en: ['scratch'], es: ['rayadura'] },
  { fr: ['fissure'], en: ['crack'], es: ['fisura'] },
  { fr: ['impact'], en: ['impact mark'], es: ['golpe'] },
  { fr: ['trace'], en: ['mark'], es: ['marca'] },
  { fr: ['tache'], en: ['stain'], es: ['mancha'] },
  { fr: ['infiltration'], en: ['water ingress'], es: ['filtracion'] },
  { fr: ['fuite'], en: ['leak'], es: ['fuga'] },
  { fr: ['humidite'], en: ['moisture'], es: ['humedad'] },
  { fr: ['peinture'], en: ['paint'], es: ['pintura'] },
  { fr: ['enduit'], en: ['plaster'], es: ['enlucido'] },
  { fr: ['poncage'], en: ['sanding'], es: ['lijado'] },
  { fr: ['rebouchage'], en: ['filling'], es: ['relleno'] },
  { fr: ['ragreage'], en: ['levelling compound'], es: ['mortero autonivelante'] },
  { fr: ['carrelage'], en: ['tiling'], es: ['baldosas'] },
  { fr: ['faience'], en: ['wall tiles'], es: ['azulejos'] },
  { fr: ['plinthe'], en: ['skirting board'], es: ['rodapie'] },
  { fr: ['joint'], en: ['sealant'], es: ['junta'] },
  { fr: ['silicone'], en: ['silicone sealant'], es: ['silicona'] },
  { fr: ['alignement'], en: ['alignment'], es: ['alineacion'] },
  { fr: ['niveau faux', 'faux niveau'], en: ['out of level'], es: ['desnivelado'] },
  { fr: ['fixation'], en: ['fixing'], es: ['fijacion'] },
  { fr: ['visserie'], en: ['screws'], es: ['tornilleria'] },
  { fr: ['porte'], en: ['door'], es: ['puerta'] },
  { fr: ['fenetre'], en: ['window'], es: ['ventana'] },
  { fr: ['poignee'], en: ['handle'], es: ['manilla'] },
  { fr: ['serrure'], en: ['lock'], es: ['cerradura'] },
  { fr: ['vitrage'], en: ['glazing'], es: ['cristal'] },
  { fr: ['volet'], en: ['shutter'], es: ['persiana'] },
  { fr: ['store'], en: ['blind'], es: ['estores'] },
  { fr: ['mur'], en: ['wall'], es: ['pared'] },
  { fr: ['cloison'], en: ['partition wall'], es: ['tabique'] },
  { fr: ['plafond'], en: ['ceiling'], es: ['techo'] },
  { fr: ['faux plafond'], en: ['suspended ceiling'], es: ['falso techo'] },
  { fr: ['sol'], en: ['floor'], es: ['suelo'] },
  { fr: ['seuil'], en: ['threshold'], es: ['umbral'] },
  { fr: ['facade'], en: ['facade'], es: ['fachada'] },
  { fr: ['toiture'], en: ['roof'], es: ['cubierta'] },
  { fr: ['etancheite'], en: ['waterproofing'], es: ['impermeabilizacion'] },
  { fr: ['electricite'], en: ['electrical works'], es: ['electricidad'] },
  { fr: ['prise'], en: ['socket'], es: ['enchufe'] },
  { fr: ['interrupteur'], en: ['switch'], es: ['interruptor'] },
  { fr: ['luminaire'], en: ['light fixture'], es: ['luminaria'] },
  { fr: ['tableau electrique'], en: ['electrical panel'], es: ['cuadro electrico'] },
  { fr: ['eclairage'], en: ['lighting'], es: ['iluminacion'] },
  { fr: ['baes'], en: ['emergency light'], es: ['luz de emergencia'] },
  { fr: ['ssi'], en: ['fire safety system'], es: ['sistema de seguridad contra incendios'] },
  { fr: ['plomberie'], en: ['plumbing'], es: ['fontaneria'] },
  { fr: ['evier'], en: ['sink'], es: ['fregadero'] },
  { fr: ['lavabo'], en: ['washbasin'], es: ['lavabo'] },
  { fr: ['robinet'], en: ['tap'], es: ['grifo'] },
  { fr: ['siphon'], en: ['trap'], es: ['sifon'] },
  { fr: ['wc', 'toilette'], en: ['toilet'], es: ['inodoro'] },
  { fr: ['ventilation'], en: ['ventilation'], es: ['ventilacion'] },
  { fr: ['vmc'], en: ['mechanical ventilation'], es: ['ventilacion mecanica'] },
  { fr: ['cvc'], en: ['HVAC'], es: ['climatizacion'] },
  { fr: ['climatisation'], en: ['air conditioning'], es: ['aire acondicionado'] },
  { fr: ['gaine'], en: ['duct'], es: ['conducto'] },
  { fr: ['reseau'], en: ['network'], es: ['red'] },
  { fr: ['nettoyage'], en: ['cleaning'], es: ['limpieza'] },
  { fr: ['dechet'], en: ['waste'], es: ['residuo'] },
  { fr: ['photo'], en: ['photo'], es: ['foto'] },
  { fr: ['signature'], en: ['signature'], es: ['firma'] },
  { fr: ['visite'], en: ['inspection'], es: ['visita'] },
  { fr: ['rapport'], en: ['report'], es: ['informe'] },
  { fr: ['rendez vous', 'rdv'], en: ['meeting'], es: ['cita'] },
];

const FILLER_PATTERNS = [
  /\bdu coup\b/gi,
  /\ben fait\b/gi,
  /\bgenre\b/gi,
  /\bun peu\b/gi,
  /\bje pense que\b/gi,
  /\bpeut[- ]etre\b/gi,
  /\bbah\b/gi,
  /\bben\b/gi,
  /\bvoila\b/gi,
  /\bdu coup la\b/gi,
  /\bon dirait que\b/gi,
  /\bil me semble que\b/gi,
  /\bje crois que\b/gi,
];

const SAFE_REWRITE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bpb\b/gi, 'probleme'],
  [/\brdv\b/gi, 'rendez-vous'],
  [/\bpas ok\b/gi, 'non conforme'],
  [/\bpas bon\b/gi, 'non conforme'],
  [/\bpas conforme\b/gi, 'non conforme'],
  [/\br\s*\+\s*(\d+)\b/gi, 'R+$1'],
  [/\brdc\b/gi, 'RDC'],
];

const REWRITE_CLEANUPS: Array<[RegExp, string]> = [
  [/\bpresence de absence de\b/gi, 'absence de'],
  [/\bpresence de fuite constatee\b/gi, 'fuite constatee'],
  [/\babsence de (la|le|les|un|une|l')\b/gi, 'absence de'],
  [/\bdefaut de fuite\b/gi, 'fuite constatee'],
  [/\bdefaut de probleme\b/gi, 'probleme'],
  [/\bmerci merci\b/gi, 'merci'],
  [/\s+merci$/gi, ''],
  [/\s+,/g, ','],
  [/\s+\./g, '.'],
  [/\s{2,}/g, ' '],
];

const ALL_TRANSLATION_ENTRIES = [...PHRASEBOOK, ...LEXICON];

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpaces(value: string): string {
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeForAssistant(value: string): string {
  return stripDiacritics(value)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');
}

function ensureFinalPunctuation(value: string): string {
  if (!value) return value;
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function capitalizeSentences(value: string): string {
  return value.replace(/(^|[.!?]\s+)([a-z])/g, (match, prefix, letter) =>
    `${prefix}${String(letter).toUpperCase()}`
  );
}

function normalizeFieldText(value: string): string {
  let next = normalizeSpaces(normalizeForAssistant(value));
  next = next.replace(/\s+([,.;:!?])/g, '$1');
  next = next.replace(/([,.;:!?])(?=\S)/g, '$1 ');
  next = next.replace(/\brdc\b/gi, 'RDC');
  next = next.replace(/\br\s*\+\s*(\d+)\b/gi, 'R+$1');
  next = ensureFinalPunctuation(next);
  return capitalizeSentences(next);
}

function applyRewriteCleanups(value: string): string {
  let next = value;
  for (const [pattern, replacement] of REWRITE_CLEANUPS) {
    next = next.replace(pattern, replacement);
  }
  return normalizeSpaces(next);
}

function termPattern(term: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(term)})(?=$|[^A-Za-z0-9_])`, 'gi');
}

function countTermMatches(text: string, term: string): number {
  return (text.match(termPattern(term)) ?? []).length;
}

export function detectTextLanguage(value: string): TextAssistLanguage {
  const normalized = ` ${normalizeForAssistant(value).toLowerCase()} `;
  const scores: Record<TextAssistLanguage, number> = { fr: 0, en: 0, es: 0 };

  const markers: Record<TextAssistLanguage, RegExp[]> = {
    fr: [/\b(le|les|des|une|avec|pour|dans|sur|pas|merci|reserve|chantier|niveau|batiment|travaux)\b/g],
    en: [/\b(the|and|with|for|in|on|not|please|building|level|site|work|defect|message|check)\b/g],
    es: [/\b(el|los|las|con|para|en|no|por favor|obra|edificio|nivel|reserva|mensaje|verificar)\b/g],
  };

  for (const lang of TEXT_ASSIST_LANGUAGES) {
    for (const marker of markers[lang.code]) {
      scores[lang.code] += (normalized.match(marker) ?? []).length;
    }
  }

  if (/[àâçéèêëîïôûùüÿæœ]/i.test(value)) scores.fr += 2;
  if (/[áíóúñ¿¡]/i.test(value)) scores.es += 2;

  for (const entry of ALL_TRANSLATION_ENTRIES) {
    for (const lang of TEXT_ASSIST_LANGUAGES) {
      for (const term of entry[lang.code]) {
        const matches = countTermMatches(normalized, normalizeForAssistant(term).toLowerCase());
        if (matches > 0) {
          scores[lang.code] += matches * Math.min(4, Math.max(1, term.split(/\s+/).length));
        }
      }
    }
  }

  const winner = TEXT_ASSIST_LANGUAGES
    .map(item => item.code)
    .sort((a, b) => scores[b] - scores[a])[0];
  return scores[winner] > 0 ? winner : 'fr';
}

export function rewriteConstructionText(value: string, _context: TextAssistContext = 'generic'): string {
  let next = normalizeSpaces(normalizeForAssistant(value));
  if (!next) return '';

  for (const pattern of FILLER_PATTERNS) {
    next = next.replace(pattern, '');
  }
  for (const [pattern, replacement] of SAFE_REWRITE_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  next = applyRewriteCleanups(next);
  return normalizeFieldText(next);
}

export function textAssistAdvancedCacheKey(value: string, target: TextAssistLanguage, source: TextAssistLanguage): string {
  let hash = 0;
  const base = `online:${source}:${target}:${normalizeForAssistant(value)}`;
  for (let i = 0; i < base.length; i += 1) {
    hash = ((hash << 5) - hash) + base.charCodeAt(i);
    hash |= 0;
  }
  return `buildtrack_text_translation_online_${TEXT_ASSIST_TRANSLATION_CACHE_VERSION}_${source}_${target}_${Math.abs(hash)}`;
}
