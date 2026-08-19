import {
  int, mysqlEnum, mysqlTable, text, timestamp, varchar, datetime, json,
  index, uniqueIndex
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

// BVB-EEA
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

// PSV-ITK
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  entityIdx: index("entity_idx").on(table.entityType, table.entityId),
  userIdx: index("user_idx").on(table.userId),
  createdAtIdx: index("createdAt_idx").on(table.createdAt),
}));

// Relations
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
export type DepartmentReview = typeof departmentReviews.$inferSelect;
export type InsertDepartmentReview = typeof departmentReviews.$inferInsert;
export type BvbEea = typeof bvbEea.$inferSelect;
export type InsertBvbEea = typeof bvbEea.$inferInsert;
export type PsvItk = typeof psvItk.$inferSelect;
export type InsertPsvItk = typeof psvItk.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;
export type ProjectChecklist = typeof projectChecklists.$inferSelect;
export type InsertProjectChecklist = typeof projectChecklists.$inferInsert;
export type ProjectChecklistAnswer = typeof projectChecklistAnswers.$inferSelect;
export type InsertProjectChecklistAnswer = typeof projectChecklistAnswers.$inferInsert;
