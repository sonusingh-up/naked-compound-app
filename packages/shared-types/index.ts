export type Category = 'adult' | 'older' | 'active' | 'muscle';
export type Unit = 'kg' | 'lb';
export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks';
export type Theme = 'system' | 'light' | 'dark';
export interface Guidance { low: number; high: number; kg: number; category: Category; version: string }
export interface Target {
  guidance: Guidance | null;
  grams: number | null;
  mode: 'selected' | 'manual' | 'none';
  inputWeight: string;
  unit: Unit;
  category: Category;
  unsupported: boolean;
  version: string;
}
export interface TargetEvent extends Target { id: string; date: string; revision: number; createdAt: string }
export interface Food {
  id: string;
  name: string;
  aliases: string[];
  preparation: string;
  referenceGrams: number;
  protein: number | null;
  calories: number | null;
  source: string;
  version: string;
  kind: 'custom';
  createdAt: string;
}
export interface Entry {
  id: string;
  date: string;
  meal: Meal;
  grams: number;
  food: Food;
  createdAt: string;
  updatedAt: string;
  timezone: string;
}
export interface Day { id: string; target: Target | null }
export interface Profile { id: 'main'; onboarded: boolean; theme: Theme }
export interface SavedMeal { id: string; name: string; items: { food: Food; grams: number; meal: Meal }[]; createdAt: string }
export interface LocalState {
  profile: Profile;
  targets: TargetEvent[];
  foods: Food[];
  entries: Entry[];
  days: Day[];
  favorites: { id: string }[];
  savedMeals: SavedMeal[];
}
