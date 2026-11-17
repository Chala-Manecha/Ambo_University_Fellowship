/**
 * Numbers for the dashboards and the filter chips on lists.
 * Pure (no database), covered by tests/dashboard.test.ts.
 */
import { LEARNING_KEYS, SERVICE_KEYS, type LearningKey, type ServiceKey } from "../content/member-options";
import { attendanceRate, type AttendanceStatus } from "./departments";
import { GRADUATED } from "./registration";

/* ---------- Filters & search ---------- */

/** Counts for filter chips, e.g. { all: 40, male: 22, female: 18 }. `pick` may return several keys (multi-choice fields). */
export function countBy<T, K extends string>(rows: readonly T[], keys: readonly K[], pick: (r: T) => string | readonly string[] | null) {
  const out = { all: rows.length } as Record<K | "all", number>;
  for (const k of keys) out[k] = 0;
  for (const r of rows) {
    const v = pick(r);
    for (const k of Array.isArray(v) ? v : v === null ? [] : [v]) if (k in out && k !== "all") out[k as K]++;
  }
  return out;
}

/** The URL value if it's one of the allowed keys, otherwise null. */
export function pickParam<K extends string>(value: string | null, allowed: readonly K[]): K | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as K) : null;
}

/** Case-insensitive contains-search; IDs and phones also match without slashes, spaces or "+". */
export function matchesSearch(q: string, fields: readonly (string | null | undefined)[]) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const compact = needle.replace(/[^\p{L}\p{N}]/gu, "");
  return fields.some((f) => {
    if (!f) return false;
    const v = f.toLowerCase();
    return v.includes(needle) || (compact.length >= 3 && v.replace(/[^\p{L}\p{N}]/gu, "").includes(compact));
  });
}

/**
 * Filters that combine. Each chip row counts what the OTHER filters leave,
 * so the numbers on a row always add up to its "All".
 */
export type Facet<R> = { key: string; value: string | null; match: (r: R, value: string) => boolean };

export function applyFacets<R>(rows: readonly R[], facets: readonly Facet<R>[], except?: string) {
  return rows.filter((r) => facets.every((f) => f.key === except || f.value === null || f.match(r, f.value)));
}

/* ---------- Year of study ---------- */

export const YEAR_KEYS = ["1", "2", "3", "4", "5", "6", "7", "g"] as const;
export type YearKey = (typeof YEAR_KEYS)[number];

export function yearKey(yearOfStudy: number): YearKey {
  return yearOfStudy === GRADUATED ? "g" : (String(yearOfStudy) as YearKey);
}

/* ---------- Members dashboard ---------- */

export type MemberStatRow = {
  status: "pending" | "active" | "rejected" | "alumni";
  gender: "male" | "female";
  yearOfStudy: number;
  birthDate: string | null;
  services: string[] | null;
  learning: string[] | null;
  createdAt: number; // ms
};

export function memberStats(rows: readonly MemberStatRow[], nowMs: number) {
  const active = rows.filter((r) => r.status === "active");
  const since = nowMs - 30 * 86_400_000;
  return {
    pending: rows.filter((r) => r.status === "pending").length,
    active: active.length,
    male: active.filter((r) => r.gender === "male").length,
    female: active.filter((r) => r.gender === "female").length,
    newLast30: rows.filter((r) => r.status !== "rejected" && r.createdAt >= since).length,
    missingDetails: active.filter((r) => !r.birthDate).length,
    // Years 6 and 7 (medicine, etc.) only show when someone is in them
    byYear: YEAR_KEYS.map((k) => ({ key: k, n: active.filter((r) => yearKey(r.yearOfStudy) === k).length })).filter(
      (y) => y.n > 0 || (y.key !== "6" && y.key !== "7"),
    ),
    services: SERVICE_KEYS.map((k: ServiceKey) => ({ key: k, n: active.filter((r) => r.services?.includes(k)).length })).sort(
      (a, b) => b.n - a.n,
    ),
    learning: LEARNING_KEYS.map((k: LearningKey) => ({ key: k, n: active.filter((r) => r.learning?.includes(k)).length })),
  };
}

/* ---------- Departments dashboard ---------- */

export type DeptMembershipRow = { departmentId: string; role: "member" | "leader"; status: "pending" | "active" | "rejected" };
export type DeptRecordRow = { departmentId: string; status: AttendanceStatus };

/** Per department: active members, open requests, leaders, attendance %. */
export function departmentStats(
  departmentIds: readonly string[],
  memberships: readonly DeptMembershipRow[],
  records: readonly DeptRecordRow[],
) {
  return departmentIds.map((id) => {
    const m = memberships.filter((x) => x.departmentId === id);
    return {
      id,
      members: m.filter((x) => x.status === "active").length,
      requests: m.filter((x) => x.status === "pending").length,
      leaders: m.filter((x) => x.status === "active" && x.role === "leader").length,
      rate: attendanceRate(records.filter((r) => r.departmentId === id).map((r) => r.status)).percent,
    };
  });
}
