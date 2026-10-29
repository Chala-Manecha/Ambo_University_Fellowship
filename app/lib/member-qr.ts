/**
 * The text inside a member's QR code: "GG1:<memberId>:<signature>".
 * The signature is an HMAC of the member id with BETTER_AUTH_SECRET, so a code
 * can't be made up for someone else, and scanning works without a lookup table.
 */
const PREFIX = "GG1";
const enc = new TextEncoder();

function base64url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signature(memberId: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`member-qr:${memberId}`));
  return base64url(mac).slice(0, 22); // 132 bits is plenty and keeps the QR small
}

export async function memberQrText(memberId: string, secret: string) {
  return `${PREFIX}:${memberId}:${await signature(memberId, secret)}`;
}

/** Returns the member id if the code is genuine, otherwise null. */
export async function verifyMemberQr(text: string, secret: string) {
  const parts = text.trim().split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) return null;
  const expected = await signature(parts[1], secret);
  if (expected.length !== parts[2].length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts[2].charCodeAt(i);
  return diff === 0 ? parts[1] : null;
}
