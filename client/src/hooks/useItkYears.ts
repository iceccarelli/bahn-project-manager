/**
 * Data plane of the PSV-ITK Jahresansicht. One shape — `ItkYearsView` — whichever build runs:
 *   server build: `dashboard.itkYears` (derived on the server over the caller's authorized rows, cached per scope)
 *   demo build:   the same pure derivation (shared/itk/jahresansicht.ts) over the browser-local rows
 * Same arrangement as usePortfolio; SERVER_MODE is a build-time constant, so exactly one branch exists in an artifact.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildItkYears, type ItkYearsView } from "@shared/itk/jahresansicht";
import { SERVER_MODE, serverApi } from "@/realtime/serverApi";
import { useAllProjects } from "@/hooks/useDataQuery";

interface Result { data: ItkYearsView | undefined; isLoading: boolean; isError: boolean }

function useServerItkYears(): Result {
  const q = useQuery({
    queryKey: ["server", "itk-years"],
    queryFn: () => serverApi.dashboard.itkYears.query() as Promise<ItkYearsView>,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { data: q.data, isLoading: q.isLoading, isError: q.isError };
}

function useLocalItkYears(): Result {
  const q = useAllProjects();
  const projects = q.data?.projects;
  const data = useMemo(() => (projects?.length ? buildItkYears(projects, Date.now()) : undefined), [projects]);
  return { data, isLoading: q.isLoading, isError: q.isError || (!q.isLoading && !data) };
}

export const useItkYears: () => Result = SERVER_MODE ? useServerItkYears : useLocalItkYears;
