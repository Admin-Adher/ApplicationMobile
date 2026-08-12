import type { SVGProps } from 'react';

export type InventoryIconName =
  | 'arrowDown'
  | 'arrowUp'
  | 'box'
  | 'building'
  | 'camera'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'close'
  | 'download'
  | 'edit'
  | 'file'
  | 'history'
  | 'minus'
  | 'more'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'warning';

export function InventoryIcon({
  name,
  size = 20,
  ...props
}: { name: InventoryIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  };
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
  if (name === 'close') return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === 'minus') return <svg {...common}><path d="M5 12h14" /></svg>;
  if (name === 'arrowDown') return <svg {...common}><path d="M12 4v13M7 12l5 5 5-5" /><path d="M5 21h14" /></svg>;
  if (name === 'arrowUp') return <svg {...common}><path d="M12 20V7M7 12l5-5 5 5" /><path d="M5 3h14" /></svg>;
  if (name === 'box') return <svg {...common}><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z" /><path d="M12 11v10" /></svg>;
  if (name === 'history') return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>;
  if (name === 'refresh') return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5" /></svg>;
  if (name === 'download') return <svg {...common}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>;
  if (name === 'file') return <svg {...common}><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
  if (name === 'camera') return <svg {...common}><path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v9H3V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="3" /></svg>;
  if (name === 'warning') return <svg {...common}><path d="M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  if (name === 'check') return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === 'edit') return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z" /></svg>;
  if (name === 'building') return <svg {...common}><path d="M4 21V5l8-3 8 3v16M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M9 21v-5h6v5" /></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  if (name === 'more') return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
}
