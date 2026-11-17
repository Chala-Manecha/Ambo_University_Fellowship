import { describe, expect, it } from "vitest";
import { applyFacets, countBy, departmentStats, matchesSearch, memberStats, pickParam, yearKey } from "../app/lib/dashboard";
import { filterMembers, toCsv, type MemberListRow } from "../app/lib/member-filters";
import { hasDashboard } from "../app/lib/permissions";

const NOW = Date.UTC(2026, 10, 16);
const day = 86_400_000;

function m(p: Partial<MemberListRow>): MemberListRow {
  return {
    id: Math.random().toString(36).slice(2), fullName: "Abebe Kebede", christianName: null, title: null, gender: "male",
    studentId: "UGR/1234/16", fieldOfStudy: "Law", yearOfStudy: 2, phone: "+251911000000", telegramUsername: null,
    birthDate: "2004-01-01", services: [], otherService: null, learning: ["hymns", "abinet", "courses"], status: "active",
    departments: [], ...p,
  };
}

describe("helpers", () => {
  it("counts single and multi-valued fields", () => {
    const rows = [{ g: "a", s: ["x", "y"] }, { g: "b", s: ["x"] }, { g: "a", s: [] }];
    expect(countBy(rows, ["a", "b"] as const, (r) => r.g)).toEqual({ all: 3, a: 2, b: 1 });
    expect(countBy(rows, ["x", "y"] as const, (r) => r.s)).toEqual({ all: 3, x: 2, y: 1 });
  });

  it("only accepts known URL values", () => {
    expect(pickParam("male", ["male", "female"] as const)).toBe("male");
    expect(pickParam("<script>", ["male", "female"] as const)).toBeNull();
    expect(pickParam(null, ["male"] as const)).toBeNull();
  });

  it("searches names, IDs without slashes, phones, Amharic", () => {
    expect(matchesSearch("abebe", ["Abebe Kebede"])).toBe(true);
    expect(matchesSearch("ugr1234", ["UGR/1234/16"])).toBe(true);
    expect(matchesSearch("0911", ["+251911000000"])).toBe(false);
    expect(matchesSearch("911000", ["+251911000000"])).toBe(true);
    expect(matchesSearch("ወልደ", ["ወልደ ሥላሴ"])).toBe(true);
    expect(matchesSearch("", ["x"])).toBe(true);
    expect(matchesSearch("zzz", [null, "abc"])).toBe(false);
  });

  it("maps graduated to its own year key", () => {
    expect(yearKey(0)).toBe("g");
    expect(yearKey(3)).toBe("3");
  });

  it("applies every facet except the one asked to skip", () => {
    const rows = [{ a: 1, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 1 }];
    const facets = [
      { key: "a", value: "1", match: (r: { a: number }, v: string) => String(r.a) === v },
      { key: "b", value: "1", match: (r: { b: number }, v: string) => String(r.b) === v },
    ];
    expect(applyFacets(rows, facets)).toHaveLength(1);
    expect(applyFacets(rows, facets, "a")).toHaveLength(2);
  });
});

describe("member dashboard numbers", () => {
  it("counts by status, gender, year and interests", () => {
    const s = memberStats(
      [
        { status: "active", gender: "male", yearOfStudy: 1, birthDate: null, services: ["cafe"], learning: ["hymns"], createdAt: NOW - 5 * day },
        { status: "active", gender: "female", yearOfStudy: 0, birthDate: "2003-01-01", services: ["cafe", "trips"], learning: [], createdAt: NOW - 90 * day },
        { status: "pending", gender: "female", yearOfStudy: 2, birthDate: "2004-01-01", services: null, learning: null, createdAt: NOW - 1 * day },
        { status: "rejected", gender: "male", yearOfStudy: 2, birthDate: null, services: null, learning: null, createdAt: NOW - 1 * day },
      ],
      NOW,
    );
    expect(s).toMatchObject({ pending: 1, active: 2, male: 1, female: 1, newLast30: 2, missingDetails: 1 });
    expect(s.byYear.find((y) => y.key === "g")?.n).toBe(1);
    expect(s.byYear.some((y) => y.key === "7")).toBe(false); // empty 6/7 hidden
    expect(s.services[0]).toEqual({ key: "cafe", n: 2 }); // most wanted first
    expect(s.learning.find((l) => l.key === "hymns")?.n).toBe(1);
  });

  it("summarises departments", () => {
    const [faaruu, barnoota] = departmentStats(
      ["faaruu", "barnoota"],
      [
        { departmentId: "faaruu", role: "leader", status: "active" },
        { departmentId: "faaruu", role: "member", status: "active" },
        { departmentId: "faaruu", role: "member", status: "pending" },
        { departmentId: "barnoota", role: "member", status: "rejected" },
      ],
      [{ departmentId: "faaruu", status: "present" }, { departmentId: "faaruu", status: "absent" }, { departmentId: "faaruu", status: "excused" }],
    );
    expect(faaruu).toEqual({ id: "faaruu", members: 2, requests: 1, leaders: 1, rate: 50 });
    expect(barnoota).toEqual({ id: "barnoota", members: 0, requests: 0, leaders: 0, rate: null });
  });
});

describe("members list filters", () => {
  const rows = [
    m({ fullName: "Abebe", gender: "male", yearOfStudy: 1, services: ["cafe"], departments: ["faaruu"] }),
    m({ fullName: "Bontu", gender: "female", yearOfStudy: 1, services: ["cafe", "trips"], departments: [] }),
    m({ fullName: "Chaltu", gender: "female", yearOfStudy: 0, services: [], departments: ["faaruu", "barnoota"], birthDate: null }),
    m({ fullName: "Dawit", gender: "male", yearOfStudy: 3, status: "pending" }),
  ];
  const run = (q: string, pending = true) => filterMembers(rows, new URLSearchParams(q), ["faaruu", "barnoota"], pending);

  it("shows active members by default and combines filters", () => {
    expect(run("").rows.map((r) => r.fullName)).toEqual(["Abebe", "Bontu", "Chaltu"]);
    expect(run("gender=female&year=1").rows.map((r) => r.fullName)).toEqual(["Bontu"]);
    expect(run("dept=none").rows.map((r) => r.fullName)).toEqual(["Bontu"]);
    expect(run("serve=cafe&dept=faaruu").rows.map((r) => r.fullName)).toEqual(["Abebe"]);
    expect(run("details=missing").rows.map((r) => r.fullName)).toEqual(["Chaltu"]);
    expect(run("q=bon").rows.map((r) => r.fullName)).toEqual(["Bontu"]);
  });

  it("makes every chip row add up to its All", () => {
    const f = run("gender=female");
    expect(f.counts.gender).toMatchObject({ all: 3, male: 1, female: 2 }); // gender row ignores the gender filter
    expect(f.counts.year).toMatchObject({ all: 2, "1": 1, g: 1 }); // other rows respect it
  });

  it("hides pending members from people who can't review them", () => {
    expect(run("status=pending").rows.map((r) => r.fullName)).toEqual(["Dawit"]);
    expect(run("status=pending", false).status).toBe("active");
    expect(run("status=pending", false).rows.every((r) => r.status === "active")).toBe(true);
  });

  it("ignores unknown filter values", () => {
    expect(run("gender=other&dept=nope").rows).toHaveLength(3);
  });
});

describe("CSV", () => {
  it("quotes, keeps Amharic, and defuses spreadsheet formulas", () => {
    const csv = toCsv(["Name", "Note"], [["ወልደ, ሥላሴ", "=HYPERLINK(1)"], ["+251911000000", 'say "hi"']]);
    expect(csv.startsWith("﻿Name,Note\r\n")).toBe(true);
    expect(csv).toContain('"ወልደ, ሥላሴ",\'=HYPERLINK(1)');
    expect(csv).toContain('+251911000000,"say ""hi"""');
  });
});

describe("dashboard access", () => {
  it("gives the dashboard to staff roles, not plain members", () => {
    expect(hasDashboard("admin")).toBe(true);
    expect(hasDashboard("dept_leader")).toBe(true);
    expect(hasDashboard("cafe")).toBe(true);
    expect(hasDashboard("member")).toBe(false);
  });
});
