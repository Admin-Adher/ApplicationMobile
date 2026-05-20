const DEFAULT_MAX_SEGMENT_LENGTH = 48;

export function sanitizePdfFilenamePart(value: unknown, maxLength = DEFAULT_MAX_SEGMENT_LENGTH): string {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' et ')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized.slice(0, maxLength).replace(/^_+|_+$/g, '');
}

export function buildPdfFilename(type: string, parts: Array<unknown> = []): string {
  const segments = [type, ...parts]
    .map(part => sanitizePdfFilenamePart(part))
    .filter(Boolean);

  return `${segments.length > 0 ? segments.join('_') : 'Document'}.pdf`;
}

export function ensurePdfFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.pdf$/i, '');
  const parts = withoutExtension.split(/[_\s—-]+/).filter(Boolean);
  return buildPdfFilename(parts.shift() ?? 'Document', parts);
}
