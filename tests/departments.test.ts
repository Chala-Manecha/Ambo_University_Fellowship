import { describe, expect, it } from "vitest";
import {
  attendanceRate,
  canManageDepartment,
  canTakeAttendance,
  departmentName,
  isPosition,
  joinTransition,
  parseAttendanceForm,
  roleAfterLeadershipChange,
  sessionSchema,
  todayInAddis,
} from "../app/lib/departments";
import { can } from "../app/lib/permissions";

describe("department access", () => {
  it("lets admins manage every department and leaders only their own", () => {
    expect(canManageDepartment("admin", [], "faaruu")).toBe(true);
    expect(canManageDepartment("dept_leader", ["faaruu"], "faaruu")).toBe(true);
    expect(canManageDepartment("dept_leader", ["faaruu"], "barnoota")).toBe(false);
    expect(canManageDepartment("member", [], "faaruu")).toBe(false);
    expect(canManageDepartment("finance", [], "faaruu")).toBe(false);
  });

  it("keeps whole-fellowship attendance to admins", () => {
    expect(canTakeAttendance("admin", [], null)).toBe(true);
    expect(canTakeAttendance("dept_leader", ["faaruu"], null)).toBe(false);
    expect(canTakeAttendance("dept_leader", ["faaruu"], "faaruu")).toBe(true);
    expect(canTakeAttendance("member", [], "faaruu")).toBe(false);
  });

  it("reserves admin pages for admins", () => {
    for (const p of ["member:manage", "department:manage", "attendance:fellowship"] as const) {
      expect(can("admin", p)).toBe(true);
      expect(can("dept_leader", p)).toBe(false);
      expect(can("member", p)).toBe(false);
    }
  });

  it("syncs the dept_leader role without touching admin or finance", () => {
    expect(roleAfterLeadershipChange("member", true)).toBe("dept_leader");
    expect(roleAfterLeadershipChange("dept_leader", false)).toBe("member");
    expect(roleAfterLeadershipChange("dept_leader", true)).toBe("dept_leader");
    expect(roleAfterLeadershipChange("admin", false)).toBe("admin");
    expect(roleAfterLeadershipChange("finance", true)).toBe("finance");
  });

  it("decides join requests only once", () => {
    expect(joinTransition("pending", "approve")).toBe("active");
    expect(joinTransition("pending", "reject")).toBe("rejected");
    expect(joinTransition("active", "reject")).toBeNull();
    expect(joinTransition("rejected", "approve")).toBeNull();
  });
});

describe("attendance", () => {
  it("counts present against present + absent, ignoring excused", () => {
    expect(attendanceRate(["present", "present", "absent", "excused"])).toEqual({
      present: 2, absent: 1, excused: 1, total: 4, percent: 67,
    });
    expect(attendanceRate(["excused"]).percent).toBeNull();
    expect(attendanceRate([]).percent).toBeNull();
  });

  it("only reads roster members and valid statuses from the form", () => {
    const form = new Map([
      ["status:a", "present"],
      ["status:b", "absent"],
      ["status:c", "excused"],
      ["status:outsider", "present"],
      ["status:d", "late"],
    ]);
    const marks = parseAttendanceForm(form, ["a", "b", "c", "d"]);
    expect([...marks]).toEqual([["a", "present"], ["b", "absent"], ["c", "excused"]]);
  });

  it("validates session title and date", () => {
    expect(sessionSchema.safeParse({ title: "Saturday class", date: "2026-11-07" }).success).toBe(true);
    expect(sessionSchema.safeParse({ title: "x", date: "2026-11-07" }).success).toBe(false);
    expect(sessionSchema.safeParse({ title: "Class", date: "2026-02-30" }).success).toBe(false);
    expect(sessionSchema.safeParse({ title: "Class", date: "07/11/2026" }).success).toBe(false);
  });

  it("uses Addis Ababa time for today's date", () => {
    // 22:30 UTC on 1 Nov is already 2 Nov in Addis (UTC+3)
    expect(todayInAddis(Date.UTC(2026, 10, 1, 22, 30))).toBe("2026-11-02");
    expect(todayInAddis(Date.UTC(2026, 10, 1, 20, 0))).toBe("2026-11-01");
  });
});

describe("names", () => {
  it("picks the department name for the current language", () => {
    const d = { nameOm: "Kutaa Faaruu", nameAm: "መዝሙር ክፍል" };
    expect(departmentName(d, "om")).toBe("Kutaa Faaruu");
    expect(departmentName(d, "am")).toBe("መዝሙር ክፍል");
  });

  it("recognises positions", () => {
    expect(isPosition("chair")).toBe(true);
    expect(isPosition("president")).toBe(false);
  });
});
