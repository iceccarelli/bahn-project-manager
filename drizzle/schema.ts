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
}));

export const departmentReviewsRelations = relations(departmentReviews, ({ one }) => ({
  project: one(projects, {
    fields: [departmentReviews.projectId],
    references: [projects.id],
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
