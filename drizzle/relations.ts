/**
 * Drizzle relations.
 *
 * This file used to redeclare projectsRelations and departmentReviewsRelations
 * verbatim while also doing `export * from "./schema"`. Two `export *` sources
 * exporting the same name makes that name ambiguous, so it was silently dropped
 * from `@shared/drizzle`. The relations live in ./schema.ts next to the tables
 * they describe; this module is now a single re-export point.
 */
export * from "./schema";
