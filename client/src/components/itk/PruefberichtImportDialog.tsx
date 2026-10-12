import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PRUEFBERICHTE_KEY } from "@/hooks/usePruefberichte";
import { serverApi } from "@/realtime/serverApi";
import { IMPORT_BATCH_SIZE, type ImportBatchResult } from "@shared/itk/pruefbericht-contract";
import { importWorkbookSheets, type ImportResult } from "@shared/itk/pruefbericht-import";
import { sheetsFromWorkbook } from "@shared/itk/workbook";

const MAX_BYTES = 25 * 1024 * 1024;

type State =
  | { phase: "pick" }
  | { phase: "reading"; name: string }
  | { phase: "report"; name: string; result: ImportResult }
  | { phase: "uploading"; name: string; done: number; total: number }
  | { phase: "done"; name: string; totals: ImportBatchResult }
  | { phase: "error"; message: string; name?: string };

const countText = (m: Record<string, number>) =>
  Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ");

/**
 * Admin import of the Prüfstelle's workbook. The file is read in the browser (nothing is uploaded as a file); what the
 * importer understood is shown first — layout and header mapping per sheet, what was skipped and why, values outside
 * the vocabularies, and how the PDF-Code formula compares with the codes stored in the workbook — and only the
 * "Importieren" button sends rows, in batches the server applies idempotently (re-running changes nothing).
 */
export function PruefberichtImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, setState] = useState<State>({ phase: "pick" });
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const qc = useQueryClient();

  const close = (next: boolean) => {
    if (!next) {
      cancelled.current = true;
      setState({ phase: "pick" });
    }
    onOpenChange(next);
  };

  const read = async (file: File) => {
    if (file.size > MAX_BYTES) return setState({ phase: "error", message: `Die Datei ist größer als ${MAX_BYTES / 1024 / 1024} MB.`, name: file.name });
    setState({ phase: "reading", name: file.name });
    try {
      const [XLSX, buffer] = await Promise.all([import("xlsx"), file.arrayBuffer()]);
      const workbook = XLSX.read(buffer, { type: "array" });
      setState({ phase: "report", name: file.name, result: importWorkbookSheets(sheetsFromWorkbook(XLSX, workbook)) });
    } catch (e) {
      setState({ phase: "error", message: `Die Datei konnte nicht gelesen werden: ${e instanceof Error ? e.message : "unbekannter Fehler"}`, name: file.name });
    }
  };

  const upload = async (name: string, result: ImportResult) => {
    cancelled.current = false;
    const parts: (typeof result.records)[] = [];
    for (let i = 0; i < result.records.length; i += IMPORT_BATCH_SIZE) parts.push(result.records.slice(i, i + IMPORT_BATCH_SIZE));
    const totals: ImportBatchResult = { inserted: 0, updated: 0, unchanged: 0 };
    try {
      for (const [i, records] of parts.entries()) {
        if (cancelled.current) return;
        setState({ phase: "uploading", name, done: i, total: parts.length });
        const r = (await serverApi.pruefberichte.import.mutate({ source: name, part: { index: i + 1, total: parts.length }, records })) as ImportBatchResult;
        totals.inserted += r.inserted;
        totals.updated += r.updated;
        totals.unchanged += r.unchanged;
      }
      await qc.invalidateQueries({ queryKey: PRUEFBERICHTE_KEY });
      setState({ phase: "done", name, totals });
    } catch (e) {
      await qc.invalidateQueries({ queryKey: PRUEFBERICHTE_KEY });
      setState({
        phase: "error",
        name,
        message: `Import abgebrochen: ${e instanceof Error ? e.message : "unbekannter Fehler"}. Bereits übernommene Teile bleiben bestehen; ein erneuter Import derselben Datei ergänzt den Rest und ändert nichts doppelt.`,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-3xl">
        <DialogHeader className="space-y-1 border-b p-5 pr-12 text-left">
          <DialogTitle className="text-lg font-bold">Arbeitsmappe importieren</DialogTitle>
          <DialogDescription className="text-sm">Projektübersicht ITK (.xlsx): ein Blatt je Jahr. Die Datei wird im Browser gelesen und zuerst nur geprüft.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" data-testid="import-body">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            aria-label="Arbeitsmappe wählen"
            data-testid="import-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void read(f);
            }}
          />

          {(state.phase === "pick" || state.phase === "error") && (
            <div className="space-y-4">
              {state.phase === "error" && (
                <Alert variant="destructive" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>{state.name ? `${state.name}` : "Import"}</AlertTitle>
                  <AlertDescription>{state.message}</AlertDescription>
                </Alert>
              )}
              <Button className="h-10 gap-2" onClick={() => input.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Datei wählen
              </Button>
            </div>
          )}

          {state.phase === "reading" && (
            <output className="flex items-center gap-3 py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary-strong" aria-hidden="true" />
              <span className="font-medium">{state.name} wird gelesen …</span>
            </output>
          )}

          {state.phase === "report" && <Report name={state.name} result={state.result} onUpload={() => void upload(state.name, state.result)} onOther={() => input.current?.click()} />}

          {state.phase === "uploading" && (
            <div className="space-y-3 py-4" data-testid="import-progress">
              <output className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary-strong" aria-hidden="true" />
                <span className="font-medium">
                  Teil {Math.min(state.done + 1, state.total)} von {state.total} wird übernommen …
                </span>
              </output>
              <Progress value={Math.round((state.done / state.total) * 100)} aria-label="Importfortschritt" />
            </div>
          )}

          {state.phase === "done" && (
            <Alert role="status" data-testid="import-done">
              <CheckCircle2 aria-hidden="true" />
              <AlertTitle>{state.name} übernommen</AlertTitle>
              <AlertDescription>
                {state.totals.inserted.toLocaleString("de-DE")} neu, {state.totals.updated.toLocaleString("de-DE")} geändert, {state.totals.unchanged.toLocaleString("de-DE")} unverändert.
                Der Import steht in der Änderungshistorie.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Report({ name, result, onUpload, onOther }: { name: string; result: ImportResult; onUpload: () => void; onOther: () => void }) {
  const { report, records } = result;
  const t = report.totals;
  const v = report.vocabulary;
  const p = report.pdfCode;
  const share = p.checked ? Math.round((p.match / p.checked) * 100) : null;
  const unrecognised = report.sheets.filter((s) => s.layout === null);

  return (
    <div className="space-y-5" data-testid="import-report">
      <div className="flex items-start gap-3">
        <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">
            {t.imported.toLocaleString("de-DE")} Prüfberichte erkannt • {t.skipped.toLocaleString("de-DE")} Zeilen übersprungen ({t.duplicates} Duplikate) • {t.blank.toLocaleString("de-DE")} leere Zeilen
          </p>
        </div>
      </div>

      {unrecognised.length > 0 && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{unrecognised.length === 1 ? "Ein Jahresblatt" : `${unrecognised.length} Jahresblätter`} nicht erkannt</AlertTitle>
          <AlertDescription>{unrecognised.map((s) => s.sheet).join(", ")} — die Kopfzeile passt zu keinem bekannten Layout; diese Blätter werden nicht übernommen.</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Blatt</TableHead>
              <TableHead>Layout</TableHead>
              <TableHead className="text-right">Zeilen</TableHead>
              <TableHead className="text-right">importiert</TableHead>
              <TableHead className="text-right">übersprungen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.sheets.map((s) => (
              <TableRow key={s.sheet}>
                <TableCell className="font-medium">{s.sheet}</TableCell>
                <TableCell>{s.layout ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{s.rows}</TableCell>
                <TableCell className="text-right tabular-nums">{s.imported}</TableCell>
                <TableCell className="text-right tabular-nums">{s.skipped.length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {report.sheets.some((s) => s.warnings.length || s.unmappedHeaders.length || s.skipped.length) && (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Hinweise und übersprungene Zeilen</summary>
          <div className="mt-3 space-y-3">
            {report.sheets.map((s) =>
              s.warnings.length || s.unmappedHeaders.length || s.skipped.length ? (
                <div key={s.sheet}>
                  <p className="font-medium">{s.sheet}</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                    {s.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}
                    {s.unmappedHeaders.length > 0 && <li>Kopfzellen ohne Feld: {s.unmappedHeaders.map((h) => `„${h}“`).join(", ")}</li>}
                    {s.skipped.slice(0, 5).map((k) => <li key={`${k.row}-${k.reason}`}>Zeile {k.row}: {k.reason}{k.value ? ` (${k.value})` : ""}</li>)}
                    {s.skipped.length > 5 && <li>… und {s.skipped.length - 5} weitere übersprungene Zeilen</li>}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        </details>
      )}

      <div className="space-y-1 text-sm">
        <p><span className="font-medium">Technik außerhalb der Liste:</span> {Object.keys(v.technikUnknown).length ? countText(v.technikUnknown) : "keine"}{v.technikEmpty ? ` • ohne Technik: ${v.technikEmpty}` : ""}</p>
        <p><span className="font-medium">abgeschlossen außerhalb der Liste:</span> {Object.keys(v.abgeschlossenUnknown).length ? countText(v.abgeschlossenUnknown) : "keine"}{v.abgeschlossenEmpty ? ` • leer: ${v.abgeschlossenEmpty}` : ""}</p>
        <p className="text-muted-foreground">Diese Werte werden unverändert übernommen.</p>
      </div>

      {share !== null && (
        <Alert variant={share >= 95 ? "default" : "destructive"} role="status" data-testid="import-pdfcode">
          <AlertTitle>PDF-Code: {share} % stimmen mit der Formel überein</AlertTitle>
          <AlertDescription>
            {p.match.toLocaleString("de-DE")} von {p.checked.toLocaleString("de-DE")} gespeicherten Codes entsprechen G/S/A/P + laufende Nummer + „ - “ + Bahnhof.
            {share < 95 ? " Das Format vor dem Import klären." : ""}
            {p.samples.length > 0 && (
              <span className="mt-1 block text-xs">
                z. B. {p.samples[0]?.year} / {p.samples[0]?.laufendeNummer}: gespeichert „{p.samples[0]?.stored}“, berechnet „{p.samples[0]?.generated ?? "—"}“
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button className="h-10 gap-2 bg-primary text-white hover:bg-primary/90" disabled={records.length === 0} onClick={onUpload}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          {records.length.toLocaleString("de-DE")} Prüfberichte importieren
        </Button>
        <Button variant="outline" className="h-10" onClick={onOther}>
          Andere Datei
        </Button>
      </div>
    </div>
  );
}
