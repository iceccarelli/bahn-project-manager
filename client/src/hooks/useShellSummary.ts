/**
 * What the global chrome (sidebar, footer) needs: a count and whether the data
 * source is healthy. It must NOT pull the project collection.
 *
 *   server mode → a 2-field summary endpoint (5 s server cache, 60 s client poll)
 *   local mode  → the static deployment's in-browser dataset, which is already
 *                 the only data there is (no server exists to ask)
 *
 * SERVER_MODE is a build-time constant, so exactly one branch of hooks runs for
 * the lifetime of the app and the rules of hooks hold.
 */
import { SERVER_MODE } from "@/realtime/serverApi";
import { useShellSummary as useServerShellSummary } from "@/realtime/RealtimeProvider";
import { useAllProjects } from "@/hooks/useDataQuery";

export interface ShellSummary { projectCount: number | null; isError: boolean; isLoading: boolean }

function useLocalShellSummary(): ShellSummary {
  const { data, isError, isLoading } = useAllProjects();
  return { projectCount: data ? data.projects.length : null, isError, isLoading };
}

export const useShellSummary: () => ShellSummary = SERVER_MODE ? useServerShellSummary : useLocalShellSummary;
