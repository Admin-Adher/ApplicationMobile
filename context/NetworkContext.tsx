import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFLINE_QUEUE_KEY = 'buildtrack_offline_queue_v1';

export interface QueuedOperation {
  id: string;
  type: string;
  payload: any;
  queuedAt: string;
}

interface NetworkContextValue {
  isOnline: boolean;
  queue: QueuedOperation[];
  enqueueOperation: (op: Omit<QueuedOperation, 'id' | 'queuedAt'>) => Promise<void>;
  clearQueue: () => Promise<void>;
  queueCount: number;
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: true,
  queue: [],
  enqueueOperation: async () => {},
  clearQueue: async () => {},
  queueCount: 0,
});

export function useNetwork() {
  return useContext(NetworkContext);
}

function genQueueId() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadQueue();

    if (Platform.OS === 'web') {
      setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);

      const handleOnline = () => setIsOnline(true);
      const handleOffline = () => setIsOnline(false);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    } else {
      const interval = setInterval(async () => {
        try {
          const res = await fetch('https://clients3.google.com/generate_204', {
            method: 'HEAD',
            cache: 'no-cache',
          });
          setIsOnline(res.ok);
        } catch {
          setIsOnline(false);
        }
      }, 10000);
      return () => clearInterval(interval);
    }
  }, []);

  async function loadQueue() {
    try {
      const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      if (raw) setQueue(JSON.parse(raw));
    } catch {}
  }

  async function saveQueue(q: QueuedOperation[]) {
    try {
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
    } catch {}
  }

  const enqueueOperation = useCallback(async (op: Omit<QueuedOperation, 'id' | 'queuedAt'>) => {
    const newOp: QueuedOperation = {
      ...op,
      id: genQueueId(),
      queuedAt: new Date().toISOString(),
    };
    setQueue(prev => {
      const updated = [...prev, newOp];
      saveQueue(updated);
      return updated;
    });
  }, []);

  const clearQueue = useCallback(async () => {
    setQueue([]);
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
  }, []);

  return (
    <NetworkContext.Provider value={{ isOnline, queue, enqueueOperation, clearQueue, queueCount: queue.length }}>
      {children}
    </NetworkContext.Provider>
  );
}
