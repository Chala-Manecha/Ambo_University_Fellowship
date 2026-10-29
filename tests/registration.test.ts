import { describe, expect, it } from "vitest";
import { formatYear, GRADUATED, registrationSchema, reviewTransition } from "../app/lib/registration";
import { safeRedirect } from "../app/lib/session.server";

const valid = {
  fullName: "Abebe Kebede",
  christianName: "",
  gender: "male",
  phone: "0911 234 567",
  studentId: "UGR/1234/16",
  fieldOfStudy: "Civil Engineering",
  yearOfStudy: "2",
  contentLanguage: "om",
  note: "",
};

describe("registrationSchema", () => {
  it("normalises phone numbers and empty optionals", () => {
    const r = registrationSchema.parse(valid);
    expect(r.phone).toBe("+251911234567");
    expect(r.christianName).toBeNull();
    expect(r.yearOfStudy).toBe(2);
  });

  it.each(["+251911234567", "251711234567", "0711-234-567"])("accepts %s", (phone) => {
    expect(registrationSchema.safeParse({ ...valid, phone }).success).toBe(true);
  });

  it.each(["0811234567", "091123456", "+1 202 555 0100", ""])("rejects %s", (phone) => {
    expect(registrationSchema.safeParse({ ...valid, phone }).success).toBe(false);
  });

  it("rejects missing required fields and bad enums", () => {
    expect(registrationSchema.safeParse({ ...valid, fullName: " " }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, gender: "x" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, contentLanguage: "en" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, yearOfStudy: "9" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, yearOfStudy: "-1" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, yearOfStudy: "" }).success).toBe(false);
  });

  it("accepts graduated members", () => {
    const r = registrationSchema.parse({ ...valid, yearOfStudy: String(GRADUATED) });
    expect(r.yearOfStudy).toBe(GRADUATED);
    expect(formatYear(r.yearOfStudy)).toBe("Graduated");
    expect(formatYear(3)).toBe("Year 3");
  });
});

describe("reviewTransition", () => {
  it("moves pending to active or rejected", () => {
    expect(reviewTransition("pending", "approve")).toBe("active");
    expect(reviewTransition("pending", "reject")).toBe("rejected");
  });
  it("refuses to re-review", () => {
    expect(reviewTransition("active", "reject")).toBeNull();
    expect(reviewTransition("rejected", "approve")).toBeNull();
  });
});

describe("safeRedirect", () => {
  it("keeps same-site paths and blocks the rest", () => {
    expect(safeRedirect("/register?x=1")).toBe("/register?x=1");
    expect(safeRedirect("//evil.com")).toBe("/");
    expect(safeRedirect("/\\evil.com")).toBe("/");
    expect(safeRedirect("https://evil.com")).toBe("/");
    expect(safeRedirect(null, "/account")).toBe("/account");
  });
});
