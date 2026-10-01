/**
 * Wire contract of the Dashboard's server read model (`dashboard.portfolio`, `dashboard.reel`).
 *
 * The server derives every figure with the SAME shared predicates the UI used to run in the browser
 * (portfolio-metrics, handlungsbedarf, project-metrics) over the caller's authorized rows, once per
 * (scope, TTL). The browser receives finished numbers and never the dataset.
 */
import type { BedarfCount, RequiredTones } from "./handlungsbedarf";
import type { Aging, Concentration, DataQuality, GewerkStanding } from "./portfolio-metrics";
import type { ProjectMetrics } from "./project-metrics";
import type { ReelEntry } from "./gewerk-reel";

export const PORTFOLIO_GEWERKE = [
  "EEA", "ITK", "BS", "GA", "Energie", "HFT", "HKLS",
  "TBQ", "UM", "BIM", "LST", "Vermessung",
  "Baubetriebstechnologie", "Baubetriebsplanung",
] as const;

export interface WorkloadRow {
  name: string;
  incoming: number;
  completed: number;
  total: number;
  /** Most recent dated reviews only (bounded); the full history is one project click away. */
  timeline: Array<{ date: string; action: string; project: string; department: string; projectId: number }>;
}

export interface UpcomingRow {
  projectId: number;
  station: string;
  department: string;
  /** ISO day */
  due: string;
  status: string;
  reviewer: string | null;
  overdue: boolean;
}

export interface PortfolioView {
  /** Epoch ms the figures were computed for ("today" is pinned server-side). */
  asOf: number;
  metrics: ProjectMetrics;
  delayedProjects: number;
  totalReviews: number;
  regions: Array<{ region: string; count: number }>;
  withoutRegion: number;
  standings: GewerkStanding[];
  tones: RequiredTones & { unmappedStatusRows: number };
  gewerke: Array<{ name: string; slices: RequiredTones["slices"]; required: number; notRequired: number }>;
  aging: Aging;
  concentration: Concentration;
  quality: DataQuality;
  bedarf: BedarfCount[];
  workload: WorkloadRow[];
  upcoming: UpcomingRow[];
}

export interface ReelView { department: string; entries: ReelEntry[] }
