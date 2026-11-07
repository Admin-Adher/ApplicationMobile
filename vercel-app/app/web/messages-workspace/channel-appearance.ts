import type { MessageChannelRecord } from './messages-model';

// Same identifiers as the mobile channel editor: saved settings work in both clients.
export const CHANNEL_COLORS = [
  ['#0A84FF', 'Bleu'], ['#7C3AED', 'Violet'], ['#059669', 'Vert'], ['#D97706', 'Ambre'],
  ['#EC4899', 'Rose'], ['#EA580C', 'Orange'], ['#0891B2', 'Turquoise'], ['#65A30D', 'Citron vert'],
  ['#DC2626', 'Rouge'], ['#6366F1', 'Indigo'],
] as const;

export const CHANNEL_ICONS = [
  ['chatbubbles', 'Discussion'], ['megaphone', 'Annonce'], ['construct', 'Travaux'], ['hammer', 'Marteau'],
  ['shield-checkmark', 'Sécurité'], ['star', 'Étoile'], ['flash', 'Éclair'], ['flag', 'Drapeau'],
  ['ribbon', 'Qualité'], ['layers', 'Niveaux'], ['clipboard', 'Contrôle'], ['briefcase', 'Dossier'],
  ['document-text', 'Document'], ['camera', 'Photo'], ['people', 'Équipe'], ['alert-circle', 'Alerte'],
  ['checkmark-circle', 'Validation'], ['information-circle', 'Information'], ['time', 'Horloge'], ['settings', 'Réglages'],
  ['people-circle', 'Groupe'], ['person-circle', 'Personne'],
] as const;

export type ChannelIconName = typeof CHANNEL_ICONS[number][0];

export function channelAppearance(type: string, current?: Pick<MessageChannelRecord, 'color' | 'icon'> | null) {
  return {
    color: current?.color ?? (type === 'dm' ? '#EC4899' : type === 'group' ? '#7C3AED' : '#003082'),
    icon: current?.icon ?? (type === 'dm' ? 'person-circle' : type === 'group' ? 'people-circle' : 'chatbubbles'),
  };
}

// Only use validated color values for presentation; retain legacy settings when saving.
export function channelDisplayColor(color: string | null | undefined) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#003082';
}

export function isChannelIcon(icon: string): icon is ChannelIconName {
  return CHANNEL_ICONS.some(([value]) => value === icon);
}
