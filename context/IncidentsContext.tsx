import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Alert, AppState, AppStateStatus, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Incident } from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { formatDateFR } from '@/lib/utils';
import { mergeWithCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';
import { uploadLocalPhotosInPayload } from '@/lib/storage';
import i18n from '@/lib/i18n';

const INCIDENTS_PREFIX = 'buildtrack_incidents_v3_';

interface IncidentsContextValue {
  incidents: Incident[];
  isLoading: boolean;
  reloadIncidents: () => void;
  addIncident: (incident: Incident) => Promise<void>;
  updateIncident: (incident: Incident) => Promise<void>;
  deleteIncident: (id: string) => Promise<void>;
}

const IncidentsContext = createContext<IncidentsContextValue | null>(null);

function makeMockIncidents(): Incident[] {
  return [];
}

function toIncident(row: any): Incident {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    severity: row.severity,
    location: row.location,
    building: row.building,
    reportedAt: row.reported_at ?? row.reportedAt ?? '',
    reportedBy: row.reported_by ?? row.reportedBy ?? '',
    status: row.status,
    witnesses: row.witnesses ?? '',
    actions: row.actions ?? '',
    closedAt: row.closed_at ?? row.closedAt ?? undefined,
    closedBy: row.closed_by ?? row.closedBy ?? undefined,
    photoUri: row.photo_uri ?? row.photoUri ?? undefined,
    chantierId: row.chantier_id ?? row.chantierId ?? undefined,
  };
}

function fromIncident(incident: Incident, organizationId: string | null): Record<string, any> {
  return {
    id: incident.id,
    title: incident.title,
    description: incident.description,
    severity: incident.severity,
    location: incident.location,
    building: incident.building,
    reported_at: incident.reportedAt,
    reported_by: incident.reportedBy,
    status: incident.status,
    witnesses: incident.witnesses,
    actions: incident.actions,
    closed_at: incident.closedAt ?? null,
    closed_by: incident.closedBy ?? null,
    photo_uri: incident.photoUri ?? null,
    organization_id: organizationId,
    chantier_id: incident.chantierId ?? null,
  };
}

export function IncidentsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isOnline, enqueueOperation, queue, queueLoaded } = useNetwork();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const incidentsKey = INCIDENTS_PREFIX + (user?.id ?? 'anon');
  const [isLoading, setIsLoading] = useState(true);
  const [foregroundReloadSeq, setForegroundReloadSeq] = useState(0);
  const incidentsRef = useRef(incidents);
  const orgIdRef = useRef<string | null>(user?.organizationId ?? null);
  const isOnlineRef = useRef(isOnline);
  const queueRef = useRef(queue);
  useEffect(() => { incidentsRef.current = incidents; }, [incidents]);
  useEffect(() => { orgIdRef.current = user?.organizationId ?? null; }, [user?.organizationId]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      if (user?.role === 'magasinier') {
        setIncidents([]);
        setIsLoading(false);
        return;
      }
      // Always read cache first so offline-created incidents survive.
      let cached: Incident[] | null = null;
      try {
        const stored = await AsyncStorage.getItem(incidentsKey);
        if (stored) cached = JSON.parse(stored);
      } catch {}

      if (isSupabaseConfigured && user && queueLoaded && await isSupabaseSessionValid()) {
        try {
          let q = (supabase as any).from('incidents').select('*').order('reported_at', { ascending: false });
          if (user.role !== 'super_admin' && user.organizationId) {
            q = q.eq('organization_id', user.organizationId);
          }
          const { data, error } = await q;
          if (!error && data) {
            const fresh = data.map(toIncident);
            const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'incidents');
            const merged = mergeWithCache<Incident>(fresh, cached, pendingIds, { queueLoaded });
            setIncidents(merged);
            try { await AsyncStorage.setItem(incidentsKey, JSON.stringify(merged)); } catch {}
            setIsLoading(false);
            return;
          }
        } catch {}
      }
      // Fallback to cache (or mock)
      if (cached) {
        setIncidents(cached);
      } else {
        const mock = makeMockIncidents();
        setIncidents(mock);
        try { await AsyncStorage.setItem(incidentsKey, JSON.stringify(mock)); } catch {}
      }
      setIsLoading(false);
    }
    load();
  }, [user?.id, user?.role, queueLoaded, foregroundReloadSeq]);

  useEffect(() => {
    if (!isSupabaseConfigured || Platform.OS === 'web' || !user || user.role === 'magasinier') return;
    let backgroundAt = 0;
    let lastReloadAt = 0;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        const sleptMs = backgroundAt > 0 ? Date.now() - backgroundAt : 0;
        if (sleptMs > 5000 && Date.now() - lastReloadAt > 2000) {
          lastReloadAt = Date.now();
          setForegroundReloadSeq(seq => seq + 1);
        }
      } else if (state === 'background' || state === 'inactive') {
        backgroundAt = Date.now();
      }
    });
    return () => sub.remove();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || user.role === 'magasinier') return;
    const sub = supabase
      .channel(`realtime-incidents-v2-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidents' }, (payload: any) => {
        const incident = toIncident(payload.new);
        setIncidents(prev => {
          if (prev.find(i => i.id === incident.id)) return prev;
          return [incident, ...prev];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incidents' }, (payload: any) => {
        const incident = toIncident(payload.new);
        setIncidents(prev => prev.map(i => i.id === incident.id ? incident : i));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'incidents' }, (payload: any) => {
        const id = payload.old.id;
        setIncidents(prev => prev.filter(i => i.id !== id));
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [user?.id, user?.role, foregroundReloadSeq]);

  async function persist(updated: Incident[]) {
    setIncidents(updated);
    try { await AsyncStorage.setItem(incidentsKey, JSON.stringify(updated)); } catch (e) {
      console.warn('Erreur sauvegarde locale incidents:', e);
    }
  }

  async function syncToSupabase(
    incident: Incident,
    mode: 'upsert' | 'delete',
    onError?: (err: string) => void
  ) {
    if (!isSupabaseConfigured) return;
    try {
      if (mode === 'delete') {
        const { error } = await (supabase as any).from('incidents').delete().eq('id', incident.id);
        if (error) throw error;
      } else {
        const payload = fromIncident(incident, orgIdRef.current ?? null);
        const prep = await uploadLocalPhotosInPayload('incidents', payload);
        const { error } = await ((supabase as any).from('incidents') as any).upsert(prep.data ?? payload);
        const uploadedPhoto = prep.data?.photo_uri;
        if (uploadedPhoto && uploadedPhoto !== incident.photoUri) {
          const next = incidentsRef.current.map(item => item.id === incident.id ? { ...item, photoUri: uploadedPhoto } : item);
          await persist(next);
        }
        if (error) throw error;
      }
    } catch (e: any) {
      const msg = e?.message ?? i18n.t('subscriptionContext.networkError');
      console.warn('Erreur sync incident Supabase:', msg);
      if (mode === 'delete') {
        enqueueOperation({ table: 'incidents', op: 'delete', filter: { column: 'id', value: incident.id } });
      } else {
        enqueueOperation({ table: 'incidents', op: 'upsert', data: fromIncident(incident, orgIdRef.current ?? null) });
      }
      onError?.(msg);
    }
  }

  const addIncident = useCallback(async (incident: Incident) => {
    await persist([incident, ...incidentsRef.current]);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'incidents', op: 'upsert', data: fromIncident(incident, orgIdRef.current ?? null) });
      return;
    }
    await syncToSupabase(incident, 'upsert', (err) => {
      Alert.alert(i18n.t('syncAlerts.syncFailedTitle'), i18n.t('syncAlerts.incidentCreateLocalMessage', { error: err }));
    });
  }, [enqueueOperation, incidentsKey]);

  const updateIncident = useCallback(async (incident: Incident) => {
    await persist(incidentsRef.current.map(i => i.id === incident.id ? incident : i));
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'incidents', op: 'upsert', data: fromIncident(incident, orgIdRef.current ?? null) });
      return;
    }
    await syncToSupabase(incident, 'upsert', (err) => {
      Alert.alert(i18n.t('syncAlerts.syncFailedTitle'), i18n.t('syncAlerts.incidentUpdateLocalMessage', { error: err }));
    });
  }, [enqueueOperation, incidentsKey]);

  const deleteIncident = useCallback(async (id: string) => {
    const target = incidentsRef.current.find(i => i.id === id);
    await persist(incidentsRef.current.filter(i => i.id !== id));
    if (isSupabaseConfigured) {
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'incidents', op: 'delete', filter: { column: 'id', value: id } });
        return;
      }
      if (target) {
        await syncToSupabase(target, 'delete', (err) => {
          Alert.alert(i18n.t('syncAlerts.syncFailedTitle'), i18n.t('syncAlerts.incidentDeleteLocalMessage', { error: err }));
        });
      }
    }
  }, [enqueueOperation, incidentsKey]);

  return (
    <IncidentsContext.Provider value={{ incidents, isLoading, reloadIncidents: () => setForegroundReloadSeq(seq => seq + 1), addIncident, updateIncident, deleteIncident }}>
      {children}
    </IncidentsContext.Provider>
  );
}

export function useIncidents() {
  const ctx = useContext(IncidentsContext);
  if (!ctx) throw new Error('useIncidents must be used inside IncidentsProvider');
  return ctx;
}
