import { AlertTriangle, Link2Off, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { useLinkCandidates, useProjectSearch, useSetLink } from "@/hooks/useProjectLinks";
import { PolicyHint } from "@/components/PolicyHint";
import { LINK_POLICY, reportPhase } from "@shared/itk/project-link";
import type { PruefberichtListRow } from "@shared/itk/pruefbericht-contract";

const errorText = (e: unknown) => {
  const code = (e as { data?: { code?: string } } | null)?.data?.code;
  return code === "CONFLICT" ? "Der Prüfbericht wurde inzwischen geändert. Die Liste wurde neu geladen — bitte erneut versuchen." : code === "FORBIDDEN" || code === "NOT_FOUND" ? "Dafür fehlt die Berechtigung." : "Die Zuordnung konnte nicht gespeichert werden.";
};

/**
 * Attach one Prüfbericht to a project — or detach it. The candidates are the projects with the report's Projektnummer; the
 * evidence rule's verdict is stated, never applied: this dialog is where a person decides what the rule would not.
 */
export function LinkProjectDialog({ report, open, onOpenChange, defaultProjectId }: { report: PruefberichtListRow | null; open: boolean; onOpenChange: (open: boolean) => void; defaultProjectId?: number }) {
  const cands = useLinkCandidates(open && report ? report.id : null);
  const setLink = useSetLink();
  const [choice, setChoice] = useState<string>("");
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(term), 300); return () => clearTimeout(t); }, [term]);
  const found = useProjectSearch(debounced, open);
  if (!report) return null;

  const save = async (projectId: number | null) => {
    try {
      await setLink.mutateAsync({ id: report.id, expectedVersion: report.version, projectId });
      toast.success(projectId === null ? "Zuordnung entfernt" : "Prüfbericht zugeordnet");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const data = cands.data;
  // opened from a project: that project is the proposed choice (if it is among the candidates) — still one explicit click to save
  const selected = choice || (defaultProjectId !== undefined && data?.candidates.some((c) => c.projectId === defaultProjectId) ? String(defaultProjectId) : "");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setChoice(""); setTerm(""); } onOpenChange(o); }}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" data-testid="link-dialog">
        <DialogHeader className="space-y-1 border-b p-5 pr-12 text-left">
          <DialogTitle className="text-lg font-bold">Prüfbericht {report.laufendeNummer} ({report.year}) zuordnen</DialogTitle>
          <DialogDescription>
            {report.bahnhofStrecke ?? "ohne Bahnhof"} · Projektnummer {report.projektnummer ?? "—"} · {report.taetigkeitsbereich ?? "Tätigkeit ?"}
            {reportPhase(report) ? ` → Phase ${reportPhase(report)}` : " (keine Phase genannt)"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {report.project && (
            <Alert>
              <AlertTitle>Derzeit zugeordnet</AlertTitle>
              <AlertDescription>
                {report.project.projektnummer ?? "—"} · {report.project.station ?? "—"} ({report.projectLinkSource === "auto" ? "automatisch" : "von Hand"})
              </AlertDescription>
            </Alert>
          )}
          {report.projectId === null && report.projectLinkSource === "detached" && (
            <Alert><AlertTitle>Bewusst nicht zugeordnet</AlertTitle><AlertDescription>Die Zuordnung wurde von Hand entfernt. Die automatische Zuordnung lässt diesen Prüfbericht in Ruhe; hier kann er wieder zugeordnet werden.</AlertDescription></Alert>
          )}
          {cands.isLoading && (
            <output className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Projekte werden gesucht …</output>
          )}
          {cands.isError && <Alert variant="destructive"><AlertTriangle aria-hidden /><AlertTitle>Projekte konnten nicht geladen werden</AlertTitle></Alert>}
          {data && data.verdict === "unique" && <p className="text-sm text-muted-foreground">Projektnummer und Bahnhof stimmen mit genau einem Projekt überein.</p>}
          {data && data.verdict === "ambiguous" && <p className="text-sm text-muted-foreground">Mehrere Projekte tragen Projektnummer und Bahnhof dieses Prüfberichts — bitte eines wählen. {LINK_POLICY.ambiguous} <PolicyHint label="Phase" text={LINK_POLICY.phase} /></p>}
          {data && data.verdict === "unmatched" && (
            <Alert>
              <AlertTriangle aria-hidden />
              <AlertTitle>Keine sichere Zuordnung</AlertTitle>
              <AlertDescription>{data.reason}.{data.candidates.length ? " Projekte mit gleicher Projektnummer sind unten nur Vorschläge." : ""}{!report.projektnummer ? ` ${LINK_POLICY.noProjektnummer}` : ""}</AlertDescription>
            </Alert>
          )}
          {data && data.candidates.length > 0 && (
            <RadioGroup value={selected} onValueChange={setChoice} className="gap-2" aria-label="Projekt wählen">
              {data.candidates.map((c) => (
                <Label key={c.projectId} htmlFor={`cand-${c.projectId}`} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <RadioGroupItem id={`cand-${c.projectId}`} value={String(c.projectId)} className="mt-1" />
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {c.station ?? "—"} <span className="text-muted-foreground">{c.projektnummer}</span>
                      <Badge variant="outline" className="text-2xs" title="Projektstand = Phase">Phase {c.projektstand ?? "—"}</Badge>
                      {c.evidence === "projektnummer+station" ? <Badge variant="secondary" className="text-2xs">Nummer + Bahnhof</Badge> : c.evidence === "projektnummer+station-andere-phase" ? <Badge variant="outline" className="text-2xs">andere Phase — kein Treffer</Badge> : <Badge variant="outline" className="text-2xs">nur Nummer</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{[c.projektstand, c.projektbeschreibung].filter(Boolean).join(" · ") || "ohne Beschreibung"}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          )}
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="link-search" className="text-sm font-medium">Anderes Projekt suchen</Label>
            <Input id="link-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Bahnhof, Projektnummer oder Beschreibung …" autoComplete="off" data-testid="link-search" />
            <p className="text-xs text-muted-foreground">
              {report.projektnummer ? "Für abweichende Nummern oder Bahnhöfe." : "Dieser Prüfbericht nennt keine Projektnummer — das Projekt wird hier von Hand gewählt."} Gespeichert wird als „von Hand“.
            </p>
            {found.isFetching && <output className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Suche …</output>}
            {found.isError && <p role="alert" className="text-xs text-destructive">Die Suche ist fehlgeschlagen.</p>}
            {found.data && found.data.length === 0 && !found.isFetching && <p className="text-xs text-muted-foreground">Kein Projekt gefunden.</p>}
            {found.data && found.data.length > 0 && (
              <RadioGroup value={selected} onValueChange={setChoice} className="gap-2" aria-label="Gefundenes Projekt wählen">
                {found.data.map((c) => (
                  <Label key={c.projectId} htmlFor={`found-${c.projectId}`} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <RadioGroupItem id={`found-${c.projectId}`} value={String(c.projectId)} className="mt-1" />
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {c.station ?? "—"} <span className="text-muted-foreground">{c.projektnummer ?? "ohne Nr."}</span>
                        <Badge variant="outline" className="text-2xs" title="Projektstand = Phase">Phase {c.projektstand ?? "—"}</Badge>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{c.projektbeschreibung ?? "ohne Beschreibung"}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 border-t p-4 sm:justify-between">
          {report.projectId !== null ? (
            <Button variant="outline" className="gap-2" disabled={setLink.isPending} onClick={() => void save(null)}>
              <Link2Off className="h-4 w-4" aria-hidden /> Zuordnung entfernen
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button disabled={!selected || setLink.isPending} onClick={() => void save(Number(selected))} data-testid="link-save">
              {setLink.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Zuordnen
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
