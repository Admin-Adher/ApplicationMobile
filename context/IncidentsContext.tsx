import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Incident } from '@/constants/types';

const INCIDENTS_KEY = 'buildtrack_incidents_v1';

interface IncidentsContextValue {
  incidents: Incident[];
  addIncident: (incident: Incident) => Promise<void>;
  updateIncident: (incident: Incident) => Promise<void>;
  deleteIncident: (id: string) => Promise<void>;
}

const IncidentsContext = createContext<IncidentsContextValue | null>(null);

const today = new Date().toISOString().slice(0, 10);

const MOCK_INCIDENTS: Incident[] = [
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

export function IncidentsProvider({ children }: { children: React.ReactNode }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const stored = await AsyncStorage.getItem(INCIDENTS_KEY);
        if (stored) {
          setIncidents(JSON.parse(stored));
        } else {
          setIncidents(MOCK_INCIDENTS);
          await AsyncStorage.setItem(INCIDENTS_KEY, JSON.stringify(MOCK_INCIDENTS));
        }
      } catch {
        setIncidents(MOCK_INCIDENTS);
      }
    }
    load();
  }, []);

  async function persist(updated: Incident[]) {
    setIncidents(updated);
    try { await AsyncStorage.setItem(INCIDENTS_KEY, JSON.stringify(updated)); } catch {}
  }

  const addIncident = useCallback(async (incident: Incident) => {
    await persist([incident, ...incidents]);
  }, [incidents]);

  const updateIncident = useCallback(async (incident: Incident) => {
    await persist(incidents.map(i => i.id === incident.id ? incident : i));
  }, [incidents]);

  const deleteIncident = useCallback(async (id: string) => {
    await persist(incidents.filter(i => i.id !== id));
  }, [incidents]);

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
