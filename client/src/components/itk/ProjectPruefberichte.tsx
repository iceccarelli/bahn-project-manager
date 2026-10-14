import { Copy, ExternalLink, Link2Off, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkProjectDialog } from "@/components/itk/LinkProjectDialog";
import { useLinkAccess, useOpenReportsFor, useProjectPruefberichte, useSetLink } from "@/hooks/useProjectLinks";
import type { PruefberichtListRow } from "@shared/itk/pruefbericht-contract";
import { derivePdfCode } from "@shared/itk/pdf-code";
import { formatGerman } from "@shared/date";

/**
 * "ITK-Prüfberichte" section of the project detail: the reports linked to THIS project (canonical link, not a text search),
 * with their canonical PDF-Code, and — for those who may — attaching an unlinked report that carries the project's
 * Projektnummer, or detaching one. Rendered only where the server would answer: server mode, and a principal who may
 * see Prüfberichte (default-deny for workspace-limited principals).
 */
export function ProjectPruefberichte({ projectId, projektnummer, station, projektstand }: { projectId: number; projektnummer: string | null; station: string | null; projektstand?: string | null }) {
  const access = useLinkAccess();
  const reports = useProjectPruefberichte(access.view ? projectId : null);
  const open = useOpenReportsFor(projektnummer, access.link);
  const setLink = useSetLink();
  const [picking, setPicking] = useState<PruefberichtListRow | null>(null);
  if (!access.view) return null;

  const rows = reports.data ?? [];
  const offer = (open.data ?? []).filter((r) => r.projectId === null);

  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); toast.success("PDF-Code kopiert"); } catch { toast.error("Kopieren nicht möglich"); }
  };
  const detach = async (r: PruefberichtListRow) => {
    try { await setLink.mutateAsync({ id: r.id, expectedVersion: r.version, projectId: null }); toast.success("Zuordnung entfernt"); }
    catch { toast.error("Die Zuordnung konnte nicht entfernt werden."); }
  };

  return (
    <section aria-labelledby="pd-pruefberichte" data-testid="project-pruefberichte">
      <h3 id="pd-pruefberichte" className="mb-3 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
        ITK-Prüfberichte ({rows.length})
      </h3>
      {reports.isLoading ? (
        <output className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Prüfberichte werden geladen …</output>
      ) : reports.isError ? (
        <p className="text-xs text-destructive">Prüfberichte konnten nicht geladen werden.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="project-pruefberichte-empty">Diesem Projekt ist noch kein ITK-Prüfbericht zugeordnet.</p>
      ) : (
        <ul className="divide-y rounded-xl border border-border/60">
          {rows.map((r) => {
            const code = derivePdfCode(r);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs" data-testid="project-pruefbericht">
                <span className="font-mono font-semibold">{r.laufendeNummer}</span>
                <span className="text-muted-foreground">{r.year}</span>
                <span>{r.technikArt ?? "Technik ?"}</span>
                {r.abgeschlossen && <Badge variant="outline" className="text-2xs">{r.abgeschlossen}</Badge>}
                {r.datum && <span className="tabular-nums text-muted-foreground">{formatGerman(r.datum)}</span>}
                {code && (
                  <span className="flex items-center gap-1">
                    <code className="font-mono">{code}</code>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`PDF-Code ${code} kopieren`} onClick={() => void copy(code)}><Copy className="h-3 w-3" aria-hidden /></Button>
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <Link href={`/psv-itk?tab=projektuebersicht&q=${encodeURIComponent(r.laufendeNummer)}&year=${r.year}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                    In der Projektübersicht ITK <ExternalLink className="h-3 w-3" aria-hidden />
                  </Link>
                  {access.link && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Zuordnung von ${r.laufendeNummer} entfernen`} disabled={setLink.isPending} onClick={() => void detach(r)}>
                      <Link2Off className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {access.link && offer.length > 0 && (
        <div className="mt-3 rounded-lg border border-dashed p-3" data-testid="project-pruefberichte-offer">
          <p className="mb-2 text-xs text-muted-foreground">
            Nicht zugeordnete Prüfberichte mit Projektnummer {projektnummer} — Bahnhof {station ?? "?"} und Phase {projektstand ?? "?"} prüfen (AP, EP und VEP sind verschiedene Anmeldungen), bevor zugeordnet wird:
          </p>
          <ul className="space-y-1">
            {offer.slice(0, 8).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-semibold">{r.laufendeNummer}</span>
                <span className="text-muted-foreground">{r.year}</span>
                <span className="min-w-0 truncate">{r.bahnhofStrecke ?? "ohne Bahnhof"} · {r.taetigkeitsbereich ?? "Tätigkeit ?"}</span>
                <Button variant="outline" size="sm" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={() => setPicking(r)}>
                  <Plus className="h-3 w-3" aria-hidden /> Zuordnen …
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <LinkProjectDialog report={picking} open={picking !== null} defaultProjectId={projectId} onOpenChange={(o) => { if (!o) setPicking(null); }} />
    </section>
  );
}
