/**
 * Verifies data from the Telegram Login Widget.
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * secret = SHA256(bot_token); expected = HMAC_SHA256(data_check_string, secret)
 * data_check_string = every received field except `hash`, as key=value,
 * sorted by key, joined with "\n".
 */
export type TelegramLoginData = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
  [extra: string]: unknown;
};

export type VerifyResult = { ok: true } | { ok: false; reason: "bad_signature" | "expired" };

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function dataCheckString(data: Record<string, unknown>) {
  return Object.keys(data)
    .filter((k) => k !== "hash" && data[k] !== undefined && data[k] !== null)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
}

export async function telegramSignature(data: Record<string, unknown>, botToken: string) {
  const secret = await crypto.subtle.digest("SHA-256", enc.encode(botToken));
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(dataCheckString(data))));
}

export async function verifyTelegramLogin(
  data: TelegramLoginData,
  botToken: string,
  nowMs: number,
  maxAgeSeconds = 60 * 60 * 24,
): Promise<VerifyResult> {
  const expected = await telegramSignature(data, botToken);
  if (!constantTimeEqual(expected, String(data.hash).toLowerCase())) {
    return { ok: false, reason: "bad_signature" };
  }
  if (nowMs / 1000 - Number(data.auth_date) > maxAgeSeconds) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/* ---------- Telegram Mini App (Web App) ---------- */

export type WebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

export type WebAppVerifyResult =
  | { ok: true; user: WebAppUser }
  | { ok: false; reason: "bad_signature" | "expired" | "no_user" };

async function hmac(key: BufferSource, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/** data_check_string for Mini Apps: every field except `hash` (values URL-decoded), sorted, "\n"-joined. */
export function webAppDataCheckString(params: URLSearchParams) {
  return [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** secret = HMAC_SHA256(key "WebAppData", bot_token); hash = hex HMAC_SHA256(secret, data_check_string) */
export async function webAppSignature(params: URLSearchParams, botToken: string) {
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  return toHex(await hmac(secret, webAppDataCheckString(params)));
}

/**
 * Verifies Telegram.WebApp.initData, sent by the page Telegram opens from the
 * bot's "Continue registration" button.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function verifyWebAppInitData(
  initData: string,
  botToken: string,
  nowMs: number,
  maxAgeSeconds = 60 * 60 * 24,
): Promise<WebAppVerifyResult> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  const expected = await webAppSignature(params, botToken);
  if (!constantTimeEqual(expected, hash.toLowerCase())) return { ok: false, reason: "bad_signature" };
  if (nowMs / 1000 - Number(params.get("auth_date")) > maxAgeSeconds) return { ok: false, reason: "expired" };
  try {
    const user = JSON.parse(params.get("user") ?? "") as WebAppUser;
    if (typeof user?.id !== "number" || !user.first_name) return { ok: false, reason: "no_user" };
    return { ok: true, user };
  } catch {
    return { ok: false, reason: "no_user" };
  }
}

/** Constant-time check of the X-Telegram-Bot-Api-Secret-Token header. */
export function secretMatches(received: string | null, expected: string | undefined) {
  if (!received || !expected) return false;
  return constantTimeEqual(received, expected);
}
