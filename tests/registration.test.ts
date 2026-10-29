import { describe, expect, it } from "vitest";
import { formatYear, formToObject, GRADUATED, registrationSchema, reviewTransition } from "../app/lib/registration";
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
  birthDate: "2004-03-15",
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

describe("round 3 member details", () => {
  const base = {
    fullName: "Abebe Kebede", gender: "male", phone: "0911234567", studentId: "UGR/1/16", fieldOfStudy: "Law",
    yearOfStudy: "2", contentLanguage: "am", birthDate: "2004-03-15",
  };

  it("keeps a title for men and drops it for women", () => {
    expect(registrationSchema.parse({ ...base, title: "diakon" }).title).toBe("diakon");
    expect(registrationSchema.parse({ ...base, gender: "female", title: "diakon" }).title).toBeNull();
    expect(registrationSchema.parse({ ...base, title: "" }).title).toBeNull();
    expect(registrationSchema.safeParse({ ...base, title: "pope" }).success).toBe(false);
  });

  it("accepts known services and learning options only", () => {
    const r = registrationSchema.parse({ ...base, services: ["cafe", "trips"], learning: ["hymns"], otherService: " Photography " });
    expect(r.services).toEqual(["cafe", "trips"]);
    expect(r.learning).toEqual(["hymns"]);
    expect(r.otherService).toBe("Photography");
    expect(registrationSchema.safeParse({ ...base, services: ["hacking"] }).success).toBe(false);
  });

  it("requires a plausible birth date", () => {
    expect(registrationSchema.safeParse({ ...base, birthDate: "" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...base, birthDate: "2024-01-01" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...base, birthDate: "1900-01-01" }).success).toBe(false);
  });

  it("keeps checkbox groups as arrays when reading the form", () => {
    const f = new FormData();
    f.append("services", "cafe");
    f.append("services", "trips");
    f.append("fullName", "X");
    expect(formToObject(f)).toMatchObject({ services: ["cafe", "trips"], learning: [], departments: [], fullName: "X" });
  });
});
