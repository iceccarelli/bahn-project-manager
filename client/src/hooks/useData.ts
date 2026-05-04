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

let cachedData: AppData | null = null;
let loadingPromise: Promise<AppData> | null = null;

async function loadData(): Promise<AppData> {
  if (cachedData) return cachedData;
  if (loadingPromise) return loadingPromise;

  loadingPromise = fetch("/data.json")
    .then((res) => res.json())
    .then((data: AppData) => {
      cachedData = data;
      return data;
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

export function useProjects(params: {
  page: number;
  pageSize: number;
  search?: string;
  region?: string;
  projektleiter?: string;
  pruefer?: string;
  status?: string;
  department?: string;
}) {
  const { data: allData, isLoading: dataLoading } = useAllData();
  const [version, setVersion] = useState(0);

  const applyEdit = useCallback((projectId: number, field: string, value: string) => {
    if (cachedData) {
      const project = cachedData.projects.find((p) => p.id === projectId);
      if (project) {
        (project as any)[field] = value;
      }
    }
    setVersion((v) => v + 1);
  }, []);

  const applyReviewEdit = useCallback(
    (projectId: number, department: string, field: string, value: string) => {
      if (cachedData) {
        const project = cachedData.projects.find((p) => p.id === projectId);
        if (project) {
          const review = project.reviews.find((r) => r.department === department);
          if (review) {
            (review as any)[field] = value;
          } else {
            project.reviews.push({
              department,
              status: field === "status" ? value : null,
              prueferName: field === "prueferName" ? value : null,
              pruefDatum: field === "pruefDatum" ? value : null,
            });
          }
        }
      }
      setVersion((v) => v + 1);
    },
    []
  );

  const result = useMemo(() => {
    if (!allData) return { projects: [], total: 0, page: params.page, pageSize: params.pageSize };

    let filtered = [...allData.projects];

    if (params.search) {
      const s = params.search.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.station?.toLowerCase().includes(s) ||
          p.projektbeschreibung?.toLowerCase().includes(s) ||
          p.projektnummer?.toLowerCase().includes(s) ||
          p.projektleiter?.toLowerCase().includes(s) ||
          p.bahnhofsmanagement?.toLowerCase().includes(s)
      );
    }

    if (params.region) {
      filtered = filtered.filter((p) => p.bahnhofsmanagement === params.region);
    }

    if (params.projektleiter) {
      filtered = filtered.filter((p) => p.projektleiter === params.projektleiter);
    }

    if (params.pruefer) {
      filtered = filtered.filter((p) =>
        p.reviews.some((r) => r.prueferName === params.pruefer)
      );
    }

    if (params.status && params.department) {
      filtered = filtered.filter((p) =>
        p.reviews.some(
          (r) => r.department === params.department && r.status === params.status
        )
      );
    } else if (params.status) {
      filtered = filtered.filter((p) =>
        p.reviews.some((r) => r.status === params.status)
      );
    }

    const total = filtered.length;
    const start = (params.page - 1) * params.pageSize;
    const projects = filtered.slice(start, start + params.pageSize);

    return { projects, total, page: params.page, pageSize: params.pageSize };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allData, version, params.page, params.pageSize, params.search, params.region, params.projektleiter, params.pruefer, params.status, params.department]);

  return {
    data: result,
    isLoading: dataLoading,
    refetch: () => setVersion((v) => v + 1),
    applyEdit,
    applyReviewEdit,
  };
}
