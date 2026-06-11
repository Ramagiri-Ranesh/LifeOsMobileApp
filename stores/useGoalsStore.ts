import { create } from 'zustand';

export type Goal = {
  id: string;
  title: string;
  domain: 'weekly' | 'monthly';
  progress: number;
};

type GoalsState = {
  weeklyGoals: Goal[];
  monthlyGoals: Goal[];
  setWeeklyGoals: (goals: Goal[]) => void;
  setMonthlyGoals: (goals: Goal[]) => void;
};

export const useGoalsStore = create<GoalsState>((set) => ({
  weeklyGoals: [],
  monthlyGoals: [],
  setWeeklyGoals: (weeklyGoals) => set({ weeklyGoals }),
  setMonthlyGoals: (monthlyGoals) => set({ monthlyGoals }),
}));
