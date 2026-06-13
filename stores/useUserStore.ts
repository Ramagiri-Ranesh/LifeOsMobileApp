import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type GeneratedPlan = {
  workoutSplit: string;
  dayPills: string[];
  firstWeekGoals: string[];
  waterTargetMl: number;
};

export type UserProfile = {
  id?: string;
  username?: string;
  name: string;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  gymDaysPerWeek: number;
  split: string;
  waterTargetMl: number;
  currency: 'INR';
  measurements: 'metric';
  goal?: string;
  experienceLevel?: string;
  cuisinePrefs?: string[];
  foodsEaten?: string[];
  foodsAvoided?: string[];
  firstMealTime?: string;
  lastMealTime?: string;
  aiCalcCalories?: boolean;
};

export type OnboardingProfile = {
  name: string;
  age: number;
  heightCm: number;
  goal: string;
  experienceLevel: string;
  gymDaysPerWeek: number;
  currentWeight: number;
  targetWeight: number;
  cuisinePrefs: string[];
  foodsEaten: string[];
  foodsAvoided: string[];
  firstMealTime: string;
  lastMealTime: string;
  aiCalcCalories: boolean;
};

type UserState = {
  currentUserId: string | null;
  username: string | null;
  hasRegisteredBefore: boolean;
  profile: UserProfile | null;
  onboardingProfile: OnboardingProfile;
  onboardingCompleted: boolean;
  calorieGoal: number;
  macros: { protein: number; carbs: number; fat: number };
  waterTargetMl: number;
  generatedPlan: GeneratedPlan | null;
  foodsToAvoid: string[];
  cuisinePreference: string[];
  setSession: (session: { userId: string; username: string }) => void;
  setProfile: (profile: UserProfile) => void;
  updateOnboardingProfile: (profile: Partial<OnboardingProfile>) => void;
  setPlanTargets: (calorieGoal: number, macros: UserState['macros'], waterTargetMl?: number) => void;
  setGeneratedPlan: (plan: GeneratedPlan) => void;
  completeOnboarding: () => void;
  resetAuth: () => void;
};

const defaultOnboardingProfile: OnboardingProfile = {
  name: '',
  age: 29,
  heightCm: 175,
  goal: 'Build muscle & lose fat',
  experienceLevel: 'Intermediate',
  gymDaysPerWeek: 4,
  currentWeight: 75.2,
  targetWeight: 72,
  cuisinePrefs: ['South Indian', 'Hyderabadi', 'Telugu'],
  foodsEaten: ['Eggs', 'Banana', 'Milk', 'Rice', 'Dal', 'Chapathi', 'Peanuts', 'Chana'],
  foodsAvoided: [],
  firstMealTime: '07:00',
  lastMealTime: '21:00',
  aiCalcCalories: false,
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      currentUserId: null,
      username: null,
      hasRegisteredBefore: false,
      profile: null,
      onboardingProfile: defaultOnboardingProfile,
      onboardingCompleted: false,
      calorieGoal: 2380,
      macros: { protein: 165, carbs: 240, fat: 72 },
      waterTargetMl: 3000,
      generatedPlan: null,
      foodsToAvoid: [],
      cuisinePreference: ['Hyderabadi', 'South Indian', 'Telugu'],
      setSession: (session) =>
        set({
          currentUserId: session.userId,
          username: session.username,
          hasRegisteredBefore: true,
        }),
      setProfile: (profile) =>
        set({
          profile,
          currentUserId: profile.id ?? null,
          username: profile.username ?? null,
          hasRegisteredBefore: true,
          waterTargetMl: profile.waterTargetMl,
          foodsToAvoid: profile.foodsAvoided ?? [],
          cuisinePreference: profile.cuisinePrefs ?? [],
        }),
      updateOnboardingProfile: (profile) =>
        set((state) => ({
          onboardingProfile: { ...state.onboardingProfile, ...profile },
        })),
      setPlanTargets: (calorieGoal, macros, waterTargetMl) =>
        set((state) => ({
          calorieGoal,
          macros,
          waterTargetMl: waterTargetMl ?? state.waterTargetMl,
        })),
      setGeneratedPlan: (generatedPlan) => set({ generatedPlan, waterTargetMl: generatedPlan.waterTargetMl }),
      completeOnboarding: () => set({ onboardingCompleted: true, hasRegisteredBefore: true }),
      resetAuth: () =>
        set({
          currentUserId: null,
          username: null,
          profile: null,
          onboardingCompleted: false,
        }),
    }),
    {
      name: 'lifeos-user',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
