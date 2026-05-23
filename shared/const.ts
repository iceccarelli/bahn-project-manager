export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

/**
 * Project status / stand values - expanded from Excel data and real usage.
 * Used for filtering, stats, and validation. Matches cleaned data.json.
 */
export const PROJECT_STANDS = [
  "AP",
  "EP",
  "FA",
  "EIGV Einstufung durch TBQ",
  "EIGV Einstufung durch TBQ/ Sammelfreigabe",
  "EP/ EIGV",
  "Gestoppt",
  "Projektstoppt siehe Ersatzprojekt",
  "Mieterumbau",
  "realisiert",
  "VEP",
  "TBQ GP",
  "EIGV erfolgt",
  "Umbau Start Q2 2024",
  "Mieterumbau iAG",
  "Mieterumbau MAG",
  "VEP, Projekt gestoppt, Mail PL vom 25.04.2022",
  "doppelt siehe Zeile 197",
  "FA - Stand Spalte AJ",
  null, // allow null for unclassified
] as const;

export type ProjectStand = (typeof PROJECT_STANDS)[number];

/**
 * Sync & OData constants for perfect round-trip and Microsoft alignment.
 */
export const SYNC_VERSION = "1.0.0";
export const DATA_JSON_PATH = "client/public/data.json";
export const ODATA_BASE_PATH = "/odata";
export const ODATA_METADATA_PATH = "/odata/$metadata";
export const MAX_PROJECTS_PER_PAGE = 1000; // for $top safety
export const DEFAULT_SORT = "id";
export const AUDIT_RETENTION_DAYS = 365;

/**
 * Department review status priority for workload calculations (higher = more critical).
 */
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
