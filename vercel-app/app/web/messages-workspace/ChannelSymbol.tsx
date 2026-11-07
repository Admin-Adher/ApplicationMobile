import type { ReactNode } from 'react';
import { isChannelIcon, type ChannelIconName } from './channel-appearance';

// SVG equivalents of the mobile icon identifiers, without loading native icon fonts.
const symbols: Record<ChannelIconName, ReactNode> = {
  chatbubbles: <><path d="M21 11a7 7 0 0 1-7 7H8l-5 3 1-5a7 7 0 0 1-1-4 8 8 0 0 1 8-8h3a7 7 0 0 1 7 7Z" /><path d="M7 9h9M7 13h6" /></>,
  megaphone: <><path d="m4 9 15-5v16L4 15ZM4 9H2v6h2M7 16l2 5h3l-2-4" /></>,
  construct: <><path d="m4 3 4 4-1 3-3 1-3-4a5 5 0 0 0 6 7l7 7a3 3 0 0 0 4-4l-7-7a5 5 0 0 0-7-7ZM14 7l5-5 3 3-5 5M4 17l-2 3 2 2 3-2" /></>,
  hammer: <><path d="m14 3 7 7-3 3-3-3L6 21l-3-3 10-9-3-3Z" /><path d="m10 6 4-3" /></>,
  'shield-checkmark': <><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z" /><path d="m8 12 3 3 5-6" /></>,
  star: <path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z" />,
  flash: <path d="m14 2-11 12h8l-1 8L21 9h-8Z" />,
  flag: <><path d="M4 22V3c5-3 10 3 15 0v11c-5 3-10-3-15 0" /></>,
  ribbon: <><circle cx="12" cy="8" r="5" /><path d="m8 12-3 10 7-4 7 4-3-10" /></>,
  layers: <><path d="m12 2 10 6-10 6L2 8ZM2 12l10 6 10-6M2 17l10 5 10-5" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="18" rx="2" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="M9 11h6M9 15h6" /></>,
  briefcase: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M8 7V3h8v4M2 12h20M10 12v3h4v-3" /></>,
  'document-text': <><path d="M14 2H5v20h14V7ZM14 2v6h5M8 12h8M8 16h8" /></>,
  camera: <><path d="m9 4-2 3H3v14h18V7h-4l-2-3Z" /><circle cx="12" cy="13" r="4" /></>,
  people: <><circle cx="9" cy="7" r="3" /><path d="M2 21v-2a7 7 0 0 1 14 0v2M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 4 5v2" /></>,
  'alert-circle': <><circle cx="12" cy="12" r="10" /><path d="M12 6v7M12 17h.01" /></>,
  'checkmark-circle': <><circle cx="12" cy="12" r="10" /><path d="m7 12 3 3 7-7" /></>,
  'information-circle': <><circle cx="12" cy="12" r="10" /><path d="M12 11v6M12 7h.01" /></>,
  time: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 3" /></>,
  settings: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
  'people-circle': <><circle cx="12" cy="12" r="10" /><circle cx="9" cy="9" r="2" /><path d="M5 18v-1a4 4 0 0 1 8 0v2M15 7a2 2 0 0 1 0 4M16 14a3 3 0 0 1 3 3" /></>,
  'person-circle': <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="8" r="3" /><path d="M5 19a7 7 0 0 1 14 0" /></>,
};

export default function ChannelSymbol({ icon, size = 20 }: { icon: string; size?: number }) {
  return <svg aria-hidden="true" data-channel-icon={icon} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {symbols[isChannelIcon(icon) ? icon : 'chatbubbles']}
  </svg>;
}
