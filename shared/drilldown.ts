/**
 * Dashboard drill-downs: "show me exactly the projects behind this number".
 *
 * A drill is evaluated by the SERVER over the caller's authorized rows with the SAME shared predicates the Dashboard's
 * counts use (handlungsbedarf.ts), pinned to the same day. The browser sends the small drill descriptor, never an id
 * list of the dataset, and never filters a partially loaded page itself — so a badge's number and the list it opens cannot
 * disagree, and an id outside the caller's workspaces cannot be reached.
 */
import { z } from "zod";
import { projectMatchesBedarf, projectMatchesTone } from "./handlungsbedarf";
import type { PortfolioProject } from "./portfolio-metrics";
import { TONE_APPEARANCE, type StatusTone } from "./status-appearance";

const TONES = Object.keys(TONE_APPEARANCE) as [StatusTone, ...StatusTone[]];

export const DrillSchema = z.object({
  bedarf: z.enum(["overdue", "blocked", "nachforderung", "unassigned"]).optional(),
  tone: z.enum(TONES).optional(),
  /** narrows `tone` to one Gewerk INSIDE the predicate (not a second, independent filter) */
  department: z.string().min(1).max(64).optional(),
  /** an explicit small id set (a map station group, one project); still intersected with authorization */
  ids: z.array(z.number().int().positive()).min(1).max(500).optional(),
}).strict();
export type Drill = z.infer<typeof DrillSchema>;

export const isEmptyDrill = (d: Drill | undefined): boolean => !d || (d.bedarf === undefined && d.tone === undefined && d.ids === undefined);

/** Ids (within `projects`, i.e. already authorized) matching every part of the drill. `null` = no restriction. */
export function drillProjectIds(projects: readonly PortfolioProject[], drill: Drill | undefined, today: number): Set<number> | null {
  if (isEmptyDrill(drill)) return null;
  const d = drill!;
  const wanted = d.ids ? new Set(d.ids) : null;
  const out = new Set<number>();
  for (const p of projects) {
    if (wanted && !wanted.has(p.id)) continue;
    if (d.bedarf && !projectMatchesBedarf(p, d.bedarf, today)) continue;
    if (d.tone && !projectMatchesTone(p, d.tone, d.department)) continue;
    out.add(p.id);
  }
  return out;
}

/** The pinned "today" (UTC midnight) every dashboard figure and every drill is computed against. */
export const startOfDayUtc = (ms: number) => Math.floor(ms / 86_400_000) * 86_400_000;
