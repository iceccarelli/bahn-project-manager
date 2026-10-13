import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Undo2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { PolicyHint } from "@/components/PolicyHint";
import { AmbiguousCard, ConflictCard, SourceGroupCard } from "@/components/projects/RegisterDecisionCards";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { serverApi } from "@/realtime/serverApi";
import { sheetsFromWorkbook } from "@shared/workbook";
import { analyzeSource, parseRegisterWorkbook, type RegisterParse, type RegisterRecord, type SourceAnalysis } from "@shared/register/register-import";
import { chunkRecords, summarizePlan, type PlanRow } from "@shared/register/register-plan";
import { buildApplyRows, contextFor, unskipRows, type Choice, type ReviewRow } from "@shared/register/register-decisions";
import { REGISTER_POLICY } from "@shared/register/policy";
import { emptyCounts, type RegisterApplyResult } from "@shared/register/register-contract";

const MAX_BYTES = 25 * 1024 * 1024;
const PAGE = 30;
const n = (x: number) => x.toLocaleString("de-DE");
type Filter = "attention" | "conflict" | "ambiguous";

/** A question still open: undecided, and not settled by a winning row elsewhere in its group. */
const isOpenQuestion = (r: ReviewRow, rows: readonly ReviewRow[], choices: Readonly<Record<number, Choice>>): boolean => {
  if (r.plan.status !== "conflict" && r.plan.status !== "ambiguous") return false;
  if ((choices[r.plan.ref] ?? "open") !== "open") return false;
  return !(r.plan.sourceRows ?? []).some((ref) => choices[ref] === "wins" && rows.some((x) => x.plan.ref === ref));
};

type State =
  | { phase: "pick" }
  | { phase: "reading"; name: string }
  | { phase: "previewing"; name: string; done: number; total: number }
  | { phase: "review"; name: string; parsed: RegisterParse; source: SourceAnalysis; rows: ReviewRow[]; chunks: number }
  | { phase: "applying"; name: string; done: number; total: number }
  | { phase: "done"; name: string; totals: ReturnType<typeof emptyCounts>; open: number; winnersOpen: number }
  | { phase: "error"; message: string; name?: string };

const WARNING_TEXT: Record<string, string> = {
  "date-unparseable": "Datum nicht lesbar (Feld bleibt leer)", "status-unknown": "Status außerhalb des Vokabulars (Status bleibt leer)",
  "bahnhofsmanagement-unknown": "Bahnhofsmanagement unbekannt (Feld bleibt leer)", "row-no-identity": "Zeile ohne Identität (nicht importiert)",
  "value-invalid": "Wert ungültig (nicht importiert)", "header-moved": "Spalte verschoben (nach Kopfzeile gelesen)", "department-layout": "Gewerk nicht erkannt",
  "duplicate-conflict": "Zeilen mit derselben Identität, anderer Inhalt (siehe Entscheidungen)",
};

/**
 * Administrator import of the Übersichtsliste (the project register) into the Projekte. The file is read in the browser —
 * cell values only, macros are never run — and nothing is written until the preview has been seen. Every question the file
 * cannot answer is put to the administrator with the exact differing cells and the recommended policy
 * (shared/register/policy.ts): replace, take as a new registration, map to a project, pick the winning row of the file, or
 * exclude for good. Decisions are remembered (project_source_keys), so the same file asks nothing twice. Each chunk is
 * applied in one server transaction through the same write path as an edit.
 */
export function RegisterImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, setState] = useState<State>({ phase: "pick" });
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [untaken, setUntaken] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState<Filter>("attention");
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const qc = useQueryClient();

  const reset = () => { setState({ phase: "pick" }); setChoices({}); setUntaken(new Set()); setShown(PAGE); };
  const close = (next: boolean) => {
    if (!next) { cancelled.current = true; reset(); }
    onOpenChange(next);
  };
  const choose = (ref: number, c: Choice) => setChoices((prev) => ({ ...prev, [ref]: c }));

  const read = async (file: File) => {
    cancelled.current = false;
    setChoices({}); setUntaken(new Set()); setShown(PAGE);
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
      // the planner, not the browser, turns rows of the file that disagree into explicit questions: they go with the rest
      const chunks = chunkRecords(source.forPlanning);
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
    let openRows = 0;
    let winnersOpen = 0;
    const runId = crypto.randomUUID();
    try {
      // the winner of a group of undecidable source rows is judged ALONE (its siblings are being excluded)
      const winnerPlans = new Map<number, PlanRow>();
      for (const r of s.rows) if (choices[r.plan.ref] === "wins") {
        const alone = await serverApi.projects.registerPreview.mutate({ records: [r.record], context: contextFor(s.rows.filter((x) => x.chunk === r.chunk), new Set([r.record.ref])) });
        const p = alone.rows[0];
        if (p) winnerPlans.set(r.plan.ref, p as PlanRow);
      }
      for (let i = 0; i < s.chunks; i++) {
        if (cancelled.current) return;
        setState({ phase: "applying", name: s.name, done: i, total: s.chunks });
        const chunkRows = s.rows.filter((r) => r.chunk === i);
        const built = buildApplyRows(chunkRows, choices, winnerPlans);
        const rows = [...built.rows, ...unskipRows(chunkRows, untaken)];
        winnersOpen += built.winnerNeedsDecision.length;
        openRows += chunkRows.filter((r) => isOpenQuestion(r, chunkRows, choices)).length;
        if (!rows.length) continue;
        const context = contextFor(chunkRows, new Set(rows.map((r) => r.record.ref)));
        const res = (await serverApi.projects.registerApply.mutate({ source: s.name, part: { index: i + 1, total: s.chunks }, rows, context, idempotencyKey: `register-${runId}-${i}` })) as RegisterApplyResult;
        for (const [k, c] of Object.entries(res.counts)) totals[k as keyof typeof totals] += c;
      }
      await qc.invalidateQueries({ queryKey: ["server"] });
      setState({ phase: "done", name: s.name, totals, open: openRows, winnersOpen });
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
              {state.phase === "error" && <Alert variant="destructive" role="alert"><AlertTriangle aria-hidden /><AlertTitle>{state.name ?? "Import"}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>}
              <Button className="h-10 gap-2" onClick={() => input.current?.click()}><Upload className="h-4 w-4" aria-hidden /> Datei wählen</Button>
              <p className="text-xs text-muted-foreground">{REGISTER_POLICY.blanks}</p>
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
            <Review s={state} choices={choices} choose={choose} untaken={untaken} untake={(ref, on) => setUntaken((p) => { const x = new Set(p); if (on) x.add(ref); else x.delete(ref); return x; })}
              shown={shown} more={() => setShown((x) => x + PAGE)} filter={filter} setFilter={(f) => { setFilter(f); setShown(PAGE); }}
              onApply={() => void apply(state)} onOther={() => input.current?.click()} />
          )}

          {state.phase === "done" && (
            <Alert role="status" data-testid="register-done">
              <CheckCircle2 aria-hidden />
              <AlertTitle>{state.name} übernommen</AlertTitle>
              <AlertDescription className="space-y-1">
                <span className="block">{n(state.totals.created)} Projekte neu, {n(state.totals.updated)} geändert, {n(state.totals.unchanged)} unverändert.</span>
                {(state.totals.skipped + state.totals.unskipped) > 0 && <span className="block">{n(state.totals.skipped)} Zeilen dauerhaft ausgeschlossen, {n(state.totals.unskipped)} Ausschlüsse zurückgenommen.</span>}
                {(state.totals.held + state.totals.stale + state.totals.exists + state.totals.refused + state.open + state.winnersOpen) > 0 && (
                  <span className="block">
                    Nicht übernommen: {n(state.open)} offene Fragen, {n(state.winnersOpen)} gewählte Zeilen brauchen noch eine Entscheidung, {n(state.totals.held)} nicht bestätigt, {n(state.totals.stale)} zwischenzeitlich geändert, {n(state.totals.exists)} bereits vorhanden, {n(state.totals.refused)} abgelehnt.
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

function Review({ s, choices, choose, untaken, untake, shown, more, filter, setFilter, onApply, onOther }: {
  s: Extract<State, { phase: "review" }>; choices: Record<number, Choice>; choose: (ref: number, c: Choice) => void; untaken: Set<number>; untake: (ref: number, on: boolean) => void;
  shown: number; more: () => void; filter: Filter; setFilter: (f: Filter) => void; onApply: () => void; onOther: () => void;
}) {
  const plans = useMemo(() => s.rows.map((r) => r.plan), [s.rows]);
  const sum = useMemo(() => summarizePlan(plans), [plans]);
  const rep = s.parsed.report;
  const questions = useMemo(() => s.rows.filter((r) => r.plan.status === "conflict" || r.plan.status === "ambiguous"), [s.rows]);
  // a group of source rows is ONE card; everything else one card per row
  const cards = useMemo(() => {
    const seen = new Set<number>();
    const out: Array<{ kind: "group"; rows: ReviewRow[] } | { kind: "row"; row: ReviewRow }> = [];
    for (const r of questions) {
      if (r.plan.sourceRows) {
        if (seen.has(r.plan.ref)) continue;
        const g = questions.filter((x) => r.plan.sourceRows?.includes(x.plan.ref));
        for (const x of g) seen.add(x.plan.ref);
        if (filter !== "conflict") out.push({ kind: "group", rows: g });
      } else if (filter === "attention" || filter === r.plan.status) out.push({ kind: "row", row: r });
    }
    return out;
  }, [questions, filter]);
  const sending = useMemo(() => {
    const winners = new Map<number, PlanRow>();
    for (const r of s.rows) if (choices[r.plan.ref] === "wins") winners.set(r.plan.ref, { ...r.plan, status: "add", sourceRows: undefined });
    return buildApplyRows(s.rows, choices, winners).rows.length + untaken.size;
  }, [s.rows, choices, untaken]);
  const excluded = useMemo(() => s.rows.filter((r) => r.plan.status === "skipped"), [s.rows]);
  const open = questions.filter((r) => isOpenQuestion(r, s.rows, choices)).length;

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

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-6" data-testid="register-summary">
        {([
          ["Neu", sum.add, "wird angelegt"], ["Ergänzt", sum.update, "nur leere Felder"], ["Unverändert", sum.unchanged, "nichts zu tun"],
          ["Konflikte", sum.conflict, "ersetzt Werte"], ["Mehrdeutig", sum.ambiguous, "Entscheidung nötig"], ["Ausgeschlossen", sum.skipped, "früher entschieden"],
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

      {rep.unknownStatuses.length > 0 && (
        <section aria-labelledby="reg-status" className="rounded-lg border p-3 text-xs" data-testid="register-unknown-status">
          <h3 id="reg-status" className="mb-1 flex items-center gap-2 text-sm font-semibold">Status außerhalb des Vokabulars <PolicyHint label="Status" text={REGISTER_POLICY.unknownStatus} /></h3>
          <p className="mb-2 text-muted-foreground">Nicht übernommen (Prüfer und Datum dieser Zeilen schon). Ob ein Wert ins Vokabular gehört, entscheiden die Datenverantwortlichen.</p>
          <ul className="space-y-0.5">
            {rep.unknownStatuses.map((u) => <li key={`${u.department}|${u.value}`}><strong>{u.value}</strong> · {u.department} · {n(u.rows)} Zeile{u.rows === 1 ? "" : "n"}</li>)}
          </ul>
        </section>
      )}

      {(() => {
        const kinds = new Map<string, number>();
        for (const w of [...rep.issues, ...s.source.issues].filter((i) => i.severity === "warn")) kinds.set(w.kind, (kinds.get(w.kind) ?? 0) + 1);
        return kinds.size ? (
          <p className="text-xs text-muted-foreground" data-testid="register-warnings">
            Hinweise: {[...kinds].map(([k, c]) => `${n(c)} × ${WARNING_TEXT[k] ?? k}`).join(" · ")}
          </p>
        ) : null;
      })()}

      {questions.length > 0 && (
        <section aria-labelledby="reg-attention" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="reg-attention" className="flex items-center gap-2 text-sm font-semibold">Entscheidungen nötig ({n(open)} offen)</h3>
            <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <SelectTrigger className="h-8 w-52 text-xs" aria-label="Anzeige"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="attention">Konflikte und mehrdeutige</SelectItem>
                <SelectItem value="conflict">nur Konflikte</SelectItem>
                <SelectItem value="ambiguous">nur mehrdeutige</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{REGISTER_POLICY.skip} Was offen bleibt, wird nicht angefasst und beim nächsten Import erneut gefragt.</p>
          <ul className="space-y-2">
            {cards.slice(0, shown).map((c) => c.kind === "group"
              ? <SourceGroupCard key={`g${c.rows[0]?.plan.ref}`} rows={c.rows} choices={choices} onChoice={choose} />
              : c.row.plan.status === "conflict"
                ? <ConflictCard key={c.row.plan.ref} row={c.row} choice={choices[c.row.plan.ref]} onChoice={(v) => choose(c.row.plan.ref, v)} />
                : <AmbiguousCard key={c.row.plan.ref} row={c.row} choice={choices[c.row.plan.ref]} onChoice={(v) => choose(c.row.plan.ref, v)} />)}
          </ul>
          {cards.length > shown && <Button variant="outline" size="sm" onClick={more}>Weitere {Math.min(PAGE, cards.length - shown)} anzeigen ({n(cards.length - shown)} übrig)</Button>}
        </section>
      )}

      {excluded.length > 0 && (
        <details className="rounded-lg border p-3 text-xs" data-testid="register-excluded">
          <summary className="cursor-pointer font-medium">Früher ausgeschlossen ({n(excluded.length)})</summary>
          <ul className="mt-2 space-y-1">
            {excluded.slice(0, 50).map((r) => (
              <li key={r.plan.ref} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.record.fields.station ?? "—"}</span>
                <span className="text-muted-foreground">{r.record.fields.projektnummer ?? "ohne Projektnummer"} · {r.record.fields.projektstand ?? "—"} · Zeile {r.record.ref}</span>
                <button type="button" className={`ml-auto inline-flex items-center gap-1 hover:underline ${untaken.has(r.plan.ref) ? "text-primary" : "text-muted-foreground"}`} onClick={() => untake(r.plan.ref, !untaken.has(r.plan.ref))} aria-pressed={untaken.has(r.plan.ref)}>
                  <Undo2 className="h-3 w-3" aria-hidden /> {untaken.has(r.plan.ref) ? "Wird zurückgenommen" : "Entscheidung zurücknehmen"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button className="h-10 gap-2" disabled={sending === 0} onClick={onApply} data-testid="register-apply">
          Übernehmen ({n(sending)} Datensätze und Entscheidungen)
        </Button>
        <Button variant="ghost" onClick={onOther}>Andere Datei</Button>
        <p className="text-xs text-muted-foreground">Offene Fragen bleiben unberührt.</p>
      </div>
    </div>
  );
}
