import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, ROLES, type Permission } from "../app/lib/permissions";

describe("can", () => {
  it("lets only admins review registrations", () => {
    expect(ROLES.filter((r) => can(r, "registration:review"))).toEqual(["admin"]);
  });

  it("keeps finance away from department leaders and members", () => {
    expect(can("dept_leader", "finance:record")).toBe(false);
    expect(can("member", "finance:view")).toBe(false);
    expect(can("finance", "finance:record")).toBe(true);
  });

  it("gives plain members no protected permission", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) expect(can("member", p)).toBe(false);
  });

  it("denies unknown or missing roles", () => {
    expect(can("superuser", "registration:review")).toBe(false);
    expect(can(undefined, "member:list")).toBe(false);
    expect(can(null, "member:list")).toBe(false);
  });
});
