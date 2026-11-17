/**
 * Monthly contributions (pure, tested in tests/contributions.test.ts).
 * Months are Ethiopian-calendar months 1–12; Pagume counts as part of ነሐሴ (12).
 */
import { z } from "zod";
import { EC_MONTHS, isoToEc } from "./ethiopian-date";
import type { ContentLang } from "./lang";
import { GRADUATED } from "./registration";

export type EcMonth = { year: number; month: number };
export type Dues = { student: number; graduate: number };
export type PayAccount = { bank: string; number: string; name: string; note: string };

export const DEFAULT_DUES: Dues = { student: 0, graduate: 0 }; // 0 = not set yet
export const EMPTY_ACCOUNT: PayAccount = { bank: "", number: "", name: "", note: "" };

export const RECEIPT_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export const monthKey = (m: EcMonth) => m.year * 100 + m.month;

export function addMonths(m: EcMonth, n: number): EcMonth {
  const i = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

/** The EC month a date falls in (Pagume belongs to ነሐሴ). */
export function dueMonth(iso: string): EcMonth {
  const ec = isoToEc(iso);
  return { year: ec.year, month: Math.min(ec.month, 12) };
}

export function formatMonth(m: EcMonth, lang: ContentLang) {
  return `${EC_MONTHS[lang][m.month - 1]} ${m.year}`;
}

/** Months a member may pay for: 6 back (arrears) to 3 ahead (prepay). */
export function payableMonths(current: EcMonth, back = 6, ahead = 3): EcMonth[] {
  const out: EcMonth[] = [];
  for (let i = -back; i <= ahead; i++) out.push(addMonths(current, i));
  return out;
}

export type MemberKind = "student" | "graduate";
export function memberKind(yearOfStudy: number): MemberKind {
  return yearOfStudy === GRADUATED ? "graduate" : "student";
}

export function rateFor(kind: MemberKind, dues: Dues) {
  return kind === "graduate" ? dues.graduate : dues.student;
}

const monthValue = z
  .string()
  .regex(/^\d{4}-(?:[1-9]|1[0-2])$/, "Choose the months you're paying for")
  .transform((v) => {
    const [year, month] = v.split("-").map(Number);
    return { year, month } as EcMonth;
  });

export const contributionSchema = z.object({
  months: z.array(monthValue).min(1, "Choose the months you're paying for").max(12, "At most 12 months at once"),
  amount: z.coerce.number({ message: "Enter the amount you paid" }).int("Whole birr only").min(1, "Enter the amount you paid").max(100_000, "That amount is too large"),
  note: z.string().trim().max(300).optional().transform((s) => (s ? s : null)),
});

/** Keeps only months inside the allowed window, without duplicates, oldest first; null if any is outside. */
export function checkMonths(months: EcMonth[], allowed: EcMonth[]) {
  const ok = new Set(allowed.map(monthKey));
  const unique = [...new Map(months.map((m) => [monthKey(m), m])).values()];
  return unique.every((m) => ok.has(monthKey(m))) ? unique.sort((a, b) => monthKey(a) - monthKey(b)) : null;
}

export function checkReceipt(file: unknown): { ok: true; file: File } | { ok: false; error: string } {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Attach a screenshot or photo of the receipt." };
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: "The receipt must be a photo (JPG, PNG or WebP)." };
  if (file.size > RECEIPT_MAX_BYTES) return { ok: false, error: "The photo is too large (max 5 MB)." };
  return { ok: true, file };
}

export function reviewContributionTransition(current: string, decision: "approve" | "reject") {
  if (current !== "pending") return null;
  return decision === "approve" ? ("approved" as const) : ("rejected" as const);
}

export const duesSchema = z.object({
  student: z.coerce.number().int().min(0).max(10_000),
  graduate: z.coerce.number().int().min(0).max(10_000),
});

export const accountSchema = z.object({
  bank: z.string().trim().max(60).default(""),
  number: z.string().trim().max(40).default(""),
  name: z.string().trim().max(80).default(""),
  note: z.string().trim().max(200).default(""),
});
