import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { serverApi } from "@/realtime/serverApi";
import { sheetsFromWorkbook } from "@shared/itk/workbook";
import { analyzeSource, parseRegisterWorkbook, type RegisterParse, type RegisterRecord, type SourceAnalysis } from "@shared/register/register-import";
import { chunkRecords, summarizePlan, type PlanRow } from "@shared/register/register-plan";
import { emptyCounts, type RegisterApplyResult, type RegisterApplyRow } from "@shared/register/register-contract";

const MAX_BYTES = 25 * 1024 * 1024;
const PAGE = 40;
const n = (x: number) => x.toLocaleString("de-DE");

/** What the administrator decided for a row that needs a decision. */
type Decision = { overwrite?: boolean; choice?: "skip" | "new" | number };
interface ReviewRow { plan: PlanRow; record: RegisterRecord; chunk: number }

type State =
  | { phase: "pick" }
  | { phase: "reading"; name: string }
  | { phase: "previewing"; name: string; done: number; total: number }
  | { phase: "review"; name: string; parsed: RegisterParse; source: SourceAnalysis; rows: ReviewRow[]; chunks: number }
  | { phase: "applying"; name: string; done: number; total: number }
  | { phase: "done"; name: string; totals: ReturnType<typeof emptyCounts>; notSent: number }
  | { phase: "error"; message: string; name?: string };

const FIELD_LABEL: Record<string, string> = {
  projektnummer: "Projektnummer", bahnhofsmanagement: "Bahnhofsmanagement", station: "Station", bahnhofsnummer: "Bahnhofsnummer", streckennummer: "Streckennummer",
  projektbeschreibung: "Beschreibung", projektstand: "Projektstand", projektleiter: "Projektleiter", terminProjektvorstellung: "Termin Projektvorstellung", kommentar: "Kommentar", projektLink: "Link",
};
const changeLabel = (key: string) => {
  const m = /^review\.([^.]+)\.(status|prueferName|datum)$/.exec(key);
  return m ? `${m[1]} · ${m[2] === "status" ? "Status" : m[2] === "prueferName" ? "Prüfer" : "Datum"}` : (FIELD_LABEL[key] ?? key);
};
const short = (v: string | null) => (v === null ? "—" : v.length > 60 ? `${v.slice(0, 60)}…` : v);

/** Request body for one apply chunk, from the plan and the decisions. Rows that need a decision and got none are NOT sent. */
function applyRows(rows: readonly ReviewRow[], decisions: Readonly<Record<number, Decision>>): RegisterApplyRow[] {
  const out: RegisterApplyRow[] = [];
  for (const { plan, record } of rows) {
    const d = decisions[plan.ref] ?? {};
    if (plan.status === "add") out.push({ record, action: "create", overwrite: false, confirmed: false });
    else if (plan.status === "unchanged" || plan.status === "update") {
      if (plan.match) out.push({ record, action: "update", target: { projectId: plan.match.projectId, expectedVersion: plan.match.version }, overwrite: false, confirmed: false });
    } else if (plan.status === "conflict") {
      if (d.overwrite && plan.match) out.push({ record, action: "update", target: { projectId: plan.match.projectId, expectedVersion: plan.match.version }, overwrite: true, confirmed: false });
    } else if (plan.status === "ambiguous") {
      if (d.choice === "new") out.push({ record, action: "create", overwrite: false, confirmed: true });
      else if (typeof d.choice === "number") {
        const c = plan.candidates.find((x) => x.projectId === d.choice);
        if (c) out.push({ record, action: "update", target: { projectId: c.projectId, expectedVersion: c.version }, overwrite: true, confirmed: true });
      }
    }
  }
  return out;
}

/**
 * Administrator import of the Übersichtsliste (the project register) into the Projekte. The file is read in the browser —
 * cell values only, macros are never run — and nothing is written until the preview has been seen: what is new, what only
 * fills empty fields, what would REPLACE a stored value (held until ticked), what several projects could be (held until a
 * project is chosen), and which source rows the file itself cannot decide. Each chunk is applied in one server transaction
 * through the same write path as an edit (version, audit, history, realtime); running the same file again changes nothing.
 */
export function RegisterImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, setState] = useState<State>({ phase: "pick" });
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState<"attention" | "conflict" | "ambiguous">("attention");
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const qc = useQueryClient();

  const close = (next: boolean) => {
    if (!next) {
      cancelled.current = true;
      setState({ phase: "pick" });
      setDecisions({});
      setShown(PAGE);
    }
    onOpenChange(next);
  };
  const decide = (ref: number, d: Decision) => setDecisions((prev) => ({ ...prev, [ref]: { ...prev[ref], ...d } }));

  const read = async (file: File) => {
    cancelled.current = false;
    if (file.size > MAX_BYTES) return setState({ phase: "error", message: `Die Datei ist größer als ${MAX_BYTES / 1024 / 1024} MB.`, name: file.name });
    setState({ phase: "reading", name: file.name });
    try {
      const [XLSX, buffer] = await Promise.all([import("xlsx"), file.arrayBuffer()]);
      const workbook = XLSX.read(buffer, { type: "array", bookVBA: false });
      const parsed = parseRegisterWorkbook(sheetsFromWorkbook(XLSX, workbook));
      if (parsed.report.issues.some((i) => i.severity === "error") || parsed.records.length === 0) {
        return setState({ phase: "error", name: file.name, message: parsed.report.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ") || "Keine Projekte gefunden." });
      }
      const source = analyzeSource(parsed.records);
      const chunks = chunkRecords(source.accepted);
      const rows: ReviewRow[] = [];
      for (const [i, chunk] of chunks.entries()) {
        if (cancelled.current) return;
        setState({ phase: "previewing", name: file.name, done: i, total: chunks.length });
        const preview = await serverApi.projects.registerPreview.mutate({ records: chunk });
        for (const plan of preview.rows) rows.push({ plan, record: chunk.find((r) => r.ref === plan.ref) as RegisterRecord, chunk: i });
      }
      setState({ phase: "review", name: file.name, parsed, source, rows, chunks: chunks.length });
    } catch (e) {
      setState({ phase: "error", name: file.name, message: `Die Datei konnte nicht geprüft werden: ${e instanceof Error ? e.message : "unbekannter Fehler"}` });
    }
  };

  const apply = async (s: Extract<State, { phase: "review" }>) => {
    cancelled.current = false;
    const totals = emptyCounts();
    let notSent = 0;
    const runId = crypto.randomUUID();
    try {
      for (let i = 0; i < s.chunks; i++) {
        if (cancelled.current) return;
        setState({ phase: "applying", name: s.name, done: i, total: s.chunks });
        const chunkRows = s.rows.filter((r) => r.chunk === i);
        const rows = applyRows(chunkRows, decisions);
        notSent += chunkRows.length - rows.length;
        if (!rows.length) continue;
        const res = (await serverApi.projects.registerApply.mutate({ source: s.name, part: { index: i + 1, total: s.chunks }, rows, idempotencyKey: `register-${runId}-${i}` })) as RegisterApplyResult;
        for (const [k, c] of Object.entries(res.counts)) totals[k as keyof typeof totals] += c;
      }
      await qc.invalidateQueries({ queryKey: ["server"] });
      setState({ phase: "done", name: s.name, totals, notSent });
    } catch (e) {
      await qc.invalidateQueries({ queryKey: ["server"] });
      setState({ phase: "error", name: s.name, message: `Import abgebrochen: ${e instanceof Error ? e.message : "unbekannter Fehler"}. Bereits übernommene Teile bleiben bestehen; ein erneuter Import derselben Datei ergänzt den Rest und ändert nichts doppelt.` });
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-4xl" data-testid="register-import">
        <DialogHeader className="space-y-1 border-b p-5 pr-12 text-left">
          <DialogTitle className="text-lg font-bold">Übersichtsliste importieren</DialogTitle>
          <DialogDescription className="text-sm">Projekte und Gewerke-Prüfungen aus der Übersichtsliste (.xlsm/.xlsx, Blatt „Übersicht“). Zuerst nur eine Vorschau — geschrieben wird erst nach „Übernehmen“.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" data-testid="register-import-body">
          <input
            ref={input} type="file" accept=".xlsm,.xlsx,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only" aria-label="Übersichtsliste wählen" data-testid="register-file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }}
          />

          {(state.phase === "pick" || state.phase === "error") && (
            <div className="space-y-4">
              {state.phase === "error" && (
                <Alert variant="destructive" role="alert"><AlertTriangle aria-hidden /><AlertTitle>{state.name ?? "Import"}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>
              )}
              <Button className="h-10 gap-2" onClick={() => input.current?.click()}><Upload className="h-4 w-4" aria-hidden /> Datei wählen</Button>
            </div>
          )}

          {(state.phase === "reading" || state.phase === "previewing" || state.phase === "applying") && (
            <div className="space-y-3 py-4" data-testid="register-progress">
              <output className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary-strong" aria-hidden />
                <span className="font-medium">
                  {state.phase === "reading" ? `${state.name} wird gelesen …` : state.phase === "previewing" ? `Vorschau: Teil ${Math.min(state.done + 1, state.total)} von ${state.total} …` : `Teil ${Math.min(state.done + 1, state.total)} von ${state.total} wird übernommen …`}
                </span>
              </output>
              {state.phase !== "reading" && <Progress value={Math.round((state.done / state.total) * 100)} aria-label="Fortschritt" />}
            </div>
          )}

          {state.phase === "review" && (
            <Review s={state} decisions={decisions} decide={decide} shown={shown} more={() => setShown((x) => x + PAGE)} filter={filter} setFilter={(f) => { setFilter(f); setShown(PAGE); }}
              onApply={() => void apply(state)} onOther={() => input.current?.click()} />
          )}

          {state.phase === "done" && (
            <Alert role="status" data-testid="register-done">
              <CheckCircle2 aria-hidden />
              <AlertTitle>{state.name} übernommen</AlertTitle>
              <AlertDescription className="space-y-1">
                <span className="block">{n(state.totals.created)} Projekte neu, {n(state.totals.updated)} geändert, {n(state.totals.unchanged)} unverändert.</span>
                {(state.totals.held + state.totals.stale + state.totals.exists + state.totals.refused + state.notSent) > 0 && (
                  <span className="block">
                    Nicht übernommen: {n(state.notSent)} ohne Entscheidung, {n(state.totals.held)} Konflikte nicht bestätigt, {n(state.totals.stale)} zwischenzeitlich geändert, {n(state.totals.exists)} bereits vorhanden, {n(state.totals.refused)} abgelehnt.
                    Ein erneuter Import zeigt sie wieder an.
                  </span>
                )}
                <span className="block">Der Import steht in der Änderungshistorie.</span>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Review({ s, decisions, decide, shown, more, filter, setFilter, onApply, onOther }: {
  s: Extract<State, { phase: "review" }>; decisions: Record<number, Decision>; decide: (ref: number, d: Decision) => void;
  shown: number; more: () => void; filter: "attention" | "conflict" | "ambiguous"; setFilter: (f: "attention" | "conflict" | "ambiguous") => void; onApply: () => void; onOther: () => void;
}) {
  const plans = useMemo(() => s.rows.map((r) => r.plan), [s.rows]);
  const sum = useMemo(() => summarizePlan(plans), [plans]);
  const rep = s.parsed.report;
  const attention = useMemo(() => s.rows.filter((r) => (filter === "attention" ? r.plan.status === "conflict" || r.plan.status === "ambiguous" : r.plan.status === filter)), [s.rows, filter]);
  const sending = useMemo(() => s.rows.reduce((c, r) => c + (applyRows([r], decisions).length), 0), [s.rows, decisions]);
  const warnings = [...rep.issues, ...s.source.issues].filter((i) => i.severity === "warn");
  const kinds = new Map<string, number>();
  for (const w of warnings) kinds.set(w.kind, (kinds.get(w.kind) ?? 0) + 1);

  return (
    <div className="space-y-5" data-testid="register-review">
      <div className="flex items-start gap-3">
        <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="truncate font-medium">{s.name}</p>
          <p className="text-sm text-muted-foreground">
            Blatt „{rep.sheet}“, Kopfzeile {rep.headerRow} • {n(rep.rows)} Zeilen • {n(rep.records)} Projekte erkannt • {rep.departments.length} von 14 Gewerken • {n(rep.withoutProjektnummer)} ohne Projektnummer • {n(rep.repeatedProjektnummern)} Projektnummern kommen mehrfach vor (verschiedene Projekte)
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="register-summary">
        {([
          ["Neu", sum.add, "wird angelegt"], ["Ergänzt", sum.update, "nur leere Felder"], ["Unverändert", sum.unchanged, "nichts zu tun"],
          ["Konflikte", sum.conflict, "ersetzt Werte — gehalten"], ["Mehrdeutig", sum.ambiguous, "Projekt wählen — gehalten"],
        ] as const).map(([k, v, hint]) => (
          <div key={k} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-xl font-semibold tabular-nums">{n(v)}</dd>
            <dd className="text-2xs text-muted-foreground">{hint}</dd>
          </div>
        ))}
      </dl>

      {rep.missingDepartments.length > 0 && (
        <Alert variant="destructive" role="alert"><AlertTriangle aria-hidden /><AlertTitle>Gewerke nicht erkannt</AlertTitle><AlertDescription>{rep.missingDepartments.join(", ")} — ihre Spalten passen nicht zum erwarteten Aufbau; diese Gewerke werden nicht übernommen.</AlertDescription></Alert>
      )}
      {s.source.heldDuplicates.length > 0 && (
        <Alert role="alert" data-testid="register-source-duplicates">
          <AlertTriangle aria-hidden />
          <AlertTitle>{n(s.source.heldDuplicates.reduce((c, g) => c + g.rows.length, 0))} Zeilen der Datei sind nicht eindeutig</AlertTitle>
          <AlertDescription>
            {n(s.source.heldDuplicates.length)} Gruppen teilen Projektnummer, Station, Beschreibung, Projektstand und Termin, unterscheiden sich aber im Inhalt. Welche Zeile gilt, lässt sich der Datei nicht entnehmen — sie werden nicht importiert.
            Zeilen: {s.source.heldDuplicates.slice(0, 6).map((g) => g.rows.join("/")).join("; ")}{s.source.heldDuplicates.length > 6 ? " …" : ""}
          </AlertDescription>
        </Alert>
      )}
      {kinds.size > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="register-warnings">
          Hinweise: {[...kinds].map(([k, c]) => `${n(c)} × ${({ "date-unparseable": "Datum nicht lesbar (Feld bleibt leer)", "status-unknown": "Status außerhalb des Vokabulars (Status bleibt leer)", "bahnhofsmanagement-unknown": "Bahnhofsmanagement unbekannt", "row-no-identity": "Zeile ohne Identität", "value-invalid": "Wert ungültig", "header-moved": "Spalte verschoben", "department-layout": "Gewerk nicht erkannt", "duplicate-conflict": "mehrdeutige Quellzeilen" } as Record<string, string>)[k] ?? k}`).join(" · ")}
        </p>
      )}

      {sum.conflict + sum.ambiguous > 0 && (
        <section aria-labelledby="reg-attention" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="reg-attention" className="text-sm font-semibold">Entscheidungen nötig</h3>
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="h-8 w-48 text-xs" aria-label="Anzeige"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="attention">Konflikte und mehrdeutige</SelectItem>
                <SelectItem value="conflict">nur Konflikte</SelectItem>
                <SelectItem value="ambiguous">nur mehrdeutige</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ul className="space-y-2">
            {attention.slice(0, shown).map(({ plan, record }) => {
              const d = decisions[plan.ref] ?? {};
              return (
                <li key={plan.ref} className="rounded-lg border p-3 text-xs" data-testid={`register-row-${plan.status}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={plan.status === "conflict" ? "secondary" : "outline"} className="text-2xs">{plan.status === "conflict" ? "Konflikt" : "Mehrdeutig"}</Badge>
                    <span className="font-medium">{record.fields.station ?? "—"}</span>
                    <span className="text-muted-foreground">{record.fields.projektnummer ?? "ohne Projektnummer"} · {record.fields.projektstand ?? "—"} · Zeile {record.ref}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-muted-foreground">{record.fields.projektbeschreibung ?? "ohne Beschreibung"}</p>
                  {plan.status === "conflict" ? (
                    <>
                      <ul className="mt-2 space-y-0.5">
                        {plan.changes.slice(0, 8).map((c) => (
                          <li key={c.key}><span className="text-muted-foreground">{changeLabel(c.key)}:</span> {short(c.from)} <span aria-hidden>→</span><span className="sr-only">wird zu</span> <strong>{short(c.to)}</strong>{c.kind === "fill" ? <span className="text-muted-foreground"> (ergänzt)</span> : null}</li>
                        ))}
                        {plan.changes.length > 8 && <li className="text-muted-foreground">… und {plan.changes.length - 8} weitere Änderungen</li>}
                      </ul>
                      <div className="mt-2 flex items-center gap-2">
                        <Checkbox id={`ow-${plan.ref}`} checked={!!d.overwrite} onCheckedChange={(c) => decide(plan.ref, { overwrite: c === true })} />
                        <Label htmlFor={`ow-${plan.ref}`} className="text-xs font-normal">Vorhandene Werte durch die der Datei ersetzen</Label>
                      </div>
                    </>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-muted-foreground">{plan.reason}</p>
                      <Select value={d.choice === undefined ? "skip" : String(d.choice)} onValueChange={(v) => decide(plan.ref, { choice: v === "skip" || v === "new" ? v : Number(v) })}>
                        <SelectTrigger className="h-8 w-full text-xs sm:w-[34rem]" aria-label={`Zuordnung für Zeile ${record.ref}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">Überspringen</SelectItem>
                          <SelectItem value="new">Als neues Projekt anlegen</SelectItem>
                          {plan.candidates.map((c) => (
                            <SelectItem key={c.projectId} value={String(c.projectId)}>
                              Diesem Projekt zuordnen und Werte übernehmen: #{c.projectId} · {c.station ?? "—"} · {c.projektstand ?? "—"} · {short(c.projektbeschreibung)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {attention.length > shown && <Button variant="outline" size="sm" onClick={more}>Weitere {Math.min(PAGE, attention.length - shown)} anzeigen ({n(attention.length - shown)} übrig)</Button>}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button className="h-10 gap-2" disabled={sending === 0} onClick={onApply} data-testid="register-apply">
          Übernehmen ({n(sending)} Datensätze)
        </Button>
        <Button variant="ghost" onClick={onOther}>Andere Datei</Button>
        <p className="text-xs text-muted-foreground">Konflikte und mehrdeutige Zeilen ohne Entscheidung bleiben unberührt.</p>
      </div>
    </div>
  );
}
