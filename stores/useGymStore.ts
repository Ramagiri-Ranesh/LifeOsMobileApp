import { create } from 'zustand';

export type WorkoutSet = {
  exercise: string;
  weightKg: number;
  reps: number;
};

type GymState = {
  activeSession: WorkoutSet[];
  exerciseLibrary: string[];
  prs: Record<string, number>;
  streak: number;
  currentSplit: string;
  addSet: (set: WorkoutSet) => void;
  setCurrentSplit: (split: string) => void;
};

export const useGymStore = create<GymState>((set) => ({
  activeSession: [],
  exerciseLibrary: [],
  prs: {},
  streak: 0,
  currentSplit: 'PPL: Push Mon, Pull Tue, Legs Thu, Full Body Sat',
  addSet: (workoutSet) =>
    set((state) => ({ activeSession: [...state.activeSession, workoutSet] })),
  setCurrentSplit: (currentSplit) => set({ currentSplit }),
}));
