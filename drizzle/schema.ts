import {
  int, bigint, double, mysqlEnum, mysqlTable, text, timestamp, varchar, datetime, json,
  index, uniqueIndex, primaryKey
} from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

/**
 * UPGRADED SCHEMA v2.0 — PERFECT CONSISTENCY + FUTURE PROOF
 * - Added syncVersion for optimistic locking & zero drift
 * - Better indexes for instant filtering
 * - Explicit relations + unique constraints
 * - Ready for Postgres migration (full-text search)
 */

// Users
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, (table) => ({
  openIdIdx: uniqueIndex("openId_idx").on(table.openId),
  roleIdx: index("role_idx").on(table.role),
}));

// Projects — Main table with syncVersion for perfect data.json ↔ DB sync
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  originalRowIndex: int("originalRowIndex"),
  fullRowData: json("fullRowData"),
  projektnummer: varchar("projektnummer", { length: 256 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  station: varchar("station", { length: 256 }),
  bahnhofsnummer: varchar("bahnhofsnummer", { length: 32 }),
  streckennummer: varchar("streckennummer", { length: 32 }),
  projektbeschreibung: text("projektbeschreibung"),
  projektstand: varchar("projektstand", { length: 128 }),
  eigvEinstufung: text("eigvEinstufung"),
  projektleiter: varchar("projektleiter", { length: 256 }),
  terminProjektvorstellung: datetime("terminProjektvorstellung"),
  kommentar: text("kommentar"),
  projektLink: text("projektLink"),
  syncVersion: int("syncVersion").default(1).notNull(), // ← CRITICAL for optimistic locking & zero drift
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projektnummerIdx: index("projektnummer_idx").on(table.projektnummer),
  bahnhofsmanagementIdx: index("bahnhofsmanagement_idx").on(table.bahnhofsmanagement),
  stationIdx: index("station_idx").on(table.station),
  projektstandIdx: index("projektstand_idx").on(table.projektstand),
  projektleiterIdx: index("projektleiter_idx").on(table.projektleiter),
  syncVersionIdx: index("syncVersion_idx").on(table.syncVersion),
  regionStandIdx: index("region_stand_idx").on(table.bahnhofsmanagement, table.projektstand),
  // Keyset pagination for the default list order (updatedAt DESC, id DESC).
  updatedAtIdIdx: index("projects_updatedAt_id_idx").on(table.updatedAt, table.id),
}));

// Department Reviews
export const departmentReviews = mysqlTable("department_reviews", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  department: varchar("department", { length: 64 }).notNull(),
  prueferName: varchar("prueferName", { length: 256 }),
  datum: datetime("datum"),
  status: varchar("status", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projectDeptUnique: uniqueIndex("project_dept_unique").on(table.projectId, table.department),
  projectIdIdx: index("projectId_idx").on(table.projectId),
  departmentIdx: index("department_idx").on(table.department),
  statusIdx: index("status_idx").on(table.status),
}));

// BVB-EEA — DEPRECATED standalone table. The BVB-EEA page is the EEA Gewerk view over the Project aggregate
// (department_reviews); nothing reads or writes this table at runtime. Kept only so existing data is not dropped silently.
export const bvbEea = mysqlTable("bvb_eea", {
  id: int("id").autoincrement().primaryKey(),
  projektnummer: varchar("projektnummer", { length: 64 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  station: varchar("station", { length: 256 }),
  bahnhofsnummer: varchar("bahnhofsnummer", { length: 32 }),
  streckennummer: varchar("streckennummer", { length: 32 }),
  projektbeschreibung: text("projektbeschreibung"),
  projektleiter: varchar("projektleiter", { length: 256 }),
  eigvAnzeige: datetime("eigvAnzeige"),
  datum: datetime("datum"),
  kommentar: text("kommentar"),
  freigabeNummer: varchar("freigabeNummer", { length: 128 }),
  kosteneinsparung: text("kosteneinsparung"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projektnummerIdx: index("bvb_projektnummer_idx").on(table.projektnummer),
}));

// PSV-ITK — DEPRECATED standalone table (see bvb_eea): the page is the ITK Gewerk view over the Project aggregate.
export const psvItk = mysqlTable("psv_itk", {
  id: int("id").autoincrement().primaryKey(),
  projektnummer: varchar("projektnummer", { length: 64 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  station: varchar("station", { length: 256 }),
  bahnhofsnummer: varchar("bahnhofsnummer", { length: 32 }),
  streckennummer: varchar("streckennummer", { length: 32 }),
  projektbeschreibung: text("projektbeschreibung"),
  projektstand: varchar("projektstand", { length: 128 }),
  projektleiter: varchar("projektleiter", { length: 256 }),
  terminProjektvorstellung: datetime("terminProjektvorstellung"),
  itkPruefer: varchar("itkPruefer", { length: 256 }),
  datum: datetime("datum"),
  kommentar: text("kommentar"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projektnummerIdx: index("psv_projektnummer_idx").on(table.projektnummer),
}));

/**
 * Projektanmeldung checklist — the entity behind
 * "Projektanmeldung Fachspezialistenprüfung_neu.xlsm".
 *
 * One row per submitted (or drafted) checklist. The 22 answers live in
 * project_checklist_answers; the header fields of `Formular` rows 6-9 and the
 * four administrative questions (rows 13-16) live here, because they are
 * single-valued and queried directly.
 *
 * The booked slot is denormalised onto this row rather than referencing a
 * termin_slots table: the `Zeit auswählen` calendar arrives in Stage 4, and half
 * an entity is worse than none.
 */
export const projectChecklists = mysqlTable("project_checklists", {
  id: int("id").autoincrement().primaryKey(),
  /** null while the checklist is still a draft — it is what creates the project */
  projectId: int("projectId"),
  /** "Projektanmeldung" | "Projektkonfiguration" — see shared/checklist.ts */
  mode: varchar("mode", { length: 32 }).notNull(),
  status: mysqlEnum("status", ["draft", "submitted", "cancelled"]).default("draft").notNull(),

  // --- Formular rows 6-9 ---------------------------------------------------
  projektnummer: varchar("projektnummer", { length: 256 }),
  projektbezeichnung: varchar("projektbezeichnung", { length: 512 }),
  stationsname: varchar("stationsname", { length: 256 }),
  bahnhofsnummer: varchar("bahnhofsnummer", { length: 32 }),
  streckennummer: varchar("streckennummer", { length: 32 }),
  projektstand: varchar("projektstand", { length: 128 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  projektleitung: varchar("projektleitung", { length: 256 }),

  // --- Formular rows 13-16 (administrative answers) ------------------------
  pkpLink: text("pkpLink"),
  freischaltungFaa: varchar("freischaltungFaa", { length: 64 }),
  unterschriftenblatt: varchar("unterschriftenblatt", { length: 64 }),
  mitProjektvorstellung: varchar("mitProjektvorstellung", { length: 8 }),
  /** only filled when mitProjektvorstellung = "Nein" (Formular G16) */
  uebergabeDatum: datetime("uebergabeDatum"),
  anmerkungen: text("anmerkungen"),

  // --- booked Fachspezialistenprüfung slot ---------------------------------
  terminDatum: datetime("terminDatum"),
  terminVon: varchar("terminVon", { length: 8 }),
  terminBis: varchar("terminBis", { length: 8 }),

  submittedAt: timestamp("submittedAt"),
  submittedBy: varchar("submittedBy", { length: 256 }),
  /** principal id of the author: a draft is visible to its author (and admins) only */
  createdBy: varchar("createdBy", { length: 64 }),
  syncVersion: int("syncVersion").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  checklistProjectIdx: index("checklist_projectId_idx").on(table.projectId),
  checklistStatusIdx: index("checklist_status_idx").on(table.status),
  checklistProjektnummerIdx: index("checklist_projektnummer_idx").on(table.projektnummer),
  checklistTerminIdx: index("checklist_termin_idx").on(table.terminDatum),
  checklistBmIdx: index("checklist_bahnhofsmanagement_idx").on(table.bahnhofsmanagement),
}));

/**
 * One row per checklist question. 22 rows per checklist, keyed by the stable
 * `questionKey` from shared/checklist.ts rather than by the workbook row number,
 * so a future edition of the form cannot silently re-point existing answers.
 */
export const projectChecklistAnswers = mysqlTable("project_checklist_answers", {
  id: int("id").autoincrement().primaryKey(),
  checklistId: int("checklistId").notNull(),
  /** CHECKLIST_QUESTIONS[].key */
  questionKey: varchar("questionKey", { length: 64 }).notNull(),
  /** the Nr. printed in Formular column A — 1-5 and 7-23; there is no 6 */
  nr: int("nr").notNull(),
  /** column F: "Ja" | "Nein" | a Freischaltung option | free text */
  answer: varchar("answer", { length: 512 }),
  /** column H: the second Ja/Nein on rows 17, 18 and 19 only */
  secondary: varchar("secondary", { length: 8 }),
  /** column G */
  comment: text("comment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  answerUnique: uniqueIndex("checklist_question_unique").on(table.checklistId, table.questionKey),
  answerChecklistIdx: index("answer_checklistId_idx").on(table.checklistId),
  answerQuestionIdx: index("answer_questionKey_idx").on(table.questionKey),
}));

/**
 * Fachspezialistenprüfung calendar ("Zeit auswählen"): one row per bookable slot. An aggregate of its own:
 * versioned (optimistic), audited, evented. `bahnhofsmanagement` (resolved from the station) decides who may see
 * the booking's details; everyone sees that a slot is taken, nobody sees whose without access.
 */
export const scheduleSlots = mysqlTable("schedule_slots", {
  id: int("id").autoincrement().primaryKey(),
  /** natural key from the workbook calendar, e.g. "2024-06-04T09:00" */
  slotKey: varchar("slotKey", { length: 32 }).notNull(),
  datum: datetime("datum").notNull(),
  von: varchar("von", { length: 8 }).notNull(),
  bis: varchar("bis", { length: 8 }).notNull(),
  status: mysqlEnum("status", ["Frei", "Gebucht", "Vorgebucht für IM", "Vorgebucht für IT"]).default("Frei").notNull(),
  station: varchar("station", { length: 256 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  projektleitung: varchar("projektleitung", { length: 256 }),
  projektstand: varchar("projektstand", { length: 128 }),
  info: varchar("info", { length: 512 }),
  hinweis: varchar("hinweis", { length: 512 }),
  projectId: int("projectId"),
  checklistId: int("checklistId"),
  syncVersion: int("syncVersion").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  slotKeyUnique: uniqueIndex("slot_key_uq").on(table.slotKey),
  datumIdx: index("slot_datum_idx").on(table.datum),
  statusDatumIdx: index("slot_status_datum_idx").on(table.status, table.datum),
}));

// Audit Log
export const auditLog = mysqlTable("audit_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userName: varchar("userName", { length: 256 }),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: int("entityId").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  field: varchar("field", { length: 128 }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  /**
   * Link to the domain event written in the same transaction. Null for rows
   * written before the event pipeline existed. audit_log is append-only: a
   * database trigger (migration 0004) rejects UPDATE and DELETE.
   */
  eventId: varchar("eventId", { length: 36 }),
  aggregateVersion: int("aggregateVersion"),
  traceId: varchar("traceId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  entityIdx: index("entity_idx").on(table.entityType, table.entityId),
  userIdx: index("user_idx").on(table.userId),
  createdAtIdx: index("createdAt_idx").on(table.createdAt),
}));

/**
 * Transactional outbox AND replay log for domain events.
 *
 * A row is inserted in the same transaction as the aggregate change and its
 * audit rows. The relay publishes unprocessed rows after commit and stamps
 * processedAt. Rows are retained (not deleted on publish) so a client that
 * missed events can be replayed from aggregateVersion.
 *
 * (aggregateType, aggregateId, aggregateVersion) is UNIQUE: two writers can
 * never both produce version N of one aggregate, which is the ordering
 * guarantee the client gap detector relies on.
 */
export const domainEvents = mysqlTable("domain_events", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 36 }).notNull(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  aggregateType: varchar("aggregateType", { length: 32 }).notNull(),
  aggregateId: int("aggregateId").notNull(),
  aggregateVersion: int("aggregateVersion").notNull(),
  /** the full wire envelope, exactly as it is published */
  envelope: json("envelope").notNull(),
  createdAt: datetime("createdAt", { fsp: 3 }).notNull(),
  processedAt: datetime("processedAt", { fsp: 3 }),
  /**
   * Dead letter: set (together with processedAt, so the relay skips the row)
   * when the stored envelope can never be published, e.g. it fails schema
   * validation. Transient bus failures are NOT dead-lettered; they retry.
   * Clients detect the resulting version gap and recover from state.
   */
  failedAt: datetime("failedAt", { fsp: 3 }),
  /**
   * Position in the authoritative change feed. Assigned by the (single) outbox
   * relay in publication order, so it is gapless and commit-ordered — unlike
   * `id`, where a slow transaction can commit after a later id. Clients keep it
   * as their resume cursor; see docs/data-plane.md "Collection recovery".
   */
  feedSeq: bigint("feedSeq", { mode: "number" }),
  failureReason: varchar("failureReason", { length: 512 }),
}, (table) => ({
  eventIdUnique: uniqueIndex("domain_events_eventId_uq").on(table.eventId),
  aggregateVersionUnique: uniqueIndex("domain_events_aggregate_version_uq").on(
    table.aggregateType, table.aggregateId, table.aggregateVersion,
  ),
  // (processedAt, id): measured 0.8 ms vs 26 ms at a 100k backlog — the relay orders by id,
  // and (processedAt, createdAt, id) forced a filesort of the whole backlog every poll.
  feedSeqUnique: uniqueIndex("domain_events_feedSeq_uq").on(table.feedSeq),
  // relay: resume rows that already have a sequence, in sequence order, without scanning processed history
  pendingSeqIdx: index("domain_events_pending_seq_idx").on(table.processedAt, table.feedSeq),
  outboxIdx: index("domain_events_outbox_idx").on(table.processedAt, table.id),
}));

/**
 * Idempotency ledger. Inserted inside the mutation's own transaction, so the
 * key exists if and only if the side effects committed.
 */
export const idempotencyKeys = mysqlTable("idempotency_keys", {
  actorId: varchar("actorId", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
  operation: varchar("operation", { length: 64 }).notNull(),
  /** sha256 of the canonical request, so a reused key with a new body is rejected */
  requestHash: varchar("requestHash", { length: 64 }).notNull(),
  response: json("response"),
  createdAt: datetime("createdAt", { fsp: 3 }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.actorId, table.idempotencyKey] }),
  createdAtIdx: index("idempotency_createdAt_idx").on(table.createdAt),
}));

/**
 * User notifications, produced inside the same transaction as the change that
 * caused them (domain event → policy → row + outbox event → realtime → center).
 * `workspace` lets reads re-check the recipient's CURRENT workspace access.
 */
export const notifications = mysqlTable("notifications", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** principal id of the recipient */
  userId: varchar("userId", { length: 64 }).notNull(),
  kind: mysqlEnum("kind", ["critical", "workflow", "assignment", "mention", "deadline", "system"]).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  body: varchar("body", { length: 1024 }),
  link: varchar("link", { length: 256 }),
  workspace: varchar("workspace", { length: 128 }),
  /** the domain event that caused it */
  eventId: varchar("eventId", { length: 36 }).notNull(),
  createdAt: datetime("createdAt", { fsp: 3 }).notNull(),
  readAt: datetime("readAt", { fsp: 3 }),
}, (table) => ({
  userIdx: index("notifications_user_idx").on(table.userId, table.id),
  userEventUnique: uniqueIndex("notifications_user_event_uq").on(table.userId, table.eventId),
}));

/** Who follows which project (the recipient set of the current notification policy). */
export const projectWatchers = mysqlTable("project_watchers", {
  projectId: int("projectId").notNull(),
  userId: varchar("userId", { length: 64 }).notNull(),
  createdAt: datetime("createdAt", { fsp: 3 }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.userId] }),
  userIdx: index("watchers_user_idx").on(table.userId),
}));

// Relations
/**
 * Geo read model: where a project sits on the map. Derived from the station master (stations.json) by
 * shared/stationGeo.ts and maintained in the SAME transaction as the project write (station /
 * bahnhofsmanagement changes), so a map query is one indexed range scan — never a table scan, never a
 * per-request name-matching pass. Rebuildable from `projects` at any time (server/infra/geoModel.ts).
 */
export const projectGeo = mysqlTable("project_geo", {
  projectId: int("projectId").primaryKey(),
  lat: double("lat").notNull(),
  lng: double("lng").notNull(),
  /** "<Bf. Nr.>" for a real station, "~bm:<BM>" for the regional fallback */
  stationKey: varchar("stationKey", { length: 64 }).notNull(),
  stationName: varchar("stationName", { length: 255 }).notNull(),
  precision: mysqlEnum("precision", ["exact", "tokens", "fuzzy", "region"]).notNull(),
}, (table) => ({
  latLngIdx: index("project_geo_lat_lng_idx").on(table.lat, table.lng),
  stationIdx: index("project_geo_station_idx").on(table.stationKey),
}));

/**
 * Dashboard read models: pre-aggregated counters per workspace, updated from the domain write path
 * (same transaction) so a dashboard request is a handful of tiny indexed reads and never a GROUP BY over the
 * review table. A restricted principal reads only the rows of its own workspaces. Rebuildable
 * (server/infra/readModels.ts#rebuildReadModels), and verified against a recompute in tests.
 */
export const rmProjectStats = mysqlTable("rm_project_stats", {
  workspace: varchar("workspace", { length: 128 }).notNull(),
  projects: int("projects").notNull().default(0),
}, (table) => ({ pk: primaryKey({ columns: [table.workspace] }) }));

export const rmReviewStats = mysqlTable("rm_review_stats", {
  workspace: varchar("workspace", { length: 128 }).notNull(),
  department: varchar("department", { length: 64 }).notNull(),
  /** '' stands for "no status" so the key is total */
  status: varchar("status", { length: 128 }).notNull(),
  n: int("n").notNull().default(0),
}, (table) => ({ pk: primaryKey({ columns: [table.workspace, table.department, table.status] }) }));

export const rmPrueferLoad = mysqlTable("rm_pruefer_load", {
  workspace: varchar("workspace", { length: 128 }).notNull(),
  pruefer: varchar("pruefer", { length: 256 }).notNull(),
  n: int("n").notNull().default(0),
}, (table) => ({ pk: primaryKey({ columns: [table.workspace, table.pruefer] }) }));

/**
 * Unread-notification counter per (recipient, workspace): the bell reads a few rows instead of COUNT(*) over the
 * inbox, and a workspace-restricted recipient sums only the workspaces they may still see.
 */
export const notificationUnread = mysqlTable("notification_unread", {
  userId: varchar("userId", { length: 64 }).notNull(),
  /** '' = notification without a workspace */
  workspace: varchar("workspace", { length: 128 }).notNull(),
  n: int("n").notNull().default(0),
}, (table) => ({ pk: primaryKey({ columns: [table.userId, table.workspace] }) }));

export const projectsRelations = relations(projects, ({ many }) => ({
  reviews: many(departmentReviews),
  checklists: many(projectChecklists),
}));

export const departmentReviewsRelations = relations(departmentReviews, ({ one }) => ({
  project: one(projects, {
    fields: [departmentReviews.projectId],
    references: [projects.id],
  }),
}));

export const projectChecklistsRelations = relations(projectChecklists, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectChecklists.projectId],
    references: [projects.id],
  }),
  answers: many(projectChecklistAnswers),
}));

export const projectChecklistAnswersRelations = relations(projectChecklistAnswers, ({ one }) => ({
  checklist: one(projectChecklists, {
    fields: [projectChecklistAnswers.checklistId],
    references: [projectChecklists.id],
  }),
}));

// Type exports
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type ScheduleSlot = typeof scheduleSlots.$inferSelect;
export type DepartmentReview = typeof departmentReviews.$inferSelect;
export type InsertDepartmentReview = typeof departmentReviews.$inferInsert;
export type BvbEea = typeof bvbEea.$inferSelect;
export type InsertBvbEea = typeof bvbEea.$inferInsert;
export type PsvItk = typeof psvItk.$inferSelect;
export type InsertPsvItk = typeof psvItk.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;
export type DomainEventRow = typeof domainEvents.$inferSelect;
export type ProjectChecklist = typeof projectChecklists.$inferSelect;
export type InsertProjectChecklist = typeof projectChecklists.$inferInsert;
export type ProjectChecklistAnswer = typeof projectChecklistAnswers.$inferSelect;
export type InsertProjectChecklistAnswer = typeof projectChecklistAnswers.$inferInsert;
