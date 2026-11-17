import { z } from "zod";
import type { ContentLang } from "./lang";

export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABELS: Record<Meal, Record<ContentLang | "en", string>> = {
  breakfast: { en: "Breakfast", am: "ቁርስ", om: "Ciree" },
  lunch: { en: "Lunch", am: "ምሳ", om: "Laaqana" },
  dinner: { en: "Dinner", am: "እራት", om: "Irbaata" },
};

/** How a student keeps the fast, which decides the meals they eat at the cafe. */
export const FAST_TYPES = ["meat_only", "no_breakfast", "dinner_only"] as const;
export type FastType = (typeof FAST_TYPES)[number];

export const FAST_TYPE_MEALS: Record<FastType, readonly Meal[]> = {
  meat_only: ["breakfast", "lunch", "dinner"],
  no_breakfast: ["lunch", "dinner"],
  dinner_only: ["dinner"],
};

/** The cafe serves all three meals; students only choose which to skip. No other details are kept. */
export const FAST_TYPE_LABELS: Record<FastType, Record<ContentLang | "en", string>> = {
  meat_only: { en: "Eats all 3 meals · 3 a day", am: "ሦስቱንም ምግብ እበላለሁ · በቀን 3 ጊዜ", om: "Nyaata sadanuu nan nyaadha · guyyaatti si'a 3" },
  no_breakfast: { en: "Skips breakfast · 2 a day", am: "ቁርስ እዘላለሁ · በቀን 2 ጊዜ", om: "Ciree nan dhiisa · guyyaatti si'a 2" },
  dinner_only: { en: "Skips breakfast & lunch · 1 a day", am: "ቁርስና ምሳ እዘላለሁ · በቀን 1 ጊዜ", om: "Ciree fi laaqana nan dhiisa · guyyaatti si'a 1" },
};

/** Meals a day for each choice: the number the university report needs. */
export const MEALS_PER_DAY: Record<FastType, number> = { meat_only: 3, no_breakfast: 2, dinner_only: 1 };

export function isFastType(v: unknown): v is FastType {
  return typeof v === "string" && (FAST_TYPES as readonly string[]).includes(v);
}

/** The meals this person eats in this fast: the fast's meals that their fast type allows. */
export function mealsFor(fastMeals: readonly Meal[], type: FastType): Meal[] {
  return fastMeals.filter((m) => FAST_TYPE_MEALS[type].includes(m));
}

/** Gregorian dates of a fast, inclusive, as YYYY-MM-DD. */
export function fastDays(startDate: string, endDate: string) {
  const out: string[] = [];
  for (let t = Date.parse(startDate + "T00:00:00Z"); t <= Date.parse(endDate + "T00:00:00Z"); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** The day to show in the daily table: the asked day if it's in the fast, else today, else the nearest end. */
export function pickFastDay(fast: { startDate: string; endDate: string }, asked: string | null, today: string) {
  const ok = (d: string | null) => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= fast.startDate && d <= fast.endDate);
  if (asked && ok(asked)) return asked;
  if (ok(today)) return today;
  return today < fast.startDate ? fast.startDate : fast.endDate;
}

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
  | { kind: "skips_meal"; fastType: FastType }
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
  /** Their fast type, if registered; null when not registered */
  fastType?: FastType | null;
  meal?: Meal;
}): CheckinResult | null {
  if (!input.memberFound) return { kind: "invalid" };
  if (!input.fastIsOn) return { kind: "not_today" };
  if (!input.mealAllowed) return { kind: "wrong_meal" };
  if (!input.memberActive) return { kind: "inactive" };
  if (!input.registered) return { kind: "not_registered" };
  if (input.fastType && input.meal && !FAST_TYPE_MEALS[input.fastType].includes(input.meal)) {
    return { kind: "skips_meal", fastType: input.fastType };
  }
  return null; // go ahead and record; the database decides "ok" vs "already"
}
