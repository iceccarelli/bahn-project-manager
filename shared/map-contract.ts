/** Map query contract: bounding box + zoom (+ the same filters as the list) in, lightweight markers out. */
import { z } from "zod";

export const MapQuerySchema = z.object({
  bbox: z.object({
    minLat: z.number().min(-90).max(90), maxLat: z.number().min(-90).max(90),
    minLng: z.number().min(-180).max(180), maxLng: z.number().min(-180).max(180),
  }).refine(b => b.minLat <= b.maxLat && b.minLng <= b.maxLng, "bbox is inverted"),
  zoom: z.number().int().min(0).max(20),
  search: z.string().trim().max(100).optional(),
  bahnhofsmanagement: z.string().max(128).optional(),
  projektstand: z.string().max(256).optional(),
  projektleiter: z.string().max(256).optional(),
  department: z.string().max(64).optional(),
  reviewStatus: z.string().max(128).optional(),
  pruefer: z.string().max(256).optional(),
});
export type MapQuery = z.infer<typeof MapQuerySchema>;

/** At or above this zoom the server returns individual stations (when few enough); below, grid clusters. */
export const MAP_POINT_ZOOM = 10;
/** Never more than this many markers per response; beyond it the server clusters instead. */
export const MAP_MAX_MARKERS = 1500;

export interface MapCluster { kind: "cluster"; key: string; lat: number; lng: number; count: number }
export interface MapStation {
  kind: "station"; key: string; name: string; lat: number; lng: number; count: number;
  /** how the station was matched: only "exact" sits on the real station */
  precision: "exact" | "tokens" | "fuzzy" | "region";
}
export interface MapResult { mode: "clusters" | "stations"; markers: Array<MapCluster | MapStation>; total: number }

export const MapStationQuerySchema = MapQuerySchema.omit({ bbox: true, zoom: true }).extend({ stationKey: z.string().min(1).max(64) });
export type MapStationQuery = z.infer<typeof MapStationQuerySchema>;
export interface MapStationProjects { stationKey: string; total: number; projects: Array<{ id: number; projektnummer: string | null; station: string | null; projektstand: string | null; projektleiter: string | null }> }

/** Grid cell size (degrees) for a zoom level: roughly an 80-pixel cell on a 256-pixel tile. */
export const clusterCellDegrees = (zoom: number) => 112.5 / 2 ** zoom;
