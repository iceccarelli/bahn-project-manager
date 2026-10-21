/**
 * Browser state that belongs to ONE signed-in person, and what happens to it when the person changes.
 *
 * The access token and the PKCE flow are handled by oidcClient (`clearAuth`). Everything else the app keeps in the
 * browser on a person's behalf is listed HERE, once, so a new store cannot be forgotten by accident:
 *
 *   localStorage    recent search terms (can be project numbers/names), recipient addresses an operator typed in
 *   sessionStorage  Abnahme checklist records (answers + header) — they survive a sign-out in the same tab
 *
 * Rules (docs/auth.md "Account isolation in the browser"):
 *   - explicit sign-out        → purge all of it and forget who was signed in
 *   - sign-in as a DIFFERENT person than the last one in this browser (expiry bounce, IdP account picker) → purge
 *   - same person returning after an expiry bounce → keep (drafts must survive a token that ran out)
 *   - first sign-in in a browser with no marker → adopt: the previous owner is unknown, and this deployment never had
 *     per-person browser state before SSO existed
 * UI preferences (theme, sidebar width) are not personal data and are kept.
 * The marker is the server-derived principal id (an opaque hash, `o…`), never a name, e-mail or token.
 */
import type { Store } from "./oidcClient";

export const RECENT_SEARCHES_KEY = "bpm-recent-searches";
export const RECIPIENT_OVERRIDES_KEY = "bahn-recipient-overrides";
export const ABNAHME_SESSION_PREFIX = "abnahme:v1";
export const LAST_PRINCIPAL_KEY = "bahn.last_principal";

export interface KeyedStore extends Store { readonly length: number; key(i: number): string | null }
export interface AccountStores { local: KeyedStore; session: KeyedStore }
export const browserStores = (): AccountStores => ({ local: localStorage, session: sessionStorage });

/** In-memory copies of the above (module-level snapshots) register here so a purge also resets them. */
const resetters = new Set<() => void>();
export function onUserStateReset(fn: () => void): () => void {
  resetters.add(fn);
  return () => { resetters.delete(fn); };
}

function removeMatching(store: KeyedStore, match: (k: string) => boolean) {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k !== null && match(k)) keys.push(k); }
  for (const k of keys) store.removeItem(k);
}

export function purgeUserScopedState(st: AccountStores): void {
  try { st.local.removeItem(RECENT_SEARCHES_KEY); st.local.removeItem(RECIPIENT_OVERRIDES_KEY); } catch { /* storage unavailable: nothing to purge */ }
  try { removeMatching(st.session, k => k.startsWith(`${ABNAHME_SESSION_PREFIX}:`)); } catch { /* idem */ }
  for (const r of [...resetters]) { try { r(); } catch { /* a reset hook must not block the others */ } }
}

export type Reconciliation = "first" | "same" | "switched";

/** Call with the principal id the SERVER reports for the current token, before any personal state is read. */
export function reconcilePrincipal(principalId: string, st: AccountStores): Reconciliation {
  let previous: string | null = null;
  try { previous = st.local.getItem(LAST_PRINCIPAL_KEY); } catch { /* treated as unknown */ }
  if (previous === principalId) return "same";
  if (previous !== null) purgeUserScopedState(st);
  try { st.local.setItem(LAST_PRINCIPAL_KEY, principalId); } catch { /* a private window: isolation then relies on the purge at sign-out */ }
  return previous === null ? "first" : "switched";
}

/** Explicit sign-out: nothing personal stays, and the next person is not compared with this one. */
export function signOutCleanup(st: AccountStores): void {
  purgeUserScopedState(st);
  try { st.local.removeItem(LAST_PRINCIPAL_KEY); } catch { /* ignore */ }
}
