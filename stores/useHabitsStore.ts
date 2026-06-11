import { create } from 'zustand';

export type Habit = {
  id: string;
  name: string;
  streak: number;
  completedToday: boolean;
};

type HabitsState = {
  habits: Habit[];
  todaysCompletions: string[];
  toggleHabit: (habitId: string) => void;
};

export const useHabitsStore = create<HabitsState>((set) => ({
  habits: [],
  todaysCompletions: [],
  toggleHabit: (habitId) =>
    set((state) => ({
      todaysCompletions: state.todaysCompletions.includes(habitId)
        ? state.todaysCompletions.filter((id) => id !== habitId)
        : [...state.todaysCompletions, habitId],
    })),
}));
