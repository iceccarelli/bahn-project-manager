import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { apiClient } from "@/_core/api/client";
import type {
  ProjectUpdateInput,
  ReviewUpdateInput,
  ProjectCreateInput,
} from "@/_core/api/client";

// ============================================================================
// TYPE DEFINITIONS (single source of truth for the frontend)
// ============================================================================

/**
 * Review type for a single department on a project.
 * Each project has up to 14 department reviews.
 */
export interface Review {
  department: string;
  status: string | null;
  prueferName: string | null;
  pruefDatum: string | null;
}

/**
 * Primary Project type used across the application.
 * Matches the Excel Übersichtsliste column structure exactly:
 * Nr. (computed) | Projektnummer | Bahnhofsmanagement | Station | Bahnhofsnummer |
 * Streckennummer | Projektbeschreibung | Projektstand | Projektleiter |
 * Termin Projektvorstellung | [14 dept reviews] | Kommentar | Projektlink
 */
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

/**
 * Dashboard statistics type.
 */
export interface Stats {
  totalProjects: number;
  statusDistribution: Array<{ status: string; count: number }>;
  regionStats: Array<{ region: string; count: number }>;
  prueferWorkload: Array<{ name: string; count: number }>;
  departmentStats: Array<{ department: string; status: string; count: number }>;
}

/**
 * Filter options type.
 */
export interface Filters {
  regions: string[];
  projektleiter: string[];
  pruefer: string[];
}

/**
 * Audit log entry type.
 */
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  details: string;
}

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
 * Fetch all projects - no pagination, loads everything at once.
 */
export function useAllProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list({ showAll: true }),
    queryFn: async () => {
      const projects = await apiClient.projects.list();
      return { projects };
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
// COMPOSITE HOOKS (main data access layer for Projects page)
// ============================================================================

/**
 * useProjects - The primary hook for the Projects page.
 * Fetches ALL projects, applies client-side filtering, sorting, and returns results.
 * No pagination - all 1,298+ projects loaded at once.
 * 
 * Filters supported:
 * - search: Google-like multi-term search across all text fields
 * - region: Exact match on bahnhofsmanagement
 * - projektleiter: Exact match on projektleiter
 * - pruefer: Match on any review's prueferName
 * - status: Match on any review's status (or combined with department)
 * - department: Match on any review's department
 * - sortBy/sortDir: Column sorting (ascending/descending)
 */
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
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
}) {
  const { data: allProjectsData, isLoading: allProjectsLoading } = useAllProjects();
  const updateProjectMutation = useUpdateProject();
  const updateReviewMutation = useUpdateReview();
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

    // Enhanced Google-like search: all terms must match at least one field
    if (search) {
      const s = search.toLowerCase().trim();
      const searchTerms = s.split(/\s+/);
      
      filtered = filtered.filter((p) => {
        return searchTerms.every(term => {
          return (
            p.station?.toLowerCase().includes(term) ||
            p.projektbeschreibung?.toLowerCase().includes(term) ||
            p.projektnummer?.toLowerCase().includes(term) ||
            p.projektleiter?.toLowerCase().includes(term) ||
            p.bahnhofsmanagement?.toLowerCase().includes(term) ||
            p.projektstand?.toLowerCase().includes(term) ||
            p.bahnhofsnummer?.toLowerCase().includes(term) ||
            p.streckennummer?.toLowerCase().includes(term) ||
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

    // Region filter (exact match)
    if (region) filtered = filtered.filter((p) => p.bahnhofsmanagement === region);
    
    // Projektleiter filter (exact match)
    if (projektleiter) filtered = filtered.filter((p) => p.projektleiter === projektleiter);
    
    // Prüfer filter (any review matches)
    if (pruefer) filtered = filtered.filter((p) => p.reviews?.some((r) => r.prueferName === pruefer));
    
    // Department filter (any review matches the department)
    if (department) filtered = filtered.filter((p) => p.reviews?.some((r) => r.department === department));

    // Status filter (combined with department if both set, otherwise any review)
    if (status && department) {
      filtered = filtered.filter((p) =>
        p.reviews?.some((r) => r.department === department && r.status === status)
      );
    } else if (status) {
      filtered = filtered.filter((p) => p.reviews?.some((r) => r.status === status));
    }

    // Sorting
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
        // String comparison
        va = String(va).toLowerCase();
        vb = String(vb).toLowerCase();
        if (va < vb) return sortDir === "asc" ? -1 : 1;
        if (va > vb) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    return { projects: filtered, total: filtered.length };
  }, [allProjectsData, search, region, projektleiter, pruefer, status, department, sortBy, sortDir]);

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

/**
 * useFilters - Derives filter options from the loaded project data.
 * Returns unique regions, projektleiter, and pruefer values for dropdown menus.
 */
export function useFilters() {
  const { data: allProjectsData, isLoading } = useAllProjects();

  const data: Filters | null = useMemo(() => {
    const allProjects = allProjectsData?.projects || [];
    if (!allProjects || allProjects.length === 0) return null;
    const regions = new Set<string>();
    const projektleiter = new Set<string>();
    const pruefer = new Set<string>();

    allProjects.forEach((p) => {
      if (p.bahnhofsmanagement) regions.add(p.bahnhofsmanagement);
      if (p.projektleiter) projektleiter.add(p.projektleiter);
      p.reviews?.forEach((r) => { 
        if (r.prueferName && r.prueferName !== 'Zuordnung erforderlich') {
          pruefer.add(r.prueferName); 
        }
      });
    });

    return {
      regions: Array.from(regions).sort(),
      projektleiter: Array.from(projektleiter).sort(),
      pruefer: Array.from(pruefer).sort(),
    };
  }, [allProjectsData]);

  return { data, isLoading };
}

/**
 * useSearchSuggestions - Provides autocomplete suggestions as user types.
 * Searches across station, projektnummer, projektleiter, region, and pruefer fields.
 */
export function useSearchSuggestions(term: string) {
  return useQuery({
    queryKey: ["searchSuggestions", term],
    queryFn: () => apiClient.projects.searchSuggestions(term),
    enabled: !!term && term.length > 1,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * useAllData - Combined hook for Dashboard and other pages needing projects + stats + filters.
 */
export function useAllData() {
  const { data: projectsData, isLoading: pLoading } = useAllProjects();
  const { data: stats, isLoading: sLoading } = useDashboardStats();
  const { data: filters, isLoading: fLoading } = useFilters();

  const data = useMemo(() => {
    const projects = projectsData?.projects || [];
    if (!projects || projects.length === 0 || !stats || !filters) return null;
    return { projects, stats, filters };
  }, [projectsData, stats, filters]);

  return { data, isLoading: pLoading || sLoading || fLoading };
}

export type { ProjectUpdateInput, ReviewUpdateInput, ProjectCreateInput };
