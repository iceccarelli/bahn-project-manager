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

/**
 * Fetch all projects
 */
export function useAllProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list({ showAll: true }), // Always fetch all for global context
    queryFn: async () => {
      const projects = await apiClient.projects.list();
      return { projects }; // Ensure it always returns an object with a projects array
    },
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
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
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
    mutationFn: (input: ProjectUpdateInput) => apiClient.projects.update(input.id, input),
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
    onError: (err, input, context) => {
      if (context?.previousProjectsData?.projects) {
        queryClient.setQueryData(queryKeys.projects.list({ showAll: true }), context.previousProjectsData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
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
    mutationFn: (input: ReviewUpdateInput) => apiClient.reviews.update(input.id, input),
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
    onError: (err, input, context) => {
      if (context?.previousProjectsData?.projects) {
        queryClient.setQueryData(queryKeys.projects.list({ showAll: true }), context.previousProjectsData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
    },
  });
}

// ============================================================================
// COMPOSITE HOOKS (for backward compatibility with existing code)
// ============================================================================

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
  showAll?: boolean;
}) {
  const { data: allProjectsData, isLoading: allProjectsLoading } = useAllProjects();
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
    showAll = false,
  } = params;

  const result = useMemo(() => {
    const allProjects = allProjectsData?.projects || []; // Safely access projects array

    if (!allProjects) {
      return { projects: [], total: 0, page, pageSize, showAll };
    }

    let filtered = [...allProjects];

    // Enhanced Google-like search
    if (search) {
      const s = search.toLowerCase().trim();
      const searchTerms = s.split(/\s+/);
      
      filtered = filtered.filter((p) => {
        // Check if all search terms match at least one field
        return searchTerms.every(term => {
          return (
            p.station?.toLowerCase().includes(term) ||
            p.projektbeschreibung?.toLowerCase().includes(term) ||
            p.projektnummer?.toLowerCase().includes(term) ||
            p.projektleiter?.toLowerCase().includes(term) ||
            p.bahnhofsmanagement?.toLowerCase().includes(term) ||
            p.kommentar?.toLowerCase().includes(term) ||
            p.reviews?.some(r => 
              r.prueferName?.toLowerCase().includes(term) || 
              r.department?.toLowerCase().includes(term) ||
              r.status?.toLowerCase().includes(term)
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
    
    let projects;
    if (showAll) {
      projects = filtered;
    } else {
      const start = (page - 1) * pageSize;
      projects = filtered.slice(start, start + pageSize);
    }

    return { projects, total, page, pageSize, showAll };
  }, [allProjectsData, page, pageSize, search, region, projektleiter, pruefer, status, department, sortBy, sortDir, showAll]);

  const applyEdit = useCallback(
    (projectId: number, field: string, value: string) => {
      updateProjectMutation.mutate({ id: projectId, field: field as any, value });
    },
    [updateProjectMutation]
  );

  const applyReviewEdit = useCallback(
    (projectId: number, departmentName: string, field: string, value: string) => {
      updateReviewMutation.mutate({ projectId, department: departmentName, field: field as any, value });
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
    isLoading: allProjectsLoading || updateProjectMutation.isPending || updateReviewMutation.isPending || createProjectMutation.isPending,
    applyEdit,
    applyReviewEdit,
    addProject,
  };
}

export function useFilters() {
  const { data: allProjectsData, isLoading } = useAllProjects();

  const data: Filters | null = useMemo(() => {
    const allProjects = allProjectsData?.projects || []; // Safely access projects array
    if (!allProjects) return null;
    const regions = new Set<string>();
    const projektleiter = new Set<string>();
    const pruefer = new Set<string>();

    allProjects.forEach((p) => {
      if (p.bahnhofsmanagement) regions.add(p.bahnhofsmanagement);
      if (p.projektleiter) projektleiter.add(p.projektleiter);
      p.reviews?.forEach((r) => { if (r.prueferName) pruefer.add(r.prueferName); });
    });

    return {
      regions: Array.from(regions).sort(),
      projektleiter: Array.from(projektleiter).sort(),
      pruefer: Array.from(pruefer).sort(),
    };
  }, [allProjectsData]);

  return { data, isLoading };
}

export function useAllData() {
  const { data: projectsData, isLoading: pLoading } = useAllProjects();
  const { data: stats, isLoading: sLoading } = useDashboardStats();
  const { data: filters, isLoading: fLoading } = useFilters();

  const data = useMemo(() => {
    const projects = projectsData?.projects || []; // Safely access projects array
    if (!projects || !stats || !filters) return null;
    return { projects, stats, filters };
  }, [projectsData, stats, filters]);

  return { data, isLoading: pLoading || sLoading || fLoading };
}

export type { Project, Review, Stats, Filters, AuditLogEntry };
