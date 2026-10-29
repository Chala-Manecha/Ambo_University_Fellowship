import { z } from "zod";

// Accepts 09XXXXXXXX, 07XXXXXXXX (Safaricom) or +251 forms; stores +251 form.
export const ethiopianPhone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .refine((s) => /^(\+251|251|0)[79]\d{8}$/.test(s), "Enter an Ethiopian phone number, like 0911 234 567")
  .transform((s) => "+251" + s.replace(/^(\+251|251|0)/, ""));

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

export const registrationSchema = z.object({
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
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

export type MemberStatus = "pending" | "active" | "rejected" | "alumni";
export type ReviewDecision = "approve" | "reject";

/** Only pending registrations can be reviewed. Returns the new status or null. */
export function reviewTransition(current: MemberStatus, decision: ReviewDecision): MemberStatus | null {
  if (current !== "pending") return null;
  return decision === "approve" ? "active" : "rejected";
}
