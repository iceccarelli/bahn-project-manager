/**
 * The two ways in — and the link between them.
 *
 *   production (container, SSO)   Microsoft sign-in is the only credential path; `VITE_DEMO_URL` adds a "Demo ansehen" link
 *   static demo (browser-local)   demo accounts, no backend; `VITE_APP_URL` adds a "Mit SSO anmelden" link to production
 *
 * The demo is never served by, nor authenticated against, the production server (docs/auth.md). Both values are public,
 * build-time and only ever used as a navigation target, so they are accepted as an absolute https URL (http only for
 * localhost) and nothing else — no `javascript:`, no relative path, no credentials in the URL.
 */
export function entryLink(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (!(u.protocol === "https:" || (u.protocol === "http:" && local))) return null;
  if (u.username || u.password) return null;
  return u.toString();
}

/**
 * What the demo's Microsoft entry shows. A missing, invalid or self-pointing `VITE_APP_URL` must be visible as such — a silently
 * absent button looks like "SSO does not exist" — and must never link the demo back to itself (a redirect loop).
 */
export type SsoEntry = { kind: "link"; href: string } | { kind: "unconfigured"; reason: "missing" | "invalid" | "self" };

export function ssoEntry(raw: string | undefined | null, currentOrigin?: string): SsoEntry {
  if (!raw || !raw.trim()) return { kind: "unconfigured", reason: "missing" };
  const base = entryLink(raw);
  if (!base) return { kind: "unconfigured", reason: "invalid" };
  if (currentOrigin && new URL(base).origin === currentOrigin) return { kind: "unconfigured", reason: "self" };
  return { kind: "link", href: `${base.replace(/\/$/, "")}/login` };
}
