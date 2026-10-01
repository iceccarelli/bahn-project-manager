/**
 * The Projekte page's secondary data, per data plane.
 *
 *   local mode   the in-browser dataset (unchanged behaviour)
 *   server mode  KPIs from a server read model; the detail dialog from the live
 *                project query; "corpus" = only the rows the server has paged in.
 *                Corpus-wide reconciliation counts (Handlungsbedarf/tone chips)
 *                need the whole dataset and are therefore NOT offered in server
 *                mode — showing a count over 100 loaded rows as if it were the
 *                total would be a lie.
 *
 * SERVER_MODE is a build-time constant: exactly one branch of hooks runs for the
 * lifetime of the app.
 */
import { useMemo } from "react";
import { deriveProjectMetrics, type ProjectMetrics } from "@shared/project-metrics";
import { SERVER_MODE } from "@/realtime/serverApi";
import { useServerMetrics, useServerProjectDetail } from "@/realtime/serverProjects";
import { useAllData, type Project } from "@/hooks/useDataQuery";

export interface PageExtras {
  metrics: ProjectMetrics;
  detailProject: Project | null;
  /** rows available for id-lookups (station focus); null = unavailable */
  corpus: Project[] | null;
  /** counts over the whole dataset are only possible when true */
  hasWholeDataset: boolean;
}

function useLocalExtras(_rows: Project[], detailId: number | null): PageExtras {
  const { data } = useAllData();
  const metrics = useMemo(() => deriveProjectMetrics(data?.projects), [data?.projects]);
  const detailProject = useMemo(
    () => (detailId == null ? null : ((data?.projects ?? []).find(p => p.id === detailId) ?? null)),
    [detailId, data],
  );
  return { metrics, detailProject, corpus: data?.projects ?? [], hasWholeDataset: true };
}

function useServerExtras(rows: Project[], detailId: number | null): PageExtras {
  const { metrics } = useServerMetrics();
  const detailProject = useServerProjectDetail(detailId);
  return { metrics, detailProject, corpus: rows, hasWholeDataset: false };
}

export const useProjectsPageExtras: (rows: Project[], detailId: number | null) => PageExtras = SERVER_MODE ? useServerExtras : useLocalExtras;
