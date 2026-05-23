/**
 * Shared error types and constants for consistent error handling across client/server.
 * Used in API responses, hooks, and auth flows.
 */

export interface ApiError {
  code: number;
  message: string;
  details?: Record<string, unknown>;
}

export const ERROR_CODES = {
  UNAUTHENTICATED: 10001,
  NOT_ADMIN: 10002,
  VALIDATION_ERROR: 10003,
  NOT_FOUND: 10004,
  SYNC_ERROR: 10005,
  ODATA_PARSE_ERROR: 10006,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const createError = (code: ErrorCode, message: string, details?: Record<string, unknown>): ApiError => ({
  code,
  message,
  details,
});
