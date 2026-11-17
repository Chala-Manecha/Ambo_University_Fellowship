import { describe, expect, it } from "vitest";
import {
  addMonths,
  checkMonths,
  checkReceipt,
  contributionSchema,
  dueMonth,
  formatMonth,
  memberKind,
  payableMonths,
  rateFor,
  reviewContributionTransition,
} from "../app/lib/contributions";
import { canListMembers, canManageDues } from "../app/lib/departments";

describe("months", () => {
  it("rolls over the EC year", () => {
    expect(addMonths({ year: 2019, month: 12 }, 1)).toEqual({ year: 2020, month: 1 });
    expect(addMonths({ year: 2019, month: 1 }, -1)).toEqual({ year: 2018, month: 12 });
  });

  it("puts Pagume in ነሐሴ and formats month names", () => {
    expect(dueMonth("2027-09-08")).toEqual({ year: 2019, month: 12 }); // Pagume 3, 2019
    expect(dueMonth("2026-11-17")).toEqual({ year: 2019, month: 3 }); // ኅዳር
    expect(formatMonth({ year: 2019, month: 3 }, "am")).toBe("ኅዳር 2019");
  });

  it("allows 6 months back to 3 ahead", () => {
    const w = payableMonths({ year: 2019, month: 3 });
    expect(w).toHaveLength(10);
    expect(w[0]).toEqual({ year: 2018, month: 9 });
    expect(w.at(-1)).toEqual({ year: 2019, month: 6 });
  });

  it("refuses months outside the window and removes duplicates", () => {
    const allowed = payableMonths({ year: 2019, month: 3 });
    expect(checkMonths([{ year: 2019, month: 3 }, { year: 2019, month: 2 }, { year: 2019, month: 3 }], allowed)).toEqual([
      { year: 2019, month: 2 },
      { year: 2019, month: 3 },
    ]);
    expect(checkMonths([{ year: 2017, month: 1 }], allowed)).toBeNull();
  });
});

describe("rates and review", () => {
  it("charges graduates and students their own rate", () => {
    const dues = { student: 30, graduate: 100 };
    expect(rateFor(memberKind(0), dues)).toBe(100);
    expect(rateFor(memberKind(3), dues)).toBe(30);
  });

  it("validates a submission", () => {
    expect(contributionSchema.safeParse({ months: ["2019-3"], amount: "30" }).success).toBe(true);
    expect(contributionSchema.safeParse({ months: [], amount: "30" }).success).toBe(false);
    expect(contributionSchema.safeParse({ months: ["2019-13"], amount: "30" }).success).toBe(false);
    expect(contributionSchema.safeParse({ months: ["2019-3"], amount: "0" }).success).toBe(false);
  });

  it("only accepts photo receipts under 5 MB", () => {
    expect(checkReceipt(null).ok).toBe(false);
    expect(checkReceipt(new File(["x"], "r.pdf", { type: "application/pdf" })).ok).toBe(false);
    expect(checkReceipt(new File(["x"], "r.jpg", { type: "image/jpeg" })).ok).toBe(true);
    expect(checkReceipt(new File([new Uint8Array(6 * 1024 * 1024)], "r.png", { type: "image/png" })).ok).toBe(false);
  });

  it("reviews a payment only once", () => {
    expect(reviewContributionTransition("pending", "approve")).toBe("approved");
    expect(reviewContributionTransition("pending", "reject")).toBe("rejected");
    expect(reviewContributionTransition("approved", "reject")).toBeNull();
  });
});

describe("who sees what", () => {
  it("shows the full members list to admins and two departments' leaders", () => {
    expect(canListMembers("admin", [])).toBe(true);
    expect(canListMembers("dept_leader", ["miseensa"])).toBe(true);
    expect(canListMembers("dept_leader", ["baachii"])).toBe(true);
    expect(canListMembers("dept_leader", ["faaruu"])).toBe(false);
    expect(canListMembers("member", [])).toBe(false);
  });

  it("lets only admins and ባች እና ዲፓርትመንት leaders manage contributions", () => {
    expect(canManageDues("admin", [])).toBe(true);
    expect(canManageDues("dept_leader", ["baachii"])).toBe(true);
    expect(canManageDues("dept_leader", ["miseensa"])).toBe(false);
    expect(canManageDues("finance", [])).toBe(false);
  });
});
