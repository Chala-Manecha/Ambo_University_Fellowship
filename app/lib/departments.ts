import { z } from "zod";
import type { ContentLang } from "./lang";
import { can, type Role } from "./permissions";

/* ---------- Names ---------- */

export function departmentName(d: { nameOm: string; nameAm: string }, lang: ContentLang) {
  return lang === "am" ? d.nameAm : d.nameOm;
}

export const POSITIONS = ["chair", "vice_chair", "secretary"] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<Position, Record<ContentLang, string>> = {
  chair: { om: "Walitti qabaa", am: "ዋና ሰብሳቢ" },
  vice_chair: { om: "Itti aanaa walitti qabaa", am: "ምክትል ሰብሳቢ" },
  secretary: { om: "Barreessaa", am: "ጸሐፊ" },
};

export function isPosition(v: unknown): v is Position {
  return typeof v === "string" && (POSITIONS as readonly string[]).includes(v);
}

/* ---------- Access ---------- */

/** Admins manage every department; leaders manage only the ones they lead. */
export function canManageDepartment(role: Role, leaderOf: readonly string[], departmentId: string) {
  return role === "admin" || leaderOf.includes(departmentId);
}

/** Who may take attendance for a session: its department's leaders, or admins for whole-fellowship sessions. */
export function canTakeAttendance(role: Role, leaderOf: readonly string[], departmentId: string | null) {
  if (departmentId === null) return can(role, "attendance:fellowship");
  return canManageDepartment(role, leaderOf, departmentId);
}

/**
 * Keeps the global `dept_leader` role in step with department leadership.
 * Admin, finance and cafe roles are never changed by this.
 */
export function roleAfterLeadershipChange(current: Role, leadsAnyDepartment: boolean): Role {
  if (current === "admin" || current === "finance" || current === "cafe") return current;
  return leadsAnyDepartment ? "dept_leader" : "member";
}

/* ---------- Join requests ---------- */

export type JoinStatus = "pending" | "active" | "rejected";

/** Only pending requests can be decided. Returns the new status or null. */
export function joinTransition(current: JoinStatus, decision: "approve" | "reject"): JoinStatus | null {
  if (current !== "pending") return null;
  return decision === "approve" ? "active" : "rejected";
}

/* ---------- Attendance ---------- */

export const ATTENDANCE_STATUSES = ["present", "absent", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  excused: "Excused",
};

/**
 * present / (present + absent). Excused sessions don't count against anyone.
 * percent is null when there's nothing to count yet.
 */
export function attendanceRate(statuses: readonly AttendanceStatus[]) {
  const present = statuses.filter((s) => s === "present").length;
  const absent = statuses.filter((s) => s === "absent").length;
  const excused = statuses.length - present - absent;
  const counted = present + absent;
  return { present, absent, excused, total: statuses.length, percent: counted ? Math.round((present / counted) * 100) : null };
}

/**
 * Reads "status:<memberId>" fields from the attendance form, keeping only
 * members on the roster and valid statuses.
 */
export function parseAttendanceForm(form: FormData | Map<string, string>, roster: readonly string[]) {
  const result = new Map<string, AttendanceStatus>();
  for (const memberId of roster) {
    const v = form.get(`status:${memberId}`);
    if (typeof v === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(v)) {
      result.set(memberId, v as AttendanceStatus);
    }
  }
  return result;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
  .refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().startsWith(s), "Choose a date");

export const sessionSchema = z.object({
  title: z.string().trim().min(2, "Enter a title, like \"Saturday class\"").max(80),
  date: isoDate,
});

/** Today's date in Addis Ababa (UTC+3, no daylight saving), as YYYY-MM-DD. */
export function todayInAddis(nowMs = Date.now()) {
  return new Date(nowMs + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
