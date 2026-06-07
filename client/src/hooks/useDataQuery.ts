import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { apiClient } from "@/_core/api/client";
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
    onError: (_err, _input, context) => {
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
    onError: (_err, _input, context) => {
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
// COMPOSITE HOOKS
// ============================================================================

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

    if (search) {
      const s = search.toLowerCase().trim();
      const searchTerms = s.split(/\s+/);
      
      filtered = filtered.filter((p) => {
        return searchTerms.every((term) => {
          const lowerTerm = term.toLowerCase();
          return (
            (p.station?.toLowerCase() || "").includes(lowerTerm) ||
            (p.projektbeschreibung?.toLowerCase() || "").includes(lowerTerm) ||
            (p.projektnummer?.toLowerCase() || "").includes(lowerTerm) ||
            (p.projektleiter?.toLowerCase() || "").includes(lowerTerm) ||
            (p.bahnhofsmanagement?.toLowerCase() || "").includes(lowerTerm) ||
            (p.projektstand?.toLowerCase() || "").includes(lowerTerm) ||
            (String(p.bahnhofsnummer ?? "").toLowerCase()).includes(lowerTerm) ||
            (String(p.streckennummer ?? "").toLowerCase()).includes(lowerTerm) ||
            (p.kommentar?.toLowerCase() || "").includes(lowerTerm) ||
            p.reviews?.some((r) =>
              (r.prueferName?.toLowerCase() || "").includes(lowerTerm) ||
              (r.department?.toLowerCase() || "").includes(lowerTerm) ||
              (r.status?.toLowerCase() || "").includes(lowerTerm)
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

    return {
      regions: Array.from(regions).sort(),
      projektleiter: Array.from(projektleiter).sort(),
      pruefer: Array.from(pruefer).sort(),
    };
  }, [allProjectsData]);

  return { data, isLoading };
}

export function useSearchSuggestions(term: string) {
  return useQuery({
    queryKey: ["searchSuggestions", term],
    queryFn: () => apiClient.projects.searchSuggestions(term),
    enabled: !!term && term.length > 1,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAllData() {
  const { data: projectsData, isLoading: pLoading } = useAllProjects();
  const { data: stats, isLoading: sLoading } = useDashboardStats();
  const { data: filters, isLoading: fLoading } = useFilters();

  const data = useMemo(() => {
    const projects = projectsData?.projects || [];
    if (!projects.length || !stats || !filters) return null;
    return { projects, stats, filters };
  }, [projectsData, stats, filters]);

  return { data, isLoading: pLoading || sLoading || fLoading };
}

export type { ProjectUpdateInput, ReviewUpdateInput, ProjectCreateInput };
