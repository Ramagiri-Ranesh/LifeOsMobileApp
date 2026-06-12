import { create } from 'zustand';

import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

export type CoachMessageRole = 'user' | 'ai';
export type CoachMessageType = 'text' | 'meal-suggestion' | 'workout-tip' | 'goal-recommendation';

export type CoachMessage = {
  id: string;
  role: CoachMessageRole;
  type: CoachMessageType;
  text: string;
  createdAt: string;
  payload?: Record<string, Json>;
};

type CoachState = {
  messages: CoachMessage[];
  setMessages: (messages: CoachMessage[]) => void;
  addMessage: (message: CoachMessage) => void;
  updateMessage: (id: string, patch: Partial<CoachMessage>) => void;
  loadPersistedMessages: () => Promise<void>;
  persistRecentMessages: (messages?: CoachMessage[]) => Promise<void>;
};

type CoachMessageRow = {
  id?: Json;
  role?: Json;
  message_type?: Json;
  type?: Json;
  text?: Json;
  content?: Json;
  payload?: Json;
  created_at?: Json;
};

function rowToMessage(row: CoachMessageRow, fallbackIndex: number): CoachMessage {
  const role = row.role === 'user' ? 'user' : 'ai';
  const typeValue = typeof row.message_type === 'string' ? row.message_type : row.type;
  const type: CoachMessageType =
    typeValue === 'meal-suggestion' || typeValue === 'workout-tip' || typeValue === 'goal-recommendation'
      ? typeValue
      : 'text';

  return {
    id: typeof row.id === 'string' ? row.id : `persisted-${fallbackIndex}`,
    role,
    type,
    text: typeof row.text === 'string' ? row.text : typeof row.content === 'string' ? row.content : '',
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? (row.payload as Record<string, Json>) : undefined,
  };
}

export const useAICoachStore = create<CoachState>((set, get) => ({
  messages: [],
  setMessages: (messages) => set({ messages: messages.slice(-50) }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message].slice(-50) })),
  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    })),
  loadPersistedMessages: async () => {
    try {
      const { data, error } = await supabase
        .from('ai_coach_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      set({ messages: ((data ?? []) as CoachMessageRow[]).map(rowToMessage).reverse() });
    } catch (error) {
      console.warn('Unable to load AI coach messages', error);
    }
  },
  persistRecentMessages: async (nextMessages) => {
    const messages = (nextMessages ?? get().messages).slice(-50);
    try {
      const { data: user } = await supabase.auth.getUser();
      const rows = messages.map((message) => ({
        id: message.id,
        user_id: user.user?.id,
        role: message.role,
        message_type: message.type,
        text: message.text,
        content: message.text,
        payload: message.payload,
        created_at: message.createdAt,
      }));

      const { error } = await supabase.from('ai_coach_messages').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    } catch (error) {
      console.warn('Unable to persist AI coach messages', error);
    }
  },
}));
