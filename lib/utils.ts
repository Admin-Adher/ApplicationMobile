export function genId(): string {
  return Date.now().toString() + Math.random().toString(36).substring(2, 8);
}

export function formatSize(bytes: number | undefined): string {
  if (!bytes) return '?';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
