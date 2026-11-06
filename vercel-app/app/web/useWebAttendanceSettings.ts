'use client';

import { useEffect, useState } from 'react';

type AttendanceSnapshot = {
  date: string;
  projectId: string;
  companies: { id: string; name: string; workers: number; hours: number }[];
};

type AttendanceSettings = {
  arrival: string;
  hours: number;
  snapshots: AttendanceSnapshot[];
};

const defaults: AttendanceSettings = { arrival: '08:00', hours: 8, snapshots: [] };

export function useWebAttendanceSettings(owner: string) {
  const key = owner ? 'buildtrack-web-attendance-v1:' + owner : '';
  const [saved, setSaved] = useState({ key: '', value: defaults });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!key) return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      setSaved({ key, value: stored ? { ...defaults, ...stored } : defaults });
      setError('');
    } catch {
      setError('Impossible de lire les préférences de présence dans ce navigateur.');
    }
  }, [key]);

  const value = saved.key === key ? saved.value : defaults;
  function update(patch: Partial<AttendanceSettings>) {
    if (!key) return false;
    try {
      const current = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      const next = { ...defaults, ...current, ...patch };
      window.localStorage.setItem(key, JSON.stringify(next));
      setSaved({ key, value: next });
      setError('');
      return true;
    } catch {
      setError('Impossible de conserver les préférences de présence dans ce navigateur.');
      return false;
    }
  }

  return { ...value, update, error };
}
