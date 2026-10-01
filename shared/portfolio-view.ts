/**
 * Dashboard portfolio derivation (pure, shared). The server feeds it ONE lean, authorization-scoped row query, caches
 * the result per authorization scope with single-flight, so N viewers cost one computation per TTL — never a scan
 * per request, never a dataset download. Figures that depend on "today" (overdue, aging, upcoming) cannot be
 * incrementally maintained counters, hence the TTL model for them; the date-independent counters stay in the rm_*
 * tables (server/infra/readModels.ts). The static demo build runs this same function over its local rows, so the
 * page has exactly one data shape.
 */
import { agingOfOpenReviews, dataQuality, gewerkStandings, reviewerConcentration, type PortfolioProject } from "./portfolio-metrics";
import { countBedarf, requiredTones } from "./handlungsbedarf";
import { deriveProjectMetrics } from "./project-metrics";
import { APPROVED_STATUSES, OPEN_STATUSES, normalizeReviewStatus } from "./review-status";
import { buildReel } from "./gewerk-reel";
import { toDate } from "./date";
import { startOfDayUtc } from "./drilldown";
import { PORTFOLIO_GEWERKE, type PortfolioView, type ReelView, type UpcomingRow, type WorkloadRow } from "./portfolio-contract";


export function buildPortfolio(projects: readonly PortfolioProject[], nowMs: number): PortfolioView {
  const today = startOfDayUtc(nowMs);
  const metrics = deriveProjectMetrics(projects as never);
  const open = OPEN_STATUSES as readonly string[];
  const done = APPROVED_STATUSES as readonly string[];

  let delayedProjects = 0;
  let totalReviews = 0;
  let unmappedStatusRows = 0;
  const regions = new Map<string, number>();
  let withoutRegion = 0;
  const byName = new Map<string, WorkloadRow>();
  const upcoming: Array<UpcomingRow & { t: number }> = [];

  for (const p of projects) {
    const bm = (p.bahnhofsmanagement ?? "").trim();
    if (bm) regions.set(bm, (regions.get(bm) ?? 0) + 1); else withoutRegion++;
    const termin = toDate(p.terminProjektvorstellung ?? null);
    let stillOpen = false;
    for (const r of p.reviews ?? []) {
      totalReviews++;
      const status = normalizeReviewStatus(r.status);
      if (r.status && status === null) unmappedStatusRows++;
      const isOpen = status !== null && open.includes(status);
      if (isOpen) stillOpen = true;
      const name = (r.prueferName ?? "").trim();
      if (name) {
        const w = byName.get(name) ?? { name, incoming: 0, completed: 0, total: 0, timeline: [] };
        if (isOpen) w.incoming++;
        if (status !== null && done.includes(status)) w.completed++;
        if (r.pruefDatum) w.timeline.push({ date: r.pruefDatum, action: status ?? r.status ?? "Update", project: p.station || p.projektnummer || "Ohne Station", department: r.department, projectId: p.id });
        byName.set(name, w);
      }
      if (isOpen) {
        const due = toDate(r.pruefDatum ?? null);
        if (due) upcoming.push({ t: due.getTime(), projectId: p.id, station: p.station || p.projektnummer || `Projekt ${p.id}`, department: r.department, due: due.toISOString().slice(0, 10), status: status!, reviewer: name || null, overdue: due.getTime() < today });
      }
    }
    if (termin && termin.getTime() < today && stillOpen) delayedProjects++;
  }

  const workload: WorkloadRow[] = [...byName.values()]
    .map(w => ({ ...w, total: w.incoming + w.completed, timeline: w.timeline.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8) }))
    .filter(w => w.total > 0)
    .sort((a, b) => b.total - a.total);

  const all = requiredTones(projects);
  return {
    asOf: nowMs,
    metrics,
    delayedProjects,
    totalReviews,
    regions: [...regions].sort((a, b) => b[1] - a[1]).map(([region, count]) => ({ region, count })),
    withoutRegion,
    standings: gewerkStandings(projects, PORTFOLIO_GEWERKE, today),
    tones: { ...all, unmappedStatusRows },
    gewerke: PORTFOLIO_GEWERKE.map(name => ({ name, ...requiredTones(projects, name) })),
    aging: agingOfOpenReviews(projects, today),
    concentration: reviewerConcentration(projects),
    quality: dataQuality(projects),
    bedarf: countBedarf(projects, today),
    workload,
    upcoming: upcoming.sort((a, b) => a.t - b.t).slice(0, 12).map(({ t: _t, ...u }) => u),
  };
}

export function buildReelView(projects: readonly PortfolioProject[], department: string, audit: Parameters<typeof buildReel>[1], limit = 6): ReelView {
  return { department, entries: buildReel(projects, audit, department, limit) };
}
