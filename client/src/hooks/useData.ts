/**
 * useData.ts — Backward Compatibility Bridge
 * 
 * This file re-exports hooks from useDataQuery.ts to ensure existing pages
 * (PsvItk.tsx, BvbEea.tsx, etc.) continue to work without modification.
 */

export * from "./useDataQuery";

// Re-export types that might be used elsewhere
export type { Project, Review, Stats, Filters } from "./useDataQuery";
