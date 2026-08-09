export interface InventoryLabelFields {
  reference?: string;
  designation?: string;
  rawText?: string;
}

const REFERENCE_LABEL = /^(?:r[eé]f(?:[eé]rence)?|reference|ref|sku|article|art[ií]culo|item(?:\s*(?:no|number|n[°o]))?|part(?:\s*(?:no|number|n[°o]))?|c[oó]digo(?:\s*(?:article|art[ií]culo|produit|product|producto))?|mod[eè]le|model|modelo)\s*[:#=\-]?\s*(.+)$/i;
const DESIGNATION_LABEL = /^(?:d[eé]signation|designation|description|desc\.?|produit|producto|product(?:\s*name)?|article(?:\s*name)?|nombre)\s*[:#=\-]?\s*(.+)$/i;
const REFERENCE_TOKEN = /[A-Z0-9][A-Z0-9._/\-]{3,39}/gi;
const NOISE = /^(?:www\.|https?:|tel\.?|phone|fax|email|qty|quantit[eé]|quantity|lot|batch|date|made|fabricado|poids|weight|kg$)/i;

function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanReference(value: string): string {
  return value.replace(/^[\s:#=]+|[\s,;:]+$/g, '').trim();
}

function scoreReference(candidate: string, labelled: boolean, source: string): number {
  if (candidate.length < 4 || candidate.length > 40 || NOISE.test(candidate)) return -100;
  let score = labelled ? 8 : 0;
  if (/[A-Za-z]/.test(candidate) && /\d/.test(candidate)) score += 5;
  else if (/\d/.test(candidate)) score += 1;
  if (/[-._/]/.test(candidate)) score += 3;
  if (candidate === candidate.toUpperCase()) score += 1;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(candidate)) score -= 8;
  if (/^\d{13,}$/.test(candidate) && !labelled) score -= 4;
  if (source.length > 55 && !labelled) score -= 3;
  return score;
}

/** Extracts likely stock fields from noisy on-device OCR text. */
export function extractInventoryLabelFields(rawText: string): InventoryLabelFields {
  const lines = rawText.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const candidates: Array<{ value: string; score: number; lineIndex: number }> = [];
  let explicitDesignation: string | undefined;

  lines.forEach((line, lineIndex) => {
    const referenceMatch = line.match(REFERENCE_LABEL);
    const designationMatch = line.match(DESIGNATION_LABEL);
    if (designationMatch?.[1]) explicitDesignation = cleanLine(designationMatch[1]).slice(0, 120);

    const source = referenceMatch?.[1] ?? line;
    const labelled = Boolean(referenceMatch);
    const whole = cleanReference(source);
    if (labelled && whole) {
      candidates.push({ value: whole, score: scoreReference(whole, true, line), lineIndex });
    }
    for (const match of source.matchAll(REFERENCE_TOKEN)) {
      const value = cleanReference(match[0]);
      candidates.push({ value, score: scoreReference(value, labelled, line), lineIndex });
    }
  });

  candidates.sort((a, b) => b.score - a.score || a.lineIndex - b.lineIndex || b.value.length - a.value.length);
  const best = candidates.find(candidate => candidate.score >= 4);
  const reference = best?.value;

  const designation = explicitDesignation || lines.find((line, index) => {
    if (index === best?.lineIndex || REFERENCE_LABEL.test(line) || DESIGNATION_LABEL.test(line) || NOISE.test(line)) return false;
    if (line.length < 4 || line.length > 120 || !/[A-Za-zÀ-ÿ]{3}/.test(line)) return false;
    return !reference || !line.includes(reference);
  });

  return {
    reference,
    designation: designation?.slice(0, 120),
    rawText: rawText.trim() || undefined,
  };
}
