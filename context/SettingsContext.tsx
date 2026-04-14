import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AttendanceRecord, Company } from '@/constants/types';
import { genId, formatDateFR } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';

const PROJECT_NAME_PREFIX = 'buildtrack_project_name_v2_';
const PROJECT_DESC_PREFIX = 'buildtrack_project_desc_v2_';
const ATTENDANCE_HISTORY_PREFIX = 'buildtrack_attendance_history_v2_';
const DEFAULT_ARRIVAL_TIME_PREFIX = 'buildtrack_default_arrival_time_v2_';
const STANDARD_DAY_HOURS_PREFIX = 'buildtrack_standard_day_hours_v2_';

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
  standardDayHours: number;
  setStandardDayHours: (hours: number) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [projectName, setProjectNameState] = useState('');
  const [projectDescription, setProjectDescriptionState] = useState('');
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceRecord[]>([]);
  const [defaultArrivalTime, setDefaultArrivalTimeState] = useState('08:00');
  const [standardDayHours, setStandardDayHoursState] = useState(8);
  const attendanceHistoryRef = useRef(attendanceHistory);
  useEffect(() => { attendanceHistoryRef.current = attendanceHistory; }, [attendanceHistory]);

  const uid = user?.id ?? 'anon';
  const PROJECT_NAME_KEY = PROJECT_NAME_PREFIX + uid;
  const PROJECT_DESC_KEY = PROJECT_DESC_PREFIX + uid;
  const ATTENDANCE_HISTORY_KEY = ATTENDANCE_HISTORY_PREFIX + uid;
  const DEFAULT_ARRIVAL_TIME_KEY = DEFAULT_ARRIVAL_TIME_PREFIX + uid;
  const STANDARD_DAY_HOURS_KEY = STANDARD_DAY_HOURS_PREFIX + uid;

  useEffect(() => {
    async function load() {
      try {
        const [name, desc, history, arrivalTime, dayHours] = await Promise.all([
          AsyncStorage.getItem(PROJECT_NAME_KEY),
          AsyncStorage.getItem(PROJECT_DESC_KEY),
          AsyncStorage.getItem(ATTENDANCE_HISTORY_KEY),
          AsyncStorage.getItem(DEFAULT_ARRIVAL_TIME_KEY),
          AsyncStorage.getItem(STANDARD_DAY_HOURS_KEY),
        ]);
        if (name) setProjectNameState(name);
        if (desc) setProjectDescriptionState(desc);
        if (history) setAttendanceHistory(JSON.parse(history));
        if (arrivalTime) setDefaultArrivalTimeState(arrivalTime);
        if (dayHours) setStandardDayHoursState(parseInt(dayHours, 10));
      } catch {}
    }
    load();
  }, [uid]);

  const setProjectName = useCallback(async (name: string) => {
    setProjectNameState(name);
    try { await AsyncStorage.setItem(PROJECT_NAME_KEY, name); } catch {}
  }, [PROJECT_NAME_KEY]);

  const setProjectDescription = useCallback(async (desc: string) => {
    setProjectDescriptionState(desc);
    try { await AsyncStorage.setItem(PROJECT_DESC_KEY, desc); } catch {}
  }, [PROJECT_DESC_KEY]);

  const setDefaultArrivalTime = useCallback(async (time: string) => {
    setDefaultArrivalTimeState(time);
    try { await AsyncStorage.setItem(DEFAULT_ARRIVAL_TIME_KEY, time); } catch {}
  }, [DEFAULT_ARRIVAL_TIME_KEY]);

  const setStandardDayHours = useCallback(async (hours: number) => {
    setStandardDayHoursState(hours);
    try { await AsyncStorage.setItem(STANDARD_DAY_HOURS_KEY, String(hours)); } catch {}
  }, [STANDARD_DAY_HOURS_KEY]);

  const saveAttendanceSnapshot = useCallback(async (companies: Company[], savedBy: string) => {
    const today = formatDateFR(new Date());
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
  }, [ATTENDANCE_HISTORY_KEY]);

  const deleteAttendanceRecord = useCallback(async (id: string) => {
    const updated = attendanceHistoryRef.current.filter(r => r.id !== id);
    setAttendanceHistory(updated);
    try { await AsyncStorage.setItem(ATTENDANCE_HISTORY_KEY, JSON.stringify(updated)); } catch {}
  }, [ATTENDANCE_HISTORY_KEY]);

  const clearAttendanceHistory = useCallback(async () => {
    setAttendanceHistory([]);
    try { await AsyncStorage.removeItem(ATTENDANCE_HISTORY_KEY); } catch {}
  }, [ATTENDANCE_HISTORY_KEY]);

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
      standardDayHours,
      setStandardDayHours,
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
