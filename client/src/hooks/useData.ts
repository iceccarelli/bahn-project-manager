import { useState, useEffect, useMemo, useCallback } from "react";

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
  projektleiter: string | null;
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

interface AppData {
  projects: Project[];
  stats: Stats;
  filters: Filters;
}

// All departments used in the UI (must match Projects.tsx departmentButtons)
const ALL_DEPARTMENTS = [
  "EEA",
  "ITK",
  "GA",
  "Energie",
  "HFT",
  "HKLS",
  "TBQ",
  "BS",
  "UM",
  "BIM",
  "LST",
  "Vermessung",
  "Baubetriebstechnologie",
  "Baubetriebsplanung",
];

// Simple global cache
let cachedData: AppData | null = null;
let loadingPromise: Promise<AppData> | null = null;

async function loadData(): Promise<AppData> {
  if (cachedData) return cachedData;
  if (loadingPromise) return loadingPromise;

  loadingPromise = fetch("/data.json")
    .then((res) => res.json())
    .then((rawData: AppData) => {
      // === NORMALIZE DATA: Ensure every project has all departments (including BS) ===
      const normalizedProjects = rawData.projects.map((project) => {
        const existingReviews = project.reviews || [];
        const reviewMap = new Map(existingReviews.map(r => [r.department, r]));

        const completeReviews: Review[] = ALL_DEPARTMENTS.map((dept) => {
          if (reviewMap.has(dept)) {
            return reviewMap.get(dept)!;
          }
          // Create empty review entry for missing departments (especially BS)
          return {
            department: dept,
            status: null,
            prueferName: null,
            pruefDatum: null,
          };
        });

        return {
          ...project,
          reviews: completeReviews,
        };
      });

      const normalizedData: AppData = {
        ...rawData,
        projects: normalizedProjects,
      };

      cachedData = normalizedData;
      return normalizedData;
    });

  return loadingPromise;
}

export function useAllData() {
  const [data, setData] = useState<AppData | null>(cachedData);
  const [isLoading, setIsLoading] = useState(!cachedData);

  useEffect(() => {
    if (cachedData) {
      setData(cachedData);
      setIsLoading(false);
      return;
    }
    loadData().then((d) => {
      setData(d);
      setIsLoading(false);
    });
  }, []);

  return { data, isLoading };
}

export function useStats() {
  const { data, isLoading } = useAllData();
  return { data: data?.stats ?? null, isLoading };
}

export function useFilters() {
  const { data, isLoading } = useAllData();
  return { data: data?.filters ?? null, isLoading };
}

type EditableProjectField = keyof Omit<Project, "id" | "reviews">;
type EditableReviewField = keyof Review;

function updateProjectField(project: Project, field: EditableProjectField, value: string) {
  (project as unknown as Record<string, unknown>)[field] = value;
}

function updateReviewField(review: Review, field: EditableReviewField, value: string) {
  (review as unknown as Record<string, unknown>)[field] = value;
}

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
  const { data: allData, isLoading: dataLoading } = useAllData();
  const [version, setVersion] = useState(0);

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
    sortDir = "asc",
  } = params;

  const applyEdit = useCallback(
    (projectId: number, field: EditableProjectField, value: string) => {
      if (cachedData) {
        const project = cachedData.projects.find((p) => p.id === projectId);
        if (project) {
          updateProjectField(project, field, value);
        }
      }
      setVersion((v) => v + 1);
    },
    []
  );

  const applyReviewEdit = useCallback(
    (
      projectId: number,
      departmentName: string,
      field: EditableReviewField,
      value: string
    ) => {
      if (cachedData) {
        const project = cachedData.projects.find((p) => p.id === projectId);
        if (project) {
          let review = project.reviews.find((r) => r.department === departmentName);

          if (review) {
            updateReviewField(review, field, value);
          } else {
            const newReview: Review = {
              department: departmentName,
              status: field === "status" ? value : null,
              prueferName: field === "prueferName" ? value : null,
              pruefDatum: field === "pruefDatum" ? value : null,
            };
            project.reviews.push(newReview);
          }
        }
      }
      setVersion((v) => v + 1);
    },
    []
  );

  // NEW: Add a new project professionally
  const addProject = useCallback(
    (newProjectData: Omit<Project, "id" | "reviews"> & { reviews?: Review[] }) => {
      if (!cachedData) {
        console.error("No cached data available to add project");
        return null;
      }

      const maxId = cachedData.projects.length > 0 
        ? Math.max(...cachedData.projects.map((p) => p.id)) 
        : 0;

      const newProject: Project = {
        id: maxId + 1,
        projektnummer: newProjectData.projektnummer || null,
        bahnhofsmanagement: newProjectData.bahnhofsmanagement || null,
        station: newProjectData.station || null,
        bahnhofsnummer: newProjectData.bahnhofsnummer || null,
        streckennummer: newProjectData.streckennummer || null,
        projektbeschreibung: newProjectData.projektbeschreibung || null,
        projektleiter: newProjectData.projektleiter || null,
        kommentar: newProjectData.kommentar || null,
        projektLink: newProjectData.projektLink || null,
        reviews: newProjectData.reviews || ALL_DEPARTMENTS.map((dept) => ({
          department: dept,
          status: null,
          prueferName: null,
          pruefDatum: null,
        })),
      };

      cachedData.projects.push(newProject);
      setVersion((v) => v + 1);
      return newProject.id;
    },
    []
  );

  const result = useMemo(() => {
    if (!allData) {
      return { projects: [], total: 0, page, pageSize };
    }

    let filtered = [...allData.projects];

    // Search filter (enhanced to be more helpful)
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

    // === PROFESSIONAL SORTING SUPPORT ===
    if (sortBy) {
      filtered.sort((a: Project, b: Project) => {
        let va: any = (a as any)[sortBy];
        let vb: any = (b as any)[sortBy];

        // Handle null/undefined gracefully
        if (va == null && vb == null) return 0;
        if (va == null) return sortDir === "asc" ? 1 : -1;
        if (vb == null) return sortDir === "asc" ? -1 : 1;

        // String comparison (case-insensitive for text)
        if (typeof va === "string" || typeof vb === "string") {
          va = String(va).toLowerCase();
          vb = String(vb).toLowerCase();
        } else if (typeof va === "number" && typeof vb === "number") {
          // numeric compare for id etc
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
  }, [
    allData,
    version,
    page,
    pageSize,
    search,
    region,
    projektleiter,
    pruefer,
    status,
    department,
    sortBy,
    sortDir,
  ]);

  return {
    data: result,
    isLoading: dataLoading,
    refetch: () => setVersion((v) => v + 1),
    applyEdit,
    applyReviewEdit,
    addProject, // NEW professional feature
  };
}
