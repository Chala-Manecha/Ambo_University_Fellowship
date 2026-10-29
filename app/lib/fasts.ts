import { z } from "zod";
import type { ContentLang } from "./lang";

export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABELS: Record<Meal, Record<ContentLang | "en", string>> = {
  breakfast: { en: "Breakfast", am: "ቁርስ", om: "Ciree" },
  lunch: { en: "Lunch", am: "ምሳ", om: "Laaqana" },
  dinner: { en: "Dinner", am: "እራት", om: "Irbaata" },
};

export function isMeal(v: unknown): v is Meal {
  return typeof v === "string" && (MEALS as readonly string[]).includes(v);
}

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const fastSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the fast's name, like ጾመ ነቢያት").max(80),
    startDate: iso,
    endDate: iso,
    meals: z.array(z.enum(MEALS)).min(1, "Choose at least one meal"),
  })
  .refine((f) => f.endDate >= f.startDate, { message: "The end date must be on or after the start date", path: ["endDate"] });

export function isFastOn(fast: { startDate: string; endDate: string }, day: string) {
  return fast.startDate <= day && day <= fast.endDate;
}

/** Hour of day in Addis Ababa (UTC+3). */
export function addisHour(nowMs = Date.now()) {
  return new Date(nowMs + 3 * 3600 * 1000).getUTCHours();
}

/** Best guess at which meal is being served now: before 11 breakfast, before 17 lunch, then dinner. */
export function defaultMeal(meals: readonly Meal[], hour: number): Meal {
  const guess: Meal = hour < 11 ? "breakfast" : hour < 17 ? "lunch" : "dinner";
  return meals.includes(guess) ? guess : (meals[0] ?? "lunch");
}

export type CheckinResult =
  | { kind: "ok" }
  | { kind: "already"; at: number }
  | { kind: "not_registered" }
  | { kind: "inactive" }
  | { kind: "not_today" }
  | { kind: "wrong_meal" }
  | { kind: "invalid" };

/**
 * Decides what the cafe scanner shows, before anything is written.
 * Order matters: a fake code says nothing about the person; an inactive
 * member isn't served even if registered.
 */
export function checkinDecision(input: {
  memberFound: boolean;
  memberActive: boolean;
  registered: boolean;
  fastIsOn: boolean;
  mealAllowed: boolean;
}): CheckinResult | null {
  if (!input.memberFound) return { kind: "invalid" };
  if (!input.fastIsOn) return { kind: "not_today" };
  if (!input.mealAllowed) return { kind: "wrong_meal" };
  if (!input.memberActive) return { kind: "inactive" };
  if (!input.registered) return { kind: "not_registered" };
  return null; // go ahead and record; the database decides "ok" vs "already"
}
