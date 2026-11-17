import { LEARNING_KEYS, SERVICE_KEYS } from "../content/member-options";
import { applyFacets, countBy, matchesSearch, pickParam, YEAR_KEYS, yearKey, type Facet } from "./dashboard";

/** One row of the members list (also the CSV). */
export type MemberListRow = {
  id: string;
  fullName: string;
  christianName: string | null;
  title: string | null;
  gender: "male" | "female";
  studentId: string;
  fieldOfStudy: string;
  yearOfStudy: number;
  phone: string;
  telegramUsername: string | null;
  birthDate: string | null;
  services: string[] | null;
  otherService: string | null;
  learning: string[] | null;
  status: "pending" | "active" | "rejected" | "alumni";
  hasPhoto?: boolean;
  departments: string[]; // ids of departments they actively belong to
};

const GENDERS = ["male", "female"] as const;
const DETAILS = ["missing"] as const;

/**
 * Reads the filters from the URL and applies them. Each chip row's counts come
 * from the rows the OTHER filters leave, so every row adds up to its "All".
 */
export function filterMembers(all: readonly MemberListRow[], params: URLSearchParams, departmentIds: readonly string[], canSeePending: boolean) {
  const status = (canSeePending && pickParam(params.get("status"), ["pending"] as const)) || "active";
  const q = params.get("q") ?? "";
  const base = all
    .filter((m) => m.status === status)
    .filter((m) => matchesSearch(q, [m.fullName, m.christianName, m.studentId, m.phone, m.telegramUsername, m.fieldOfStudy]));

  const deptKeys = [...departmentIds, "none"] as const;
  const values = {
    gender: pickParam(params.get("gender"), GENDERS),
    year: pickParam(params.get("year"), YEAR_KEYS),
    dept: pickParam(params.get("dept"), deptKeys),
    serve: pickParam(params.get("serve"), SERVICE_KEYS),
    learn: pickParam(params.get("learn"), LEARNING_KEYS),
    details: pickParam(params.get("details"), DETAILS),
  };

  const facets: Facet<MemberListRow>[] = [
    { key: "gender", value: values.gender, match: (m, v) => m.gender === v },
    { key: "year", value: values.year, match: (m, v) => yearKey(m.yearOfStudy) === v },
    { key: "dept", value: values.dept, match: (m, v) => (v === "none" ? m.departments.length === 0 : m.departments.includes(v)) },
    { key: "serve", value: values.serve, match: (m, v) => Boolean(m.services?.includes(v)) },
    { key: "learn", value: values.learn, match: (m, v) => Boolean(m.learning?.includes(v)) },
    { key: "details", value: values.details, match: (m) => !m.birthDate },
  ];

  const others = (key: string) => applyFacets(base, facets, key);
  return {
    status,
    q,
    values,
    rows: applyFacets(base, facets),
    counts: {
      status: { active: all.filter((m) => m.status === "active").length, pending: all.filter((m) => m.status === "pending").length },
      gender: countBy(others("gender"), GENDERS, (m) => m.gender),
      year: countBy(others("year"), YEAR_KEYS, (m) => yearKey(m.yearOfStudy)),
      dept: countBy(others("dept"), deptKeys, (m) => (m.departments.length ? m.departments : ["none"])),
      serve: countBy(others("serve"), SERVICE_KEYS, (m) => m.services ?? []),
      learn: countBy(others("learn"), LEARNING_KEYS, (m) => m.learning ?? []),
      details: countBy(others("details"), DETAILS, (m) => (m.birthDate ? null : "missing")),
    },
  };
}

/** RFC 4180 CSV with a BOM so Excel opens Amharic correctly. */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Leading = + - @ would run as a formula in Excel
    const safe = /^[=+\-@]/.test(s) && !/^\+\d+$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
