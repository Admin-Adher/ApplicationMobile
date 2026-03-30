import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  RESERVES: 'bt_reserves',
  COMPANIES: 'bt_companies',
  TASKS: 'bt_tasks',
  DOCUMENTS: 'bt_documents',
  PHOTOS: 'bt_photos',
  MESSAGES: 'bt_messages',
  INITIALIZED: 'bt_initialized',
};

export async function loadData<T>(key: keyof typeof KEYS): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS[key]);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveData<T>(key: keyof typeof KEYS, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS[key], JSON.stringify(data));
  } catch {}
}

export async function isInitialized(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(KEYS.INITIALIZED);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function setInitialized(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.INITIALIZED, 'true');
  } catch {}
}

export async function clearAll(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  } catch {}
}
