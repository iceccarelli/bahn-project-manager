/**
 * Client side of the Prüfbericht ↔ project link (server mode only; docs/project-register-import.md). Reads are scoped by the
 * server (project visible AND reports viewable); the access flags only decide what is OFFERED. Writes carry the version the
 * user saw and a fresh idempotency key, so a double click or a retry cannot link twice, and a concurrent change is a
 * conflict the user is told about.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/_core/hooks/useAuth";
import { PRUEFBERICHTE_KEY, usePruefberichteAccess } from "@/hooks/usePruefberichte";
import { SERVER_MODE, serverApi } from "@/realtime/serverApi";
import { mayLinkPruefberichte, type Grant } from "@shared/itk/access";
import type { AutoLinkResult, LinkCandidates, LinkSummary, PruefberichtListRow, SetLinkResult } from "@shared/itk/pruefbericht-contract";

const newKey = () => `link-${crypto.randomUUID()}`;

export function useLinkAccess(): { view: boolean; link: boolean; bulk: boolean } {
  const access = usePruefberichteAccess();
  const { session } = useAuth() as ReturnType<typeof useAuth> & { session?: Grant | null };
  if (!SERVER_MODE || !session) return { view: false, link: false, bulk: false };
  return { view: access.view, link: mayLinkPruefberichte(session), bulk: access.import };
}

/** The reports linked to one project. Disabled (no request) without a project, outside server mode, or without the right to see reports. */
export function useProjectPruefberichte(projectId: number | null) {
  const access = usePruefberichteAccess();
  return useQuery({
    queryKey: [...PRUEFBERICHTE_KEY, "project", projectId],
    queryFn: async () => (await serverApi.pruefberichte.forProject.query({ projectId: projectId as number })).rows as PruefberichtListRow[],
    enabled: SERVER_MODE && access.view && projectId !== null,
    staleTime: 15_000,
  });
}

/** Unlinked reports that carry a Projektnummer (for "attach a report to this project"). */
export function useOpenReportsFor(projektnummer: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...PRUEFBERICHTE_KEY, "open", projektnummer],
    queryFn: async () => (await serverApi.pruefberichte.list.query({ limit: 200, verknuepfung: "offen", q: projektnummer as string })).rows as PruefberichtListRow[],
    enabled: SERVER_MODE && enabled && !!projektnummer,
    staleTime: 5_000,
  });
}

export function useLinkCandidates(id: number | null) {
  return useQuery({
    queryKey: [...PRUEFBERICHTE_KEY, "candidates", id],
    queryFn: () => serverApi.pruefberichte.linkCandidates.query({ id: id as number }) as Promise<LinkCandidates>,
    enabled: SERVER_MODE && id !== null,
    staleTime: 0,
  });
}

/** Free project search for the link dialog (the same scoped list the Projekte page uses). Disabled below two characters. */
export function useProjectSearch(term: string, enabled: boolean) {
  const q = term.trim();
  return useQuery({
    queryKey: [...PRUEFBERICHTE_KEY, "project-search", q],
    queryFn: async () => {
      const page = await serverApi.projects.list.query({ search: q, limit: 15, sort: "station", dir: "asc", expand: [] });
      return page.items.map((p) => ({ projectId: p.id, projektnummer: p.projektnummer, station: p.station, projektstand: p.projektstand, projektbeschreibung: p.projektbeschreibung?.slice(0, 300) ?? null }));
    },
    enabled: SERVER_MODE && enabled && q.length >= 2,
    staleTime: 10_000,
  });
}

export function useSetLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; expectedVersion: number; projectId: number | null }) =>
      serverApi.pruefberichte.setLink.mutate({ ...v, idempotencyKey: newKey() }) as Promise<SetLinkResult>,
    // success or conflict: either way the lists are out of date
    onSettled: () => qc.invalidateQueries({ queryKey: PRUEFBERICHTE_KEY }),
  });
}

export function useAutoLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { dryRun: boolean }) => serverApi.pruefberichte.autoLink.mutate({ ...v, idempotencyKey: newKey() }) as Promise<AutoLinkResult>,
    onSettled: (_d, _e, v) => (v.dryRun ? undefined : qc.invalidateQueries({ queryKey: PRUEFBERICHTE_KEY })),
  });
}

export function useLinkSummary() {
  const access = usePruefberichteAccess();
  return useQuery({
    queryKey: [...PRUEFBERICHTE_KEY, "link-summary"],
    queryFn: () => serverApi.pruefberichte.linkSummary.query() as Promise<LinkSummary>,
    enabled: SERVER_MODE && access.view,
    staleTime: 10_000,
  });
}
