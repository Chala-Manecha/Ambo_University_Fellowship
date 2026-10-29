import { z } from "zod";
import { LEARNING_KEYS, SERVICE_KEYS, TITLE_KEYS, type TitleKey } from "../content/member-options";
import { ageOn } from "./ethiopian-date";

// Accepts 09XXXXXXXX, 07XXXXXXXX (Safaricom) or +251 forms; stores +251 form.
export const ethiopianPhone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .refine((s) => /^(\+251|251|0)[79]\d{8}$/.test(s), "Enter an Ethiopian phone number, like 0911 234 567")
  .transform((s) => "+251" + s.replace(/^(\+251|251|0)/, ""));

/**
 * Phone numbers shared with the bot arrive as "251911234567", "+251 91…" etc.
 * Returns "+<digits>", using the canonical +2519… form for Ethiopian numbers.
 */
export function normalizeContactPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const ethiopian = ethiopianPhone.safeParse(digits.startsWith("251") ? "+" + digits : digits);
  return ethiopian.success ? ethiopian.data : "+" + digits;
}

/** Telegram lets people share anyone's contact card. Only accept their own. */
export function isOwnContact(contactUserId: number | undefined, fromId: number) {
  return contactUserId === fromId;
}

/** yearOfStudy value for members who have already graduated (years are 1–7). */
export const GRADUATED = 0;

export function formatYear(year: number) {
  return year === GRADUATED ? "Graduated" : `Year ${year}`;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Addis Ababa (UTC+3), YYYY-MM-DD. */
function todayAddis() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export const birthDate = z
  .string({ message: "Choose your birth date" })
  .regex(ISO, "Choose your birth date")
  .refine((s) => {
    const age = ageOn(s, todayAddis());
    return age >= 12 && age <= 90;
  }, "Check your birth date");

const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

/** Fields added in round 3; also used by "Update my details". */
export const memberDetailsSchema = z.object({
  birthDate,
  title: z.preprocess(emptyToNull, z.enum(TITLE_KEYS as [TitleKey, ...TitleKey[]]).nullable()),
  services: z.array(z.enum(SERVICE_KEYS as [string, ...string[]], { message: "Unknown service" })).default([]),
  otherService: optionalText(100),
  learning: z.array(z.enum(LEARNING_KEYS as [string, ...string[]], { message: "Unknown option" })).default([]),
});

/** Titles (ዲያቆን, ቀሲስ, …) are for men only. */
export function applyTitleRule<T extends { title: TitleKey | null }>(gender: "male" | "female", d: T): T {
  return gender === "male" ? d : { ...d, title: null };
}

/** FormData -> plain object, keeping checkbox groups as arrays. */
export function formToObject(form: FormData) {
  const obj: Record<string, unknown> = Object.fromEntries(form);
  for (const k of ["services", "learning", "departments"]) obj[k] = form.getAll(k).map(String);
  return obj;
}

const registrationObject = z.object({
  fullName: z.string().trim().min(3, "Enter your full name").max(80),
  christianName: optionalText(60),
  gender: z.enum(["male", "female"], { message: "Choose male or female" }),
  phone: ethiopianPhone,
  studentId: z.string().trim().min(2, "Enter your student ID").max(30),
  fieldOfStudy: z.string().trim().min(2, "Enter your field of study").max(80),
  // "" must not coerce to 0 (= Graduated), so treat it as missing
  yearOfStudy: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number({ message: "Choose your year" }).int().min(GRADUATED, "Choose your year").max(7, "Choose your year"),
  ),
  contentLanguage: z.enum(["om", "am"], { message: "Choose a language" }),
  note: optionalText(500),
  ...memberDetailsSchema.shape,
  departments: z.array(z.string().max(40)).max(20).default([]), // checked against the DB in the action
});

export const registrationSchema = registrationObject.transform((d) => applyTitleRule(d.gender, d));

/** What the form submits: the phone comes from the bot, not the form. */
export const registrationFormSchema = registrationObject.omit({ phone: true }).transform((d) => applyTitleRule(d.gender, d));

export type RegistrationInput = z.infer<typeof registrationSchema>;

export type MemberStatus = "pending" | "active" | "rejected" | "alumni";
export type ReviewDecision = "approve" | "reject";

/** Only pending registrations can be reviewed. Returns the new status or null. */
export function reviewTransition(current: MemberStatus, decision: ReviewDecision): MemberStatus | null {
  if (current !== "pending") return null;
  return decision === "approve" ? "active" : "rejected";
}
