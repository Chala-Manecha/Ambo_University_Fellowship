import { describe, expect, it } from "vitest";
import { ageOn, daysInEcMonth, ecToIso, formatEc, isoToEc, isValidEc } from "../app/lib/ethiopian-date";

describe("Ethiopian calendar", () => {
  it.each([
    // [Gregorian, EC year, month, day]
    ["2026-09-11", 2019, 1, 1], // Enkutatash 2019
    ["2027-09-12", 2020, 1, 1], // Enkutatash before a Gregorian leap year
    ["2026-10-30", 2019, 2, 20],
    ["2027-01-07", 2019, 4, 29], // Genna
    ["2027-01-19", 2019, 5, 11], // Timket
    ["2023-09-11", 2015, 13, 6], // Pagume 6 in a leap year
    ["2000-01-01", 1992, 4, 22],
  ])("%s is %i-%i-%i EC", (iso, year, month, day) => {
    expect(isoToEc(iso)).toEqual({ year, month, day });
    expect(ecToIso({ year, month, day })).toBe(iso);
  });

  it("round-trips every day for several years", () => {
    let d = new Date(Date.UTC(2018, 0, 1));
    for (let i = 0; i < 365 * 6; i++) {
      const iso = d.toISOString().slice(0, 10);
      expect(ecToIso(isoToEc(iso))).toBe(iso);
      d = new Date(d.getTime() + 86400000);
    }
  });

  it("knows month lengths and invalid dates", () => {
    expect(daysInEcMonth(2015, 13)).toBe(6);
    expect(daysInEcMonth(2019, 13)).toBe(6); // Pagume 6 2019 = 11 Sep 2027
    expect(daysInEcMonth(2018, 13)).toBe(5);
    expect(daysInEcMonth(2019, 2)).toBe(30);
    expect(isValidEc({ year: 2018, month: 13, day: 6 })).toBe(false);
    expect(isValidEc({ year: 2019, month: 2, day: 31 })).toBe(false);
    expect(isValidEc({ year: 2019, month: 2, day: 20 })).toBe(true);
  });

  it("formats in both languages", () => {
    expect(formatEc("2026-10-30", "am")).toBe("20 ጥቅምት 2019");
    expect(formatEc("2026-10-30", "om")).toBe("20 Onkoloolessa 2019");
    expect(formatEc(null, "am")).toBe("—");
  });

  it("computes age", () => {
    expect(ageOn("2004-10-30", "2026-10-30")).toBe(22);
    expect(ageOn("2004-10-31", "2026-10-30")).toBe(21);
  });
});
