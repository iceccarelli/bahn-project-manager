/**
 * useDataQuery.ts — Data Hooks with TanStack Query
 * 
 * Refactored from useData.ts to use useQuery/useMutation
 * Provides proper caching, invalidation, and optimistic updates
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { apiClient } from "@/_core/api/client";
import type {
  Project,
  Review,
  Stats,
  Filters,
  ProjectUpdateInput,
  ReviewUpdateInput,
  ProjectCreateInput,
  AuditLogEntry,
} from "@/_core/api/client";

// ============================================================================
// QUERY KEYS (for cache invalidation)
// ============================================================================

export const queryKeys = {
  projects: {
    all: ["projects"] as const,
    list: () => [...queryKeys.projects.all, "list"] as const,
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

/**
 * Fetch all projects
 */
export function useAllProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: () => apiClient.projects.list(),
  });
}

/**
 * Fetch single project by ID
 */
export function useProject(id: number) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => apiClient.projects.get(id),
  });
}

/**
 * Fetch dashboard stats
 */
export function useDashboardStats() {
  return useQuery({
    queryKey: queryKeys.stats.dashboard(),
    queryFn: () => apiClient.dashboard.getStats(),
  });
}

/**
 * Fetch audit log
 */
export function useAuditLog() {
  return useQuery({
    queryKey: queryKeys.audit.list(),
    queryFn: () => apiClient.audit.list(),
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Create new project
 */
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProjectCreateInput) => apiClient.projects.create(input),
    onSuccess: (newProject) => {
      // Invalidate projects list
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
      // Invalidate stats
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
      // Add to cache
      queryClient.setQueryData(queryKeys.projects.detail(newProject.id), newProject);
    },
  });
}

/**
 * Update project field
 */
export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProjectUpdateInput) => apiClient.projects.update(input),
    onMutate: async (input) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.list() });

      // Snapshot previous data
      const previousProjects = queryClient.getQueryData<Project[]>(queryKeys.projects.list());

      // Optimistic update
      if (previousProjects) {
        const updated = previousProjects.map((p) =>
          p.id === input.id ? { ...p, [input.field]: input.value } : p
        );
        queryClient.setQueryData(queryKeys.projects.list(), updated);
      }

      return { previousProjects };
    },
    onError: (err, input, context) => {
      // Rollback on error
      if (context?.previousProjects) {
        queryClient.setQueryData(queryKeys.projects.list(), context.previousProjects);
      }
    },
    onSuccess: () => {
      // Invalidate stats on success
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
    },
  });
}

/**
 * Update review
 */
export function useUpdateReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ReviewUpdateInput) => apiClient.reviews.update(input),
    onMutate: async (input) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.list() });

      // Snapshot previous data
      const previousProjects = queryClient.getQueryData<Project[]>(queryKeys.projects.list());

      // Optimistic update
      if (previousProjects) {
        const updated = previousProjects.map((p) => {
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
        queryClient.setQueryData(queryKeys.projects.list(), updated);
      }

      return { previousProjects };
    },
    onError: (err, input, context) => {
      // Rollback on error
      if (context?.previousProjects) {
        queryClient.setQueryData(queryKeys.projects.list(), context.previousProjects);
      }
    },
    onSuccess: () => {
      // Invalidate stats on success
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
    },
  });
}

/**
 * Delete project
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiClient.projects.delete(id),
    onSuccess: () => {
      // Invalidate projects list
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
      // Invalidate stats
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
    },
  });
}

// ============================================================================
// COMPOSITE HOOKS (for backward compatibility with existing code)
// ============================================================================

/**
 * Get filtered and paginated projects
 * Maintains backward compatibility with useProjects() from useData.ts
 */
export function useProjects(params: {
  page: number;
  pageSize: number;
  search?: string;
  region?: string;
  projektleiter?: string;
  pruefer?: string;
  status?: string;
  department?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}) {
  const { data: allProjects, isLoading } = useAllProjects();
  const updateProjectMutation = useUpdateProject();
  const updateReviewMutation = useUpdateReview();
  const createProjectMutation = useCreateProject();

  const {
    page,
    pageSize,
    search,
    region,
    projektleiter,
    pruefer,
    status,
    department,
    sortBy = "id",
    sortDir = "desc",
  } = params;

  // Filter and sort logic (same as original useData.ts)
  const result = useMemo(() => {
    if (!allProjects) {
      return { projects: [], total: 0, page, pageSize };
    }

    let filtered = [...allProjects];

    // Search filter
    if (search) {
      const s = search.toLowerCase().trim();
      filtered = filtered.filter(
        (p) =>
          p.station?.toLowerCase().includes(s) ||
          p.projektbeschreibung?.toLowerCase().includes(s) ||
          p.projektnummer?.toLowerCase().includes(s) ||
          p.projektleiter?.toLowerCase().includes(s) ||
          p.bahnhofsmanagement?.toLowerCase().includes(s) ||
          p.kommentar?.toLowerCase().includes(s) ||
          p.projektLink?.toLowerCase().includes(s)
      );
    }

    if (region) {
      filtered = filtered.filter((p) => p.bahnhofsmanagement === region);
    }

    if (projektleiter) {
      filtered = filtered.filter((p) => p.projektleiter === projektleiter);
    }

    if (pruefer) {
      filtered = filtered.filter((p) =>
        p.reviews.some((r) => r.prueferName === pruefer)
      );
    }

    if (department) {
      filtered = filtered.filter((p) =>
        p.reviews.some((r) => r.department === department)
      );
    }

    if (status && department) {
      filtered = filtered.filter((p) =>
        p.reviews.some(
          (r) => r.department === department && r.status === status
        )
      );
    } else if (status) {
      filtered = filtered.filter((p) =>
        p.reviews.some((r) => r.status === status)
      );
    }

    // Sorting
    if (sortBy) {
      filtered.sort((a: Project, b: Project) => {
        let va: any = (a as any)[sortBy];
        let vb: any = (b as any)[sortBy];

        if (va == null && vb == null) return 0;
        if (va == null) return sortDir === "asc" ? 1 : -1;
        if (vb == null) return sortDir === "asc" ? -1 : 1;

        if (typeof va === "string" || typeof vb === "string") {
          va = String(va).toLowerCase();
          vb = String(vb).toLowerCase();
        } else if (typeof va === "number" && typeof vb === "number") {
          return sortDir === "asc" ? va - vb : vb - va;
        }

        if (va < vb) return sortDir === "asc" ? -1 : 1;
        if (va > vb) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const projects = filtered.slice(start, start + pageSize);

    return { projects, total, page, pageSize };
  }, [allProjects, page, pageSize, search, region, projektleiter, pruefer, status, department, sortBy, sortDir]);

  // Wrapper functions for mutations
  const applyEdit = useCallback(
    (projectId: number, field: string, value: string) => {
      updateProjectMutation.mutate({
        id: projectId,
        field: field as any,
        value,
      });
    },
    [updateProjectMutation]
  );

  const applyReviewEdit = useCallback(
    (projectId: number, departmentName: string, field: string, value: string) => {
      updateReviewMutation.mutate({
        projectId,
        department: departmentName,
        field: field as any,
        value,
      });
    },
    [updateReviewMutation]
  );

  const addProject = useCallback(
    (newProjectData: any) => {
      createProjectMutation.mutate(newProjectData);
    },
    [createProjectMutation]
  );

  return {
    data: result,
    isLoading: isLoading || updateProjectMutation.isPending || updateReviewMutation.isPending,
    refetch: () => {}, // TanStack Query handles this automatically
    applyEdit,
    applyReviewEdit,
    addProject,
  };
}

/**
 * Get stats (backward compatible)
 */
export function useStats() {
  const { data, isLoading } = useDashboardStats();
  return { data: data ?? null, isLoading };
}

/**
 * Get recent arrivals
 */
export function useRecentArrivals(limit: number = 5) {
  const { data: allProjects, isLoading } = useAllProjects();

  const data = useMemo(() => {
    if (!allProjects) return [];

    const sorted = [...allProjects]
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);

    return sorted.map((project) => {
      const activeReviews = project.reviews.filter((r) => r.status != null);
      const gewerke =
        activeReviews.length > 0
          ? activeReviews.map((r) => r.department).join(", ")
          : "Keine Gewerke";
      return {
        projektleiter: project.projektleiter || "-",
        projekt:
          project.station ||
          project.projektnummer ||
          (project.projektbeschreibung
            ? project.projektbeschreibung.substring(0, 35) + "..."
            : "-"),
        gewerke,
      };
    });
  }, [allProjects, limit]);

  return { data, isLoading };
}

/**
 * Get recent in-progress projects
 */
export function useRecentInBearbeitung(limit: number = 5) {
  const { data: allProjects, isLoading } = useAllProjects();

  const data = useMemo(() => {
    if (!allProjects) return [];

    const filtered = allProjects.filter((p) =>
      p.reviews.some((r) => r.status === "in Bearbeitung")
    );
    const sorted = filtered.sort((a, b) => b.id - a.id).slice(0, limit);

    return sorted.map((project) => {
      const review =
        project.reviews.find((r) => r.status === "in Bearbeitung") ||
        project.reviews[0];
      return {
        fachspezialist: review?.prueferName || "-",
        projekt:
          project.station ||
          project.projektnummer ||
          (project.projektbeschreibung
            ? project.projektbeschreibung.substring(0, 35) + "..."
            : "-"),
        seitWann: review?.pruefDatum || "-",
        abgabeWann: "-",
      };
    });
  }, [allProjects, limit]);

  return { data, isLoading };
}

/**
 * Get filters
 */
export function useFilters() {
  const { data: allProjects, isLoading } = useAllProjects();

  const data: Filters | null = useMemo(() => {
    if (!allProjects) return null;

    const regions = new Set<string>();
    const projektleiter = new Set<string>();
    const pruefer = new Set<string>();

    allProjects.forEach((p) => {
      if (p.bahnhofsmanagement) regions.add(p.bahnhofsmanagement);
      if (p.projektleiter) projektleiter.add(p.projektleiter);
      p.reviews.forEach((r) => {
        if (r.prueferName) pruefer.add(r.prueferName);
      });
    });

    return {
      regions: Array.from(regions),
      projektleiter: Array.from(projektleiter),
      pruefer: Array.from(pruefer),
    };
  }, [allProjects]);

  return { data, isLoading };
}

/**
 * Backward compatibility re-export for useAllData
 */
export function useAllData() {
  const { data: projects, isLoading: projectsLoading } = useAllProjects();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: filters, isLoading: filtersLoading } = useFilters();

  const data = useMemo(() => {
    if (!projects || !stats || !filters) return null;
    return { projects, stats, filters };
  }, [projects, stats, filters]);

  return { data, isLoading: projectsLoading || statsLoading || filtersLoading };
}

export type { Project, Review, Stats, Filters };
