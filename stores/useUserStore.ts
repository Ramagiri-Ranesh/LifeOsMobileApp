import { create } from 'zustand';

export type UserProfile = {
  name: string;
  weightKg: number;
  targetWeightKg: number;
  gymDaysPerWeek: number;
  split: string;
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
  profile: UserProfile | null;
  onboardingProfile: OnboardingProfile;
  onboardingCompleted: boolean;
  calorieGoal: number;
  macros: { protein: number; carbs: number; fat: number };
  foodsToAvoid: string[];
  cuisinePreference: string[];
  setProfile: (profile: UserProfile) => void;
  updateOnboardingProfile: (profile: Partial<OnboardingProfile>) => void;
  setPlanTargets: (calorieGoal: number, macros: UserState['macros']) => void;
  completeOnboarding: () => void;
};

export const useUserStore = create<UserState>((set) => ({
  profile: null,
  onboardingProfile: {
    goal: 'Build muscle & lose fat',
    experienceLevel: 'Intermediate',
    gymDaysPerWeek: 4,
    currentWeight: 75.2,
    targetWeight: 72,
    cuisinePrefs: ['South Indian', 'Hyderabadi', 'Telugu'],
    foodsEaten: ['Eggs', 'Banana', 'Milk', 'Rice', 'Dal', 'Chapathi', 'Peanuts', 'Chana'],
    foodsAvoided: ['Curd', 'Oats'],
    firstMealTime: '07:00 AM',
    lastMealTime: '09:00 PM',
    aiCalcCalories: true,
  },
  onboardingCompleted: false,
  calorieGoal: 2380,
  macros: { protein: 165, carbs: 240, fat: 72 },
  foodsToAvoid: ['Curd', 'Oats'],
  cuisinePreference: ['Hyderabadi', 'South Indian', 'Telugu'],
  setProfile: (profile) =>
    set({
      profile,
      foodsToAvoid: profile.foodsAvoided ?? [],
      cuisinePreference: profile.cuisinePrefs ?? [],
    }),
  updateOnboardingProfile: (profile) =>
    set((state) => ({
      onboardingProfile: { ...state.onboardingProfile, ...profile },
    })),
  setPlanTargets: (calorieGoal, macros) => set({ calorieGoal, macros }),
  completeOnboarding: () => set({ onboardingCompleted: true }),
}));
