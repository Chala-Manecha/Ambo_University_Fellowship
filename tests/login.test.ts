import { describe, expect, it } from "vitest";
import { afterFailure, isLocked, MAX_FAILURES, WINDOW_MS } from "../app/lib/login-limit";
import { hashPassword, passwordSchema, verifyPassword } from "../app/lib/password";
import { studentIdKey } from "../app/lib/registration";

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("abune-teklehaimanot", 1000);
    expect(h.startsWith("pbkdf2-sha256$1000$")).toBe(true);
    expect(await verifyPassword("abune-teklehaimanot", h)).toBe(true);
    expect(await verifyPassword("abune-teklehaimanoT", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same-password", 1000)).not.toBe(await hashPassword("same-password", 1000));
  });

  it("requires at least 8 characters", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
  });
});

describe("wrong-password lockout", () => {
  it("locks after 5 failures within 15 minutes, then unlocks", () => {
    let a: ReturnType<typeof afterFailure> | null = null;
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) a = afterFailure(a, t0 + i * 1000);
    expect(isLocked(a, t0 + 10_000)).toBe(true);
    expect(isLocked(a, t0 + WINDOW_MS + 1)).toBe(false);
    expect(isLocked(afterFailure(a, t0 + WINDOW_MS + 1), t0 + WINDOW_MS + 2)).toBe(false);
  });
});

describe("student ID login key", () => {
  it("ignores case, slashes, spaces and dashes", () => {
    expect(studentIdKey("ugr/1234/16")).toBe("UGR123416");
    expect(studentIdKey("UGR 1234-16")).toBe("UGR123416");
    expect(studentIdKey(" /// ")).toBe("");
  });
});
