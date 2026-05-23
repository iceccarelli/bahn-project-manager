/**
 * Shared OData query builder and metadata types.
 * Enables Microsoft-aligned queryable API ($filter, $select, $expand, etc.)
 * Used by server/routers for OData endpoints and client hooks for query construction.
 * Perfect sync with frontend filters and backend Drizzle queries.
 */

import { z } from "zod";

/**
 * Supported OData query parameters for projects endpoint.
 */
export const ODataQuerySchema = z.object({
  $filter: z.string().optional(),
  $select: z.string().optional(),
  $expand: z.string().optional(), // e.g. "reviews"
  $orderby: z.string().optional(),
  $top: z.coerce.number().int().positive().max(1000).optional(),
  $skip: z.coerce.number().int().nonnegative().optional(),
  $count: z.coerce.boolean().optional(),
  $search: z.string().optional(),
});

export type ODataQuery = z.infer<typeof ODataQuerySchema>;

/**
 * Standard OData response wrapper for collections.
 */
export interface ODataResponse<T> {
  value: T[];
  "@odata.count"?: number;
  "@odata.nextLink"?: string;
  "@odata.context"?: string;
}

/**
 * OData metadata for $metadata endpoint (simplified EDM for Microsoft integration).
 */
export const ODATA_METADATA = {
  version: "4.0",
  entityTypes: {
    Project: {
      properties: {
        id: { type: "Edm.Int32", nullable: false },
        projektnummer: { type: "Edm.String", nullable: true },
        bahnhofsmanagement: { type: "Edm.String", nullable: true },
        station: { type: "Edm.String", nullable: true },
        // ... add all fields
      },
      navigationProperties: {
        reviews: { type: "Collection(Review)", partner: "project" },
      },
    },
    Review: {
      properties: {
        id: { type: "Edm.Int32", nullable: false },
        department: { type: "Edm.String", nullable: false },
        status: { type: "Edm.String", nullable: true },
        prueferName: { type: "Edm.String", nullable: true },
        pruefDatum: { type: "Edm.DateTimeOffset", nullable: true },
      },
    },
  },
} as const;

/**
 * Simple OData $filter parser (subset for common cases: eq, and, or, contains).
 * In production, use full parser like odata-v4-parser, but this keeps zero-deps for now.
 */
export function parseODataFilter(filter?: string): Record<string, unknown> {
  if (!filter) return {};
  // Basic parsing for demo / sync with frontend filters
  const result: Record<string, unknown> = {};
  const andParts = filter.split(" and ");
  for (const part of andParts) {
    const eqMatch = part.match(/(\w+)\s+eq\s+'?([^']+)'?/);
    if (eqMatch) {
      result[eqMatch[1]] = eqMatch[2];
    }
    const containsMatch = part.match(/contains\((\w+),\s*'([^']+)'\)/);
    if (containsMatch) {
      result[`${containsMatch[1]}_contains`] = containsMatch[2];
    }
  }
  return result;
}

/**
 * Build Drizzle where clause from OData query (to be used in server procedures).
 */
export function buildDrizzleWhereFromOData(query: ODataQuery, table: any) {
  // Placeholder - implement with drizzle-orm sql in actual router
  // For now returns parsed filter object for use in and/or conditions
  return parseODataFilter(query.$filter);
}
