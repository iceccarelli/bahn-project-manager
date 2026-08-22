import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { apiClient } from "@/_core/api/client";
import { BAHNHOFSMANAGEMENT } from "@shared/bahnhofsmanagement";
import type {
  ProjectUpdateInput,
  ReviewUpdateInput,
  ProjectCreateInput,
} from "@/_core/api/client";

// ============================================================================
// TYPE DEFINITIONS (harmonized with types.ts and data.json)
// ============================================================================

export interface Review {
  department: string;
  status: string | null;
  prueferName: string | null;
  pruefDatum: string | null;
}

export interface Project {
  id: number;
  projektnummer: string | null;
  bahnhofsmanagement: string | null;
  station: string | null;
  bahnhofsnummer: string | null;
  streckennummer: string | null;
  projektbeschreibung: string | null;
  projektstand: string | null;
  projektleiter: string | null;
  terminProjektvorstellung: string | null;
  kommentar: string | null;
  projektLink: string | null;
  reviews: Review[];
}

export interface Stats {
  totalProjects: number;
  statusDistribution: Array<{ status: string; count: number }>;
  regionStats: Array<{ region: string; count: number }>;
  prueferWorkload: Array<{ name: string; count: number }>;
  departmentStats: Array<{ department: string; status: string; count: number }>;
}

export interface Filters {
  regions: string[];
  projektleiter: string[];
  pruefer: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  details: string;
}

// ============================================================================
// QUERY KEYS
// ============================================================================

export const queryKeys = {
  projects: {
    all: ["projects"] as const,
    list: (params: any) => [...queryKeys.projects.all, "list", params] as const,
    detail: (id: number) => [...queryKeys.projects.all, "detail", id] as const,
  },
  stats: {
    all: ["stats"] as const,
    dashboard: () => [...queryKeys.stats.all, "dashboard"] as const,
  },
  audit: {
    all: ["audit"] as const,
    list: () => [...queryKeys.audit.all, "list"] as const,
  },
};

// ============================================================================
// QUERY HOOKS
// ============================================================================

export function useAllProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list({ showAll: true }),
    queryFn: async () => {
      const projects = await apiClient.projects.list();
      return { projects };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useProject(id: number) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => apiClient.projects.get(id),
  });
}

export function useDashboardStats() {
  return useQuery({
    queryKey: queryKeys.stats.dashboard(),
    queryFn: () => apiClient.dashboard.getStats(),
  });
}

export function useAuditLog() {
  return useQuery({
    queryKey: queryKeys.audit.list(),
    queryFn: () => apiClient.audit.list(),
  });
}

export function useRecordAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, details }: { action: string; details: string }) =>
      apiClient.audit.record(action, details),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProjectCreateInput) => apiClient.projects.create(input),
    onSuccess: (newProject) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
      queryClient.setQueryData(queryKeys.projects.detail(newProject.id), newProject);
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProjectUpdateInput) => apiClient.projects.update(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all });
      const previousProjectsData = queryClient.getQueryData<{ projects: Project[] }>(queryKeys.projects.list({ showAll: true }));

      if (previousProjectsData?.projects) {
        const updated = previousProjectsData.projects.map((p) =>
          p.id === input.id ? { ...p, [input.field]: input.value } : p
        );
        queryClient.setQueryData(queryKeys.projects.list({ showAll: true }), { projects: updated });
      }

      return { previousProjectsData };
    },
    onError: (err, _input, context) => {
      if (context?.previousProjectsData?.projects) {
        queryClient.setQueryData(queryKeys.projects.list({ showAll: true }), context.previousProjectsData);
      }
      // Without this the rollback was silent: the cell reverted to its old
      // value and the user was never told the write had been refused, which
      // reads as the app losing their typing.
      toast.error(err instanceof Error ? err.message : "Änderung wurde abgelehnt");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
      // Every one of these mutations calls recordAudit(). Without this the
      // Änderungshistorie served a cached list and an edit only appeared after
      // a hard reload — which nobody noticed, because the page that reads it
      // was a placeholder that rendered nothing at all.
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}

export function useUpdateReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ReviewUpdateInput) => apiClient.reviews.update(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all });
      const previousProjectsData = queryClient.getQueryData<{ projects: Project[] }>(queryKeys.projects.list({ showAll: true }));

      if (previousProjectsData?.projects) {
        const updated = previousProjectsData.projects.map((p) => {
          if (p.id !== input.projectId) return p;
          return {
            ...p,
            reviews: p.reviews.map((r) =>
              r.department === input.department
                ? { ...r, [input.field]: input.value }
                : r
            ),
          };
        });
        queryClient.setQueryData(queryKeys.projects.list({ showAll: true }), { projects: updated });
      }

      return { previousProjectsData };
    },
    onError: (err, _input, context) => {
      if (context?.previousProjectsData?.projects) {
        queryClient.setQueryData(queryKeys.projects.list({ showAll: true }), context.previousProjectsData);
      }
      // Without this the rollback was silent: the cell reverted to its old
      // value and the user was never told the write had been refused, which
      // reads as the app losing their typing.
      toast.error(err instanceof Error ? err.message : "Änderung wurde abgelehnt");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
      // Every one of these mutations calls recordAudit(). Without this the
      // Änderungshistorie served a cached list and an edit only appeared after
      // a hard reload — which nobody noticed, because the page that reads it
      // was a placeholder that rendered nothing at all.
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiClient.projects.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
      // Every one of these mutations calls recordAudit(). Without this the
      // Änderungshistorie served a cached list and an edit only appeared after
      // a hard reload — which nobody noticed, because the page that reads it
      // was a placeholder that rendered nothing at all.
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}

// ============================================================================
// COMPOSITE HOOKS
// ============================================================================

/**
 * The two write helpers every table cell uses.
 *
 * They lived inside useProjects, so a page that wanted to edit a row had to
 * take on the whole filter-and-sort pipeline to get at them — which is why the
 * Gewerk tables were read-only. They are the same two mutations either way:
 * optimistic, rolled back and toasted on refusal, and audited through
 * recordAudit, so an edit made on BVB-EEA reaches the Änderungshistorie
 * identically to one made on Projekte.
 *
 * `field as any` used to sit in both, which threw away the one guarantee the
 * input type provided: a mistyped field name compiled cleanly and only
 * surfaced as a silently-wrong write at runtime.
 */
export function useProjectEdits() {
  const updateProjectMutation = useUpdateProject();
  const updateReviewMutation = useUpdateReview();

  const applyEdit = useCallback(
    (projectId: number, field: ProjectUpdateInput["field"], value: string) => {
      updateProjectMutation.mutate({ id: projectId, field, value });
    },
    [updateProjectMutation],
  );

  const applyReviewEdit = useCallback(
    (
      projectId: number,
      departmentName: string,
      field: ReviewUpdateInput["field"],
      value: string,
    ) => {
      updateReviewMutation.mutate({ projectId, department: departmentName, field, value });
    },
    [updateReviewMutation],
  );

  return {
    applyEdit,
    applyReviewEdit,
    /** True while either write is in flight. */
    isWriting: updateProjectMutation.isPending || updateReviewMutation.isPending,
  };
}

export function useProjects(params: {
  search?: string;
  region?: string;
  projektleiter?: string;
  pruefer?: string;
  status?: string;
  department?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  showAll?: boolean;
  /*
   * minLat / maxLat / minLng / maxLng were declared here and never
   * destructured or used in the filter memo below. The Projekte page passed
   * them from the map's onBoundsChange on every pan and zoom, so the map
   * looked like it filtered the table and did not. Declaring a parameter you
   * ignore is worse than not accepting it: the type says the feature exists.
   */
}) {
  const { data: allProjectsData, isLoading: allProjectsLoading } = useAllProjects();
  const { isWriting } = useProjectEdits();
  const createProjectMutation = useCreateProject();

  const {
    search,
    region,
    projektleiter,
    pruefer,
    status,
    department,
    sortBy = "id",
    sortDir = "asc",
  } = params;

  const result = useMemo(() => {
    const allProjects = allProjectsData?.projects || [];

    if (!allProjects || allProjects.length === 0) {
      return { projects: [], total: 0 };
    }

    let filtered = [...allProjects];

    if (search) {
      const s = search.toLowerCase().trim();
      const searchTerms = s.split(/\s+/);
      
      filtered = filtered.filter((p) => {
        return searchTerms.every((term) => {
          const lowerTerm = term.toLowerCase();
          return (
            (String(p.station ?? "").toLowerCase()).includes(lowerTerm) ||
            (String(p.projektbeschreibung ?? "").toLowerCase()).includes(lowerTerm) ||
            (String(p.projektnummer ?? "").toLowerCase()).includes(lowerTerm) ||
            (String(p.projektleiter ?? "").toLowerCase()).includes(lowerTerm) ||
            (String(p.bahnhofsmanagement ?? "").toLowerCase()).includes(lowerTerm) ||
            (String(p.projektstand ?? "").toLowerCase()).includes(lowerTerm) ||
            (String(p.bahnhofsnummer ?? "").toLowerCase()).includes(lowerTerm) ||
            (String(p.streckennummer ?? "").toLowerCase()).includes(lowerTerm) ||
            (String(p.kommentar ?? "").toLowerCase()).includes(lowerTerm) ||
            p.reviews?.some((r) =>
              (String(r.prueferName ?? "").toLowerCase()).includes(lowerTerm) ||
              (String(r.department ?? "").toLowerCase()).includes(lowerTerm) ||
              (String(r.status ?? "").toLowerCase()).includes(lowerTerm)
            )
          );
        });
      });
    }

    if (region) filtered = filtered.filter((p) => p.bahnhofsmanagement === region);
    if (projektleiter) filtered = filtered.filter((p) => p.projektleiter === projektleiter);
    if (pruefer) filtered = filtered.filter((p) => p.reviews?.some((r) => r.prueferName === pruefer));
    if (department) filtered = filtered.filter((p) => p.reviews?.some((r) => r.department === department));

    if (status && department) {
      filtered = filtered.filter((p) =>
        p.reviews?.some((r) => r.department === department && r.status === status)
      );
    } else if (status) {
      filtered = filtered.filter((p) => p.reviews?.some((r) => r.status === status));
    }

    if (sortBy) {
      filtered.sort((a: Project, b: Project) => {
        let va: any = (a as any)[sortBy];
        let vb: any = (b as any)[sortBy];
        if (va == null && vb == null) return 0;
        if (va == null) return sortDir === "asc" ? 1 : -1;
        if (vb == null) return sortDir === "asc" ? -1 : 1;
        if (typeof va === "number" && typeof vb === "number") {
          return sortDir === "asc" ? va - vb : vb - va;
        }
        va = String(va).toLowerCase();
        vb = String(vb).toLowerCase();
        if (va < vb) return sortDir === "asc" ? -1 : 1;
        if (va > vb) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    return { projects: filtered, total: filtered.length };
  }, [allProjectsData, search, region, projektleiter, pruefer, status, department, sortBy, sortDir]);

  const { applyEdit, applyReviewEdit } = useProjectEdits();

  const addProject = useCallback(
    (newProjectData: any) => {
      createProjectMutation.mutate(newProjectData);
    },
    [createProjectMutation]
  );

  return {
    data: result,
    isLoading: allProjectsLoading || isWriting || createProjectMutation.isPending,
    applyEdit,
    applyReviewEdit,
    addProject,
  };
}

export function useFilters() {
  const { data: allProjectsData, isLoading, isError } = useAllProjects();

  const data: Filters = useMemo(() => {
    const allProjects = allProjectsData?.projects || [];
    if (!allProjects || allProjects.length === 0) {
      return { regions: [], projektleiter: [], pruefer: [] };
    }

    const regions = new Set<string>();
    const projektleiter = new Set<string>();
    const pruefer = new Set<string>();

    allProjects.forEach((p) => {
      if (p.bahnhofsmanagement) regions.add(p.bahnhofsmanagement);
      if (p.projektleiter) projektleiter.add(p.projektleiter);
      p.reviews?.forEach((r) => {
        if (r.prueferName && r.prueferName !== "Zuordnung erforderlich") {
          pruefer.add(r.prueferName);
        }
      });
    });

    // Region order follows the canonical Bahnhofsmanagement list rather than
    // raw lexical order, so the dropdown is identical to the Projektanmeldung
    // form and to the station cascade. Anything outside the canonical list
    // cannot reach here (client.ts normalises on read), but is appended rather
    // than dropped so a future vocabulary change stays visible instead of
    // silently hiding projects.
    const canonical = BAHNHOFSMANAGEMENT.filter((bm) => regions.has(bm));
    const extra = Array.from(regions).filter(
      (r) => !(BAHNHOFSMANAGEMENT as readonly string[]).includes(r),
    );
    const collator = new Intl.Collator("de");

    return {
      regions: [...canonical, ...extra.sort(collator.compare)],
      projektleiter: Array.from(projektleiter).sort(collator.compare),
      pruefer: Array.from(pruefer).sort(collator.compare),
    };
  }, [allProjectsData]);

  return { data, isLoading, isError };
}


/**
 * The three queries the pages need, folded into one result.
 *
 * `isError` and `isEmpty` are separate on purpose. `data` is null in three very
 * different situations — still loading, loaded but empty, and failed — and
 * every page that consumed only `{ data, isLoading }` rendered the same
 * "Lade …" spinner for all three. Because the loader in _core/api/client.ts
 * catches its own failures and returns [], a total data-source failure landed
 * as `isLoading === false, data === null`: a spinner that spins forever over a
 * read that has already given up.
 */
export function useAllData() {
  const { data: projectsData, isLoading: pLoading, isError: pError } = useAllProjects();
  const { data: stats, isLoading: sLoading, isError: sError } = useDashboardStats();
  const { data: filters, isLoading: fLoading, isError: fError } = useFilters();

  const data = useMemo(() => {
    const projects = projectsData?.projects || [];
    if (!projects.length || !stats || !filters) return null;
    return { projects, stats, filters };
  }, [projectsData, stats, filters]);

  const isLoading = pLoading || sLoading || fLoading;
  const isError = pError || sError || fError;

  return {
    data,
    isLoading,
    isError,
    /** settled, no error, and still nothing to show */
    isEmpty: !isLoading && !isError && data === null,
  };
}

export type { ProjectUpdateInput, ReviewUpdateInput, ProjectCreateInput };
