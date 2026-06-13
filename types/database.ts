export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Row = Record<string, Json>;

type Table<T extends Row = Row> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table;
      app_users: Table;
      tasks: Table;
      food_items: Table;
      meal_logs: Table;
      meal_log_items: Table;
      meal_templates: Table;
      meal_template_items: Table;
      workout_sessions: Table;
      workout_sets: Table;
      body_metrics: Table;
      water_log: Table;
      weekly_goals: Table;
      monthly_goals: Table;
      habits: Table;
      habit_logs: Table;
      life_scores: Table;
      learning_books: Table;
      learning_courses: Table;
      finance_transactions: Table;
      finance_categories: Table;
      weekly_summaries: Table;
      ai_coach_messages: Table;
    };
    Views: Record<string, never>;
    Functions: {
      app_username_exists: {
        Args: { input_username: string };
        Returns: boolean;
      };
      verify_app_login: {
        Args: { input_username: string; input_password_hash: string };
        Returns: Array<{ profile_id: string }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
