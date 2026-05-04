export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Generate login URL at runtime.
 * In demo mode (no OAuth configured), returns a local demo login page.
 */
export const getLoginUrl = (returnPath?: string) => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;

  // Demo mode: no OAuth configured
  if (!oauthPortalUrl || !appId) {
    const path = returnPath || window.location.pathname;
    return `/login?returnTo=${encodeURIComponent(path)}`;
  }

  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(JSON.stringify({ origin: window.location.origin, returnPath: returnPath || "/" }));

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
