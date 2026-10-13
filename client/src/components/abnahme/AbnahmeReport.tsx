import { AlertTriangle, FileCheck2, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatGerman } from "@shared/date";
import { referenceOf, type ReportSelection } from "@shared/abnahme/pruefbericht";
import type { PruefberichtListRow } from "@shared/itk/pruefbericht-contract";

export type ReportState =
  | { kind: "off" } // free Abnahme, no project, or a principal who may not see reports → nothing is shown or required
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; selection: ReportSelection<PruefberichtListRow>; linkedElsewhere: number };

const label = (r: PruefberichtListRow) => `${r.laufendeNummer} (${r.year}) · ${r.technikArt ?? "Technik unbekannt"}${r.datum ? ` · ${formatGerman(r.datum)}` : ""}`;

/**
 * The Prüfbericht an Abnahme refers to. One linked report of this Technik → used and shown; several → the user picks,
 * nothing preselected; none → an explicit empty state (the protocol is still possible, without a report reference).
 */
export function AbnahmeReport({ state, chosenId, onChoose, technik }: { state: ReportState; chosenId: number | null; onChoose: (id: number | null) => void; technik: string }) {
  if (state.kind === "off") return null;
  if (state.kind === "loading") {
    return <output className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Prüfberichte des Projekts werden geladen …</output>;
  }
  if (state.kind === "error") {
    return <Alert variant="destructive" role="alert"><AlertTriangle aria-hidden /><AlertTitle>Prüfberichte konnten nicht geladen werden</AlertTitle><AlertDescription>Das Protokoll kann erst nach erneutem Laden mit Prüfbericht-Nummer erzeugt werden.</AlertDescription></Alert>;
  }
  const { selection, linkedElsewhere } = state;
  if (selection.status === "none") {
    return (
      <Alert data-testid="abnahme-report-none">
        <FileCheck2 aria-hidden />
        <AlertTitle>Kein {technik}-Prüfbericht mit diesem Projekt verknüpft</AlertTitle>
        <AlertDescription>
          Das Protokoll enthält dann keine Prüfbericht-Nummer und keinen PDF-Code.
          {linkedElsewhere > 0 ? ` (${linkedElsewhere} Prüfbericht${linkedElsewhere === 1 ? "" : "e"} anderer Technik verknüpft.)` : ""}{" "}
          <Link href="/psv-itk?tab=projektuebersicht&verknuepfung=offen" className="font-medium text-primary hover:underline">Prüfberichte zuordnen</Link>
        </AlertDescription>
      </Alert>
    );
  }
  if (selection.status === "single" || selection.status === "chosen") {
    const ref = referenceOf(selection.report);
    return (
      <div className="min-w-0 space-y-1.5" data-testid="abnahme-report-ref">
        <p className="text-xs font-medium text-muted-foreground">Prüfbericht</p>
        <p className="text-sm font-medium">{selection.report.laufendeNummer} ({selection.report.year})</p>
        <p className="truncate text-xs text-muted-foreground">PDF-Code: <code className="font-mono">{ref.pdfCode ?? "—"}</code></p>
        {selection.status === "chosen" && (
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => onChoose(null)}>Anderen Prüfbericht wählen</button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1.5" data-testid="abnahme-report-choose">
      <Label htmlFor="abnahme-pruefbericht" className="text-xs font-medium text-muted-foreground">Prüfbericht wählen ({selection.options.length} verknüpft)</Label>
      <Select value={chosenId === null ? undefined : String(chosenId)} onValueChange={(v) => onChoose(Number(v))}>
        <SelectTrigger id="abnahme-pruefbericht" className="h-9 w-full sm:w-80"><SelectValue placeholder="Bitte einen Prüfbericht wählen" /></SelectTrigger>
        <SelectContent>
          {selection.options.map((r) => <SelectItem key={r.id} value={String(r.id)}>{label(r)}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-xs text-amber-700 dark:text-amber-400">Mehrere Prüfberichte passen — das Protokoll wird erst nach der Auswahl erzeugt.</p>
    </div>
  );
}
