import { create } from 'zustand';

type TrendPoint = {
  date: string;
  value: number;
};

type AnalyticsState = {
  lifeScore: number;
  correlations: Record<string, number>;
  trendData: TrendPoint[];
  setLifeScore: (lifeScore: number) => void;
};

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  lifeScore: 0,
  correlations: {},
  trendData: [],
  setLifeScore: (lifeScore) => set({ lifeScore }),
}));
