import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, datetime, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
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
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Projects table - main entity representing a Bahnhof project.
 * Each row corresponds to one row in the Excel Übersichtsliste.
 */
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  projektnummer: varchar("projektnummer", { length: 256 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  station: varchar("station", { length: 256 }),
  bahnhofsnummer: varchar("bahnhofsnummer", { length: 32 }),
  streckennummer: varchar("streckennummer", { length: 32 }),
  projektbeschreibung: text("projektbeschreibung"),
  eigvEinstufung: text("eigvEinstufung"),
  projektleiter: varchar("projektleiter", { length: 256 }),
  kommentar: text("kommentar"),
  projektLink: text("projektLink"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Department reviews - stores the review status for each of the 14 departments per project.
 * Each project has up to 14 department review records.
 */
export const departmentReviews = mysqlTable("department_reviews", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  department: varchar("department", { length: 64 }).notNull(),
  prueferName: varchar("prueferName", { length: 256 }),
  datum: datetime("datum"),
  status: varchar("status", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DepartmentReview = typeof departmentReviews.$inferSelect;
export type InsertDepartmentReview = typeof departmentReviews.$inferInsert;

/**
 * BVB-EEA table - stores EEA Freigabe records.
 */
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
});

export type BvbEea = typeof bvbEea.$inferSelect;
export type InsertBvbEea = typeof bvbEea.$inferInsert;

/**
 * PSV-ITK table - stores ITK Projektvorstellung records.
 */
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
});

export type PsvItk = typeof psvItk.$inferSelect;
export type InsertPsvItk = typeof psvItk.$inferInsert;

/**
 * Audit log - tracks all changes to projects and reviews.
 */
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
});

export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;
