import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { nodeWebSocketTransport } from '@/lib/nodeWebSocket';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const serverStorage = (() => {
  const cache = new Map<string, string>();
  return {
    getItem: async (key: string) => cache.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      cache.set(key, value);
    },
    removeItem: async (key: string) => {
      cache.delete(key);
    },
  };
})();

const realtimeOptions = nodeWebSocketTransport ? { transport: nodeWebSocketTransport } : undefined;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  realtime: realtimeOptions,
  auth: {
    storage: typeof window === 'undefined' ? serverStorage : AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
