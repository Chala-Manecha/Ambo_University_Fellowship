import { describe, expect, it } from "vitest";
import { botLink } from "../app/content/bot";
import { can } from "../app/lib/permissions";
import { isOwnContact, normalizeContactPhone, registrationFormSchema } from "../app/lib/registration";
import { secretMatches, verifyWebAppInitData, webAppSignature } from "../app/lib/telegram-verify";

const TOKEN = "123456:TEST-token";
const NOW = 1_800_000_000_000;

async function signedInitData(fields: Record<string, string>, token = TOKEN) {
  const params = new URLSearchParams(fields);
  params.set("hash", await webAppSignature(params, token));
  return params.toString();
}

const user = JSON.stringify({ id: 42, first_name: "Abebe", last_name: "Kebede", username: "abebe" });

describe("verifyWebAppInitData", () => {
  it("accepts correctly signed data and returns the user", async () => {
    const data = await signedInitData({ user, auth_date: String(NOW / 1000 - 60), query_id: "AAE" });
    const r = await verifyWebAppInitData(data, TOKEN, NOW);
    expect(r).toEqual({ ok: true, user: JSON.parse(user) });
  });

  it("rejects data signed with another bot's token", async () => {
    const data = await signedInitData({ user, auth_date: String(NOW / 1000) }, "999:other");
    expect(await verifyWebAppInitData(data, TOKEN, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered user", async () => {
    const data = await signedInitData({ user, auth_date: String(NOW / 1000) });
    const tampered = data.replace("Abebe", "Admin");
    expect((await verifyWebAppInitData(tampered, TOKEN, NOW)).ok).toBe(false);
  });

  it("rejects old data", async () => {
    const data = await signedInitData({ user, auth_date: String(NOW / 1000 - 2 * 86400) });
    expect(await verifyWebAppInitData(data, TOKEN, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects signed data without a user", async () => {
    const data = await signedInitData({ auth_date: String(NOW / 1000) });
    expect(await verifyWebAppInitData(data, TOKEN, NOW)).toEqual({ ok: false, reason: "no_user" });
  });
});

describe("bot helpers", () => {
  it.each([
    ["251910888672", "+251910888672"],
    ["+251 91 088 8672", "+251910888672"],
    ["0910888672", "+251910888672"],
    ["12025550100", "+12025550100"],
  ])("normalises %s", (raw, expected) => {
    expect(normalizeContactPhone(raw)).toBe(expected);
  });

  it("only accepts the sender's own contact", () => {
    expect(isOwnContact(42, 42)).toBe(true);
    expect(isOwnContact(7, 42)).toBe(false);
    expect(isOwnContact(undefined, 42)).toBe(false);
  });

  it("checks the webhook secret", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abd", "abc")).toBe(false);
    expect(secretMatches(null, "abc")).toBe(false);
    expect(secretMatches("abc", undefined)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });

  it("builds the bot start link", () => {
    expect(botLink("HHC_Campus_UniversityBot")).toBe("https://t.me/HHC_Campus_UniversityBot?start=register");
  });

  it("form schema ignores any submitted phone", () => {
    const r = registrationFormSchema.parse({
      fullName: "Abebe Kebede", gender: "male", studentId: "UGR/1/16", fieldOfStudy: "Law",
      yearOfStudy: "1", contentLanguage: "am", phone: "0911000000",
    });
    expect("phone" in r).toBe(false);
  });

  it("lets only admins manage the bot", () => {
    expect(can("admin", "bot:manage")).toBe(true);
    expect(can("dept_leader", "bot:manage")).toBe(false);
  });
});
