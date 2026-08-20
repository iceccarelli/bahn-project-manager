/// <reference types="vite/client" />

/**
 * Build-time constants injected by `define` in vite.config.ts.
 * Declared here so they are typed rather than `any` at every use site.
 */
declare const __APP_VERSION__: string;
/** ISO date (YYYY-MM-DD) the production bundle was built. */
declare const __BUILD_DATE__: string;

/** TTF imported with Vite's `?url` suffix, for PDF font embedding. */
declare module "*.ttf?url" {
  const src: string;
  export default src;
}
