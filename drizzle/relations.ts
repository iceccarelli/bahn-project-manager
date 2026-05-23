import { relations } from "drizzle-orm";
import { projects, departmentReviews } from "./schema";

/**
 * Drizzle relations for perfect type-safe querying.
 * Enables .with('reviews') or nested includes in OData expand.
 * Matches the 1:1 project <-> department_reviews (1-to-many).
 */
export const projectsRelations = relations(projects, ({ many }) => ({
  reviews: many(departmentReviews),
}));

export const departmentReviewsRelations = relations(departmentReviews, ({ one }) => ({
  project: one(projects, {
    fields: [departmentReviews.projectId],
    references: [projects.id],
  }),
}));

// Re-export for convenience in shared/drizzle
export * from "./schema";
