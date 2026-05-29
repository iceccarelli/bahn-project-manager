/**
 * Shared Error Types — Enterprise Grade v2.0
 * Perfectly integrated with validation and API responses
 */

export interface ApiError {
  code: number;
  message: string;
  details?: Record<string, unknown> | undefined;
  field?: string | undefined;
}

export const ERROR_CODES = {
  UNAUTHENTICATED: 10001,
  NOT_ADMIN: 10002,
  VALIDATION_ERROR: 10003,
  NOT_FOUND: 10004,
  SYNC_ERROR: 10005,
  ODATA_PARSE_ERROR: 10006,
  CONFLICT_ERROR: 10007,        // For optimistic locking (syncVersion mismatch)
  RATE_LIMIT: 10008,
  DATABASE_ERROR: 10009,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const createError = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  field?: string
): ApiError => ({
  code,
  message,
  details,
  field,
});

// Specific error creators for common cases
export const ValidationError = (message: string, field?: string) =>
  createError(ERROR_CODES.VALIDATION_ERROR, message, undefined, field);

export const ConflictError = (message = "Data has been modified by another user. Please reload.") =>
  createError(ERROR_CODES.CONFLICT_ERROR, message);

export const NotFoundError = (entity: string, id: number | string) =>
  createError(ERROR_CODES.NOT_FOUND, `${entity} with id ${id} not found`);
