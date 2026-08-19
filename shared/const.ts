/**
 * Centralized Constants — Perfect Consistency v2.0
 * Merged from existing const.ts + validation enums
 */

export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

export const SYNC_VERSION = 2;
/**
 * Repo-relative path to the canonical dataset. It is `client/public/data.json`,
 * not `public/data.json` — the old value made every seed/sync entry point
 * (scripts/seed-perfect.ts, scripts/sync-json-db.ts, server/sync-db.ts,
 * drizzle/seed-from-json.ts) fail with "data.json not found".
 */
export const DATA_JSON_PATH = "client/public/data.json";
export const STATIONS_JSON_PATH = "client/public/stations.json";
export const STATIONS_NATIONAL_JSON_PATH = "client/public/stations-national.json";
export const ODATA_BASE_PATH = "/odata";
export const MAX_PROJECTS_PER_PAGE = 1000;
export const DEFAULT_SORT = "id";
export const AUDIT_RETENTION_DAYS = 365;

// Re-export from validation for single source
export { BAHNHOFSMANAGEMENT, STATION_BAHNHOFSMANAGEMENT, normalizeBahnhofsmanagement, toCanonicalBm } from "./bahnhofsmanagement";
export type { Bahnhofsmanagement } from "./bahnhofsmanagement";

export {
  DEPARTMENTS,
  REVIEW_STATUSES,
  PROJECT_STANDS,
  REGIONS,
  USER_ROLES,
  DEPARTMENT_LIST
} from "./validation";

export const STATUS_PRIORITY: Record<string, number> = {
  "abgelehnt": 10,
  "Nachforderung": 9,
  "in Bearbeitung": 8,
  "offen": 7,
  "prüffähig": 6,
  "Prüfung erfolgt": 5,
  "Zustimmung erteilt": 4,
  "Niederschrift erstellt": 3,
  "nicht erforderlich": 2,
  "zurückgestellt": 1,
  "gestoppt": 0,
  "Projektkonfig.": 0,
};
