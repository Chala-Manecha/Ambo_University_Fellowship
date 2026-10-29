/** Fails closed: any network or parse problem counts as "not verified". */
export async function verifyTurnstile(token: FormDataEntryValue | null, secret: string, ip?: string | null) {
  if (typeof token !== "string" || !token) {
    console.warn("turnstile: no token in form (widget not completed or not loaded)");
    return false;
  }
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    if (!res.ok) {
      console.warn("turnstile: siteverify HTTP", res.status);
      return false;
    }
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[]; hostname?: string };
    if (data.success !== true) {
      // e.g. invalid-input-secret = wrong TURNSTILE_SECRET_KEY; timeout-or-duplicate = token reused/expired
      console.warn("turnstile: rejected", data["error-codes"], data.hostname);
    }
    return data.success === true;
  } catch (err) {
    console.warn("turnstile: siteverify failed", err);
    return false;
  }
}
