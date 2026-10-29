import { describe, expect, it } from "vitest";
import { checkinDecision, defaultMeal, fastSchema, isFastOn } from "../app/lib/fasts";
import { memberQrText, verifyMemberQr } from "../app/lib/member-qr";
import { can } from "../app/lib/permissions";
import { roleAfterLeadershipChange } from "../app/lib/departments";

const SECRET = "test-secret-at-least-32-characters-long";

describe("member QR", () => {
  it("round-trips a genuine code", async () => {
    const text = await memberQrText("member-123", SECRET);
    expect(text.startsWith("GG1:member-123:")).toBe(true);
    expect(await verifyMemberQr(text, SECRET)).toBe("member-123");
  });

  it("rejects forged, altered and foreign codes", async () => {
    const text = await memberQrText("member-123", SECRET);
    expect(await verifyMemberQr(text.replace("member-123", "member-999"), SECRET)).toBeNull();
    expect(await verifyMemberQr(text, "another-secret-another-secret-xx")).toBeNull();
    expect(await verifyMemberQr(text.slice(0, -1), SECRET)).toBeNull();
    expect(await verifyMemberQr("https://example.com", SECRET)).toBeNull();
    expect(await verifyMemberQr("GG1:member-123:", SECRET)).toBeNull();
  });
});

describe("cafe rules", () => {
  const ok = { memberFound: true, memberActive: true, registered: true, fastIsOn: true, mealAllowed: true };

  it("lets a registered active member through", () => {
    expect(checkinDecision(ok)).toBeNull();
  });

  it.each([
    [{ memberFound: false }, "invalid"],
    [{ fastIsOn: false }, "not_today"],
    [{ mealAllowed: false }, "wrong_meal"],
    [{ memberActive: false }, "inactive"],
    [{ registered: false }, "not_registered"],
  ] as const)("blocks %o as %s", (patch, kind) => {
    expect(checkinDecision({ ...ok, ...patch })?.kind).toBe(kind);
  });

  it("checks the fast's dates inclusively", () => {
    const f = { startDate: "2026-11-25", endDate: "2027-01-06" };
    expect(isFastOn(f, "2026-11-25")).toBe(true);
    expect(isFastOn(f, "2027-01-06")).toBe(true);
    expect(isFastOn(f, "2027-01-07")).toBe(false);
  });

  it("guesses the meal from the time, within the fast's meals", () => {
    expect(defaultMeal(["breakfast", "lunch", "dinner"], 8)).toBe("breakfast");
    expect(defaultMeal(["breakfast", "lunch", "dinner"], 13)).toBe("lunch");
    expect(defaultMeal(["breakfast", "lunch", "dinner"], 19)).toBe("dinner");
    expect(defaultMeal(["lunch"], 8)).toBe("lunch");
  });

  it("validates a new fast", () => {
    expect(fastSchema.safeParse({ name: "ጾመ ነቢያት", startDate: "2026-11-25", endDate: "2027-01-06", meals: ["lunch"] }).success).toBe(true);
    expect(fastSchema.safeParse({ name: "X fast", startDate: "2026-11-25", endDate: "2026-11-01", meals: ["lunch"] }).success).toBe(false);
    expect(fastSchema.safeParse({ name: "X fast", startDate: "2026-11-25", endDate: "2026-12-01", meals: [] }).success).toBe(false);
  });

  it("lets admins and cafe coordinators scan, only admins manage", () => {
    expect(can("cafe", "fast:scan")).toBe(true);
    expect(can("admin", "fast:scan")).toBe(true);
    expect(can("member", "fast:scan")).toBe(false);
    expect(can("cafe", "fast:manage")).toBe(false);
    expect(roleAfterLeadershipChange("cafe", true)).toBe("cafe");
  });
});
