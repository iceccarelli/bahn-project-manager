import type { ConflictInfo } from "@shared/project-contract";

export class DomainError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class NotFoundError extends DomainError {
  constructor(what = "Projekt") { super("NOT_FOUND", `${what} nicht gefunden`); }
}
export class ForbiddenError extends DomainError {
  constructor(message = "Keine Berechtigung") { super("FORBIDDEN", message); }
}
export class ValidationError extends DomainError {
  constructor(message: string, readonly field?: string) { super("VALIDATION", message); }
}
export class IdempotencyKeyReuseError extends DomainError {
  constructor() {
    super("IDEMPOTENCY_KEY_REUSE", "Idempotency-Key wurde bereits mit einer anderen Anfrage verwendet");
  }
}
export class ConflictError extends DomainError {
  constructor(readonly info: ConflictInfo) {
    super("VERSION_CONFLICT", `Version ${info.expectedVersion} veraltet, aktuell ${info.currentVersion}`);
  }
}
