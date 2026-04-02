import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Incident } from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { formatDateFR } from '@/lib/utils';

const INCIDENTS_KEY = 'buildtrack_incidents_v1';

interface IncidentsContextValue {
  incidents: Incident[];
  addIncident: (incident: Incident) => Promise<void>;
  updateIncident: (incident: Incident) => Promise<void>;
  deleteIncident: (id: string) => Promise<void>;
}

const IncidentsContext = createContext<IncidentsContextValue | null>(null);

function makeMockIncidents(): Incident[] {
  const today = formatDateFR(new Date());
  return [
    {
      id: 'inc-001',
      title: 'Chute de matériaux bâtiment A',
      description: 'Chute de briques depuis l\'échafaudage niveau R+2 lors du décoffrage. Aucune victime. Zone sécurisée immédiatement.',
      severity: 'moderate',
      location: 'Échafaudage Est',
      building: 'A',
      reportedAt: today,
      reportedBy: 'Jean Dupont',
      status: 'investigating',
      witnesses: 'Marie Martin, Pierre Lambert',
      actions: 'Zone condamnée. Inspection de l\'échafaudage programmée demain.',
    },
  ];
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
  };
}

export function IncidentsProvider({ children }: { children: React.ReactNode }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const incidentsRef = useRef(incidents);
  useEffect(() => { incidentsRef.current = incidents; }, [incidents]);

  useEffect(() => {
    async function load() {
      if (isSupabaseConfigured) {
        try {
          const { data, error } = await supabase.from('incidents').select('*').order('reported_at', { ascending: false });
          if (!error && data && data.length > 0) {
            setIncidents(data.map(toIncident));
            return;
          }
        } catch {}
      }
      try {
        const stored = await AsyncStorage.getItem(INCIDENTS_KEY);
        if (stored) {
          setIncidents(JSON.parse(stored));
        } else {
          const mock = makeMockIncidents();
          setIncidents(mock);
          await AsyncStorage.setItem(INCIDENTS_KEY, JSON.stringify(mock));
        }
      } catch {
        setIncidents(makeMockIncidents());
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sub = supabase
      .channel('realtime-incidents-v1')
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
  }, []);

  async function persist(updated: Incident[]) {
    setIncidents(updated);
    try { await AsyncStorage.setItem(INCIDENTS_KEY, JSON.stringify(updated)); } catch (e) {
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
        const { error } = await supabase.from('incidents').delete().eq('id', incident.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('incidents').upsert({
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
        });
        if (error) throw error;
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Erreur réseau';
      console.warn('Erreur sync incident Supabase:', msg);
      onError?.(msg);
    }
  }

  const addIncident = useCallback(async (incident: Incident) => {
    await persist([incident, ...incidentsRef.current]);
    await syncToSupabase(incident, 'upsert', (err) => {
      Alert.alert('Synchronisation échouée', `L'incident a été sauvegardé localement mais n'a pas pu être envoyé au serveur.\n${err}`);
    });
  }, []);

  const updateIncident = useCallback(async (incident: Incident) => {
    await persist(incidentsRef.current.map(i => i.id === incident.id ? incident : i));
    await syncToSupabase(incident, 'upsert', (err) => {
      Alert.alert('Synchronisation échouée', `La modification a été sauvegardée localement mais n'a pas pu être envoyée au serveur.\n${err}`);
    });
  }, []);

  const deleteIncident = useCallback(async (id: string) => {
    const target = incidentsRef.current.find(i => i.id === id);
    await persist(incidentsRef.current.filter(i => i.id !== id));
    if (target) {
      await syncToSupabase(target, 'delete', (err) => {
        Alert.alert('Synchronisation échouée', `La suppression locale a réussi mais n'a pas pu être propagée au serveur.\n${err}`);
      });
    }
  }, []);

  return (
    <IncidentsContext.Provider value={{ incidents, addIncident, updateIncident, deleteIncident }}>
      {children}
    </IncidentsContext.Provider>
  );
}

export function useIncidents() {
  const ctx = useContext(IncidentsContext);
  if (!ctx) throw new Error('useIncidents must be used inside IncidentsProvider');
  return ctx;
}
