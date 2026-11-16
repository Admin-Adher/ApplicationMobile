/** Reports contain only embedded raster images and static markup. No active content or remote requests. */
export function validateMepReportHtml(value:unknown):string{
  if(typeof value!=='string'||value.length>19_000_000||!/<html[\s>]/i.test(value)||!/<\/html>/i.test(value))throw Error('Rapport MEP invalide ou trop volumineux.');
  if(/<(?:script|iframe|object|embed|link|base|form|input|video|audio|animate|animateMotion|animateTransform|set|foreignObject|use)\b|\son[a-z]+\s*=|javascript\s*:|@import|url\s*\(|<meta\b[^>]*http-equiv/i.test(value))throw Error('Contenu actif interdit dans le rapport MEP.');
  for(const attr of value.matchAll(/\b(?:src|href|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)){
    const uri=attr[1]??attr[2]??attr[3];if(!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(uri))throw Error('Le rapport doit contenir uniquement des images embarquées.');
  }
  const prefix=/^\s*(?:<!doctype html>\s*)?<html(?:\s+lang=["']fr["'])?\s*>\s*<head\s*>/i;
  if(!prefix.test(value))throw Error('En-tête du rapport manquant ou non canonique.');
  // Browser parsing, CSS escapes and SVG must not circumvent the no-network contract.
  return value.replace(prefix,head=>head+`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`);
}
