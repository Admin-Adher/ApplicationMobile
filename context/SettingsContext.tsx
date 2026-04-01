import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AttendanceRecord, Company } from '@/constants/types';
import { genId } from '@/lib/utils';

const PROJECT_NAME_KEY = 'buildtrack_project_name_v1';
const PROJECT_DESC_KEY = 'buildtrack_project_desc_v1';
const ATTENDANCE_HISTORY_KEY = 'buildtrack_attendance_history_v1';
const DEFAULT_ARRIVAL_TIME_KEY = 'buildtrack_default_arrival_time_v1';

interface SettingsContextValue {
  projectName: string;
  projectDescription: string;
  setProjectName: (name: string) => Promise<void>;
  setProjectDescription: (desc: string) => Promise<void>;
  attendanceHistory: AttendanceRecord[];
  saveAttendanceSnapshot: (companies: Company[], savedBy: string) => Promise<void>;
  deleteAttendanceRecord: (id: string) => Promise<void>;
  clearAttendanceHistory: () => Promise<void>;
  defaultArrivalTime: string;
  setDefaultArrivalTime: (time: string) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [projectName, setProjectNameState] = useState('Projet Horizon');
  const [projectDescription, setProjectDescriptionState] = useState('Gestion de chantier numérique');
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceRecord[]>([]);
  const attendanceHistoryRef = useRef(attendanceHistory);
  useEffect(() => { attendanceHistoryRef.current = attendanceHistory; }, [attendanceHistory]);
  const [defaultArrivalTime, setDefaultArrivalTimeState] = useState('07:30');

  useEffect(() => {
    async function load() {
      try {
        const [name, desc, history, arrivalTime] = await Promise.all([
          AsyncStorage.getItem(PROJECT_NAME_KEY),
          AsyncStorage.getItem(PROJECT_DESC_KEY),
          AsyncStorage.getItem(ATTENDANCE_HISTORY_KEY),
          AsyncStorage.getItem(DEFAULT_ARRIVAL_TIME_KEY),
        ]);
        if (name) setProjectNameState(name);
        if (desc) setProjectDescriptionState(desc);
        if (history) setAttendanceHistory(JSON.parse(history));
        if (arrivalTime) setDefaultArrivalTimeState(arrivalTime);
      } catch {}
    }
    load();
  }, []);

  const setProjectName = useCallback(async (name: string) => {
    setProjectNameState(name);
    try { await AsyncStorage.setItem(PROJECT_NAME_KEY, name); } catch {}
  }, []);

  const setProjectDescription = useCallback(async (desc: string) => {
    setProjectDescriptionState(desc);
    try { await AsyncStorage.setItem(PROJECT_DESC_KEY, desc); } catch {}
  }, []);

  const setDefaultArrivalTime = useCallback(async (time: string) => {
    setDefaultArrivalTimeState(time);
    try { await AsyncStorage.setItem(DEFAULT_ARRIVAL_TIME_KEY, time); } catch {}
  }, []);

  const saveAttendanceSnapshot = useCallback(async (companies: Company[], savedBy: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const records: AttendanceRecord[] = companies.map(co => ({
      id: genId(),
      date: today,
      companyId: co.id,
      companyName: co.name,
      companyColor: co.color,
      workers: co.actualWorkers,
      hoursWorked: co.hoursWorked,
      savedBy,
    }));
    const updated = [...attendanceHistoryRef.current, ...records];
    setAttendanceHistory(updated);
    try { await AsyncStorage.setItem(ATTENDANCE_HISTORY_KEY, JSON.stringify(updated)); } catch {}
  }, []);

  const deleteAttendanceRecord = useCallback(async (id: string) => {
    const updated = attendanceHistoryRef.current.filter(r => r.id !== id);
    setAttendanceHistory(updated);
    try { await AsyncStorage.setItem(ATTENDANCE_HISTORY_KEY, JSON.stringify(updated)); } catch {}
  }, []);

  const clearAttendanceHistory = useCallback(async () => {
    setAttendanceHistory([]);
    try { await AsyncStorage.removeItem(ATTENDANCE_HISTORY_KEY); } catch {}
  }, []);

  return (
    <SettingsContext.Provider value={{
      projectName,
      projectDescription,
      setProjectName,
      setProjectDescription,
      attendanceHistory,
      saveAttendanceSnapshot,
      deleteAttendanceRecord,
      clearAttendanceHistory,
      defaultArrivalTime,
      setDefaultArrivalTime,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
