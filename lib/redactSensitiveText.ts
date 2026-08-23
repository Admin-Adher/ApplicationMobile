/**
 * Neutralisation des secrets dans un texte libre — module PUR.
 *
 * La liste blanche de `formatSyncFailureMessage` protege contre la
 * serialisation de proprietes arbitraires (`config`, `headers`, `request`),
 * mais pas contre le CONTENU des champs autorises. Un serveur, un SDK ou une
 * couche reseau peut placer dans `message`, `details` ou `hint` — ou renvoyer
 * directement une chaine — un jeton, une URL signee, une adresse e-mail ou un
 * chemin local.
 *
 * Ce texte finit dans `lastError`, persiste dans la file d'attente ET recopie
 * dans l'export de diagnostic que l'utilisateur colle dans un ticket support.
 *
 * On conserve volontairement l'hote et le chemin d'une URL : ils servent au
 * diagnostic et ne constituent pas un secret. Seule la valeur des parametres
 * sensibles est effacee.
 */

const REDACTED = '<expurge>';

/**
 * L'ORDRE est normatif : `Bearer eyJ...` doit etre traite comme un en-tete
 * avant que le motif JWT ne s'applique, sinon le mot-cle resterait seul et le
 * lecteur croirait a un en-tete vide plutot qu'a une valeur retiree.
 */
const REDACTION_PATTERNS: [RegExp, string][] = [
  // En-tetes d'autorisation, quel que soit le schema.
  [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // JWT isole : trois segments base64url, ou deux pour un jeton non signe.
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]+)?/g, REDACTED],
  // Valeurs sensibles en parametre d'URL — la cle reste lisible.
  [
    /([?&](?:access_token|refresh_token|api[_-]?key|apikey|token|signature|sig|secret|password|pwd|key)=)[^&\s"']*/gi,
    `$1${REDACTED}`,
  ],
  // Meme paire hors d'une URL : un `hint` de PostgREST ou un message de SDK
  // ecrit volontiers `apikey=...` en texte libre. `key` seul reste exclu ici —
  // « duplicate key = ... » est un message d'erreur legitime.
  [
    /\b(access_token|refresh_token|api[_-]?key|apikey|token|signature|secret|password|pwd)\s*[=:]\s*[^\s"',;]+/gi,
    `$1=${REDACTED}`,
  ],
  // Identifiants dans l'autorite d'une URL : https://user:motdepasse@hote
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@"']+:[^/\s@"']+@/gi, `$1${REDACTED}@`],
  // Chemins locaux : une photo de chantier, un fichier de session.
  [/\bfile:\/\/\S+/gi, REDACTED],
  [/\/(?:data|storage|Users|home|var|private)\/[^\s"',;\)]+/g, REDACTED],
  [/\b[A-Za-z]:\\[^\s"',;\)]+/g, REDACTED],
  // Adresses e-mail : donnee personnelle, jamais necessaire au diagnostic.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, REDACTED],
];

/**
 * Retire les secrets d'un texte destine a etre persiste ou exporte.
 *
 * Ne leve jamais : appelee sur le chemin d'echec, elle ne doit pas transformer
 * une erreur de synchronisation en plantage.
 */
export function redactSensitiveText(value: string): string {
  let output = value;
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}
