/** Wire contract of the server audit feed (`audit.page`): cursor-paginated, authorization-scoped, never the whole trail. */
/** What an audit row is about. `document` = an export/mail/PDF that is not tied to one project; `user` = an authorization grant. */
export type AuditEntityType = "project" | "checklist" | "booking" | "user" | "document";
/** `document` = a durable document/message action (PDF, export, mail, Teams) recorded by `audit.record`. */
export type AuditAction = "create" | "update" | "delete" | "document";
export const AUDIT_DOCUMENT_KINDS = ["pdf", "export", "mail", "teams"] as const;
export type AuditDocumentKind = (typeof AUDIT_DOCUMENT_KINDS)[number];

export interface AuditItem {
  id: number;
  at: string;
  user: string;
  entityType: AuditEntityType;
  entityId: number;
  /** Station / Projektnummer at the time of the change (readable even after deletion). */
  label: string | null;
  action: AuditAction;
  /** Plain field name; for review edits the Gewerk is split out. */
  field: string | null;
  department: string | null;
  from: string | null;
  to: string | null;
  version: number | null;
  workspace: string | null;
  /** Rows written in one transaction share an eventId. */
  eventId: string | null;
  /** For deletes: the full field snapshot of the removed project (forensics), parsed from the audit row. */
  snapshot?: Record<string, unknown> | null;
}

export interface AuditPage { items: AuditItem[]; nextCursor: number | null }

export interface AuditFilter {
  cursor?: number;
  limit?: number;
  entityType?: AuditEntityType;
  entityId?: number;
  action?: AuditAction;
  /** prefix match on the actor's name */
  user?: string;
  /** free text: actor prefix OR entity label contains OR field contains */
  q?: string;
  /** contains-match on the entity label (station / Projektnummer) */
  label?: string;
  /** only status edits (project reviews' `status` field) */
  statusOnly?: boolean;
  /** look-back window in days (default 30); bounds the scan, `0` = unbounded */
  days?: number;
}

/** `review.<Gewerk>.<field>` → { department, field } */
export function splitAuditField(field: string | null): { department: string | null; field: string | null } {
  if (!field) return { department: null, field: null };
  const m = /^review\.([^.]+)\.(.+)$/.exec(field);
  return m ? { department: m[1]!, field: m[2]! } : { department: null, field };
}
