const COOKIE = "swing_dash";
const SALT = "swing-dashboard-v1";

export { COOKIE };

export function authRequired(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sessionToken(): Promise<string> {
  return sha256hex(`${SALT}:${process.env.DASHBOARD_PASSWORD ?? ""}`);
}

export async function cookieIsValid(value: string | undefined): Promise<boolean> {
  if (!authRequired()) return true;
  if (!value) return false;
  const expected = await sessionToken();
  if (value.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function passwordMatches(password: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD ?? "";
  if (!expected) return true;
  if (password.length !== expected.length) {
    await sha256hex(password);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < password.length; i++) diff |= password.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
