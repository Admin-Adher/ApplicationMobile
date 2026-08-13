export const queryKeys = {
  chantiers: () => ['chantiers'] as const,
  reserves: (chantierId?: string | null) => ['reserves', chantierId ?? 'all'] as const,
  companies: () => ['companies'] as const,
  tasks: (chantierId?: string | null) => ['tasks', chantierId ?? 'all'] as const,
  profiles: () => ['profiles'] as const,
  sitePlans: (chantierId?: string | null) => ['sitePlans', chantierId ?? 'all'] as const,
  visites: (chantierId?: string | null) => ['visites', chantierId ?? 'all'] as const,
  lots: (chantierId?: string | null) => ['lots', chantierId ?? 'all'] as const,
  oprs: (chantierId?: string | null) => ['oprs', chantierId ?? 'all'] as const,
  // Passing a user id isolates in-memory document metadata across account
  // switches. Calling without one intentionally returns the invalidation prefix.
  documents: (userId?: string | null) => userId ? ['documents', userId] as const : ['documents'] as const,
  photos: () => ['photos'] as const,
  inventoryProducts: (chantierId?: string | null) => ['inventory', 'products', chantierId ?? 'none'] as const,
  inventoryMovements: (chantierId?: string | null) => ['inventory', 'movements', chantierId ?? 'none'] as const,
  messages: (channelId: string) => ['messages', channelId] as const,
  channels: {
    all: () => ['channels'] as const,
    general: () => ['channels', 'general'] as const,
    custom: () => ['channels', 'custom'] as const,
    group: () => ['channels', 'group'] as const,
    dm: () => ['channels', 'dm'] as const,
    pinned: () => ['channels', 'pinned'] as const,
  },
};
