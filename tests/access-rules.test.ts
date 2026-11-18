import { describe, expect, it } from "vitest";
import {
  AUDIT_DEPT,
  BATCH_DEPT,
  canApproveMoney,
  canAudit,
  canDeleteMembers,
  canManageDues,
  canManageSongs,
  canSetDues,
  canTakeAttendance,
  FINANCE_DEPT,
  MEMBER_AFFAIRS,
  SONGS_DEPT,
} from "../app/lib/departments";

describe("money", () => {
  it("only ሂሳብ እና ንብረት (and admins) approve money", () => {
    expect(canApproveMoney("admin", [])).toBe(true);
    expect(canApproveMoney("dept_leader", [FINANCE_DEPT])).toBe(true);
    expect(canApproveMoney("dept_leader", [BATCH_DEPT])).toBe(false);
    expect(canApproveMoney("member", [])).toBe(false);
  });
  it("ባች እና ዲፓርትመንት sets the amounts and account and sees payments, but doesn't approve", () => {
    expect(canSetDues("dept_leader", [BATCH_DEPT])).toBe(true);
    expect(canManageDues("dept_leader", [BATCH_DEPT])).toBe(true);
    expect(canSetDues("dept_leader", [FINANCE_DEPT])).toBe(false);
  });
  it("ኦዲት sees money but can't change it", () => {
    expect(canManageDues("dept_leader", [AUDIT_DEPT])).toBe(true);
    expect(canApproveMoney("dept_leader", [AUDIT_DEPT])).toBe(false);
    expect(canAudit("dept_leader", [AUDIT_DEPT])).toBe(true);
    expect(canAudit("dept_leader", [FINANCE_DEPT])).toBe(false);
  });
});

describe("other departments", () => {
  it("መዝሙር ክፍል manages songs", () => {
    expect(canManageSongs("dept_leader", [SONGS_DEPT])).toBe(true);
    expect(canManageSongs("dept_leader", [BATCH_DEPT])).toBe(false);
  });
  it("ጽህፈት ቤት and አባላት ጉዳይ remove members; nobody else", () => {
    expect(canDeleteMembers("admin", [])).toBe(true);
    expect(canDeleteMembers("dept_leader", [MEMBER_AFFAIRS])).toBe(true);
    expect(canDeleteMembers("dept_leader", [BATCH_DEPT])).toBe(false);
    expect(canDeleteMembers("cafe", [])).toBe(false);
  });
  it("ባች እና ዲፓርትመንት takes the whole fellowship's attendance", () => {
    expect(canTakeAttendance("dept_leader", [BATCH_DEPT], null)).toBe(true);
    expect(canTakeAttendance("dept_leader", [SONGS_DEPT], null)).toBe(false);
  });
});
