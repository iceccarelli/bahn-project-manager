import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PolicyHint } from "@/components/PolicyHint";
import type { Choice, ReviewRow } from "@shared/register/register-decisions";
import { REGISTER_POLICY } from "@shared/register/policy";
import type { PlannedChange } from "@shared/register/register-plan";

const FIELD_LABEL: Record<string, string> = {
  projektnummer: "Projektnummer", bahnhofsmanagement: "Bahnhofsmanagement", station: "Station", bahnhofsnummer: "Bahnhofsnummer", streckennummer: "Streckennummer",
  projektbeschreibung: "Beschreibung", projektstand: "Projektstand", projektleiter: "Projektleiter", terminProjektvorstellung: "Termin Projektvorstellung", kommentar: "Kommentar", projektLink: "Link",
};
export const changeLabel = (key: string) => {
  const m = /^review\.([^.]+)\.(status|prueferName|datum)$/.exec(key);
  return m ? `${m[1]} · ${m[2] === "status" ? "Status" : m[2] === "prueferName" ? "Prüfer" : "Datum"}` : (FIELD_LABEL[key] ?? key);
};
const short = (v: string | null) => (v === null ? "—" : v.length > 80 ? `${v.slice(0, 80)}…` : v);

/** The exact cells: `Feld: alt → neu`, fills marked. Nothing is abbreviated except very long text. */
export function ChangeList({ changes, limit = 12 }: { changes: readonly PlannedChange[]; limit?: number }) {
  if (changes.length === 0) return <p className="text-muted-foreground">Keine abweichenden Zellen.</p>;
  return (
    <ul className="space-y-0.5" data-testid="register-changes">
      {changes.slice(0, limit).map((c) => (
        <li key={c.key}>
          <span className="text-muted-foreground">{changeLabel(c.key)}:</span> {short(c.from)} <span aria-hidden>→</span>
          <span className="sr-only">wird zu</span> <strong>{short(c.to)}</strong>
          {c.kind === "fill" ? <span className="text-muted-foreground"> (ergänzt)</span> : <span className="text-amber-700 dark:text-amber-400"> (ersetzt)</span>}
        </li>
      ))}
      {changes.length > limit && <li className="text-muted-foreground">… und {changes.length - limit} weitere abweichende Zellen</li>}
    </ul>
  );
}

const OPEN = <SelectItem value="open">Offen lassen — nichts schreiben, später erneut fragen</SelectItem>;
const SKIP = <SelectItem value="skip">Dauerhaft ausschließen (wird gemerkt)</SelectItem>;

/** One conflict: a stored value would be replaced. */
export function ConflictCard({ row, choice, onChoice }: { row: ReviewRow; choice: Choice | undefined; onChoice: (c: Choice) => void }) {
  const { plan, record } = row;
  const progression = plan.basis === "core" && plan.changes.some((c) => c.key === "projektstand" || c.key === "terminProjektvorstellung");
  return (
    <li className="rounded-lg border p-3 text-xs" data-testid="register-row-conflict">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-2xs">{progression ? "Projektstand weitergeschrieben?" : "Konflikt"}</Badge>
        <span className="font-medium">{record.fields.station ?? "—"}</span>
        <span className="text-muted-foreground">{record.fields.projektnummer ?? "ohne Projektnummer"} · Zeile {record.ref}</span>
        <PolicyHint label="Konflikt" text={progression ? REGISTER_POLICY.progression : REGISTER_POLICY.conflict} />
      </div>
      <p className="mt-1 line-clamp-2 text-muted-foreground">{record.fields.projektbeschreibung ?? "ohne Beschreibung"}</p>
      <div className="mt-2"><ChangeList changes={plan.changes} /></div>
      <div className="mt-2">
        <Select value={String(choice ?? "open")} onValueChange={(v) => onChoice(v as Choice)}>
          <SelectTrigger className="h-8 w-full text-xs sm:w-[34rem]" aria-label={`Entscheidung für Zeile ${record.ref}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {OPEN}
            <SelectItem value="replace">{progression ? "Fortschreiben — Werte der Datei übernehmen" : "Werte der Datei übernehmen (ersetzt)"}</SelectItem>
            {progression && <SelectItem value="new">Als neue Anmeldung anlegen — das vorhandene Projekt bleibt</SelectItem>}
            {SKIP}
          </SelectContent>
        </Select>
      </div>
    </li>
  );
}

/** One ambiguous row (not a source group): which project, or a new one — with the exact cells per candidate. */
export function AmbiguousCard({ row, choice, onChoice }: { row: ReviewRow; choice: Choice | undefined; onChoice: (c: Choice) => void }) {
  const { plan, record } = row;
  const chosen = typeof choice === "number" ? plan.candidates.find((c) => c.projectId === choice) : undefined;
  return (
    <li className="rounded-lg border p-3 text-xs" data-testid="register-row-ambiguous">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-2xs">Mehrdeutig</Badge>
        <span className="font-medium">{record.fields.station ?? "—"}</span>
        <span className="text-muted-foreground">{record.fields.projektnummer ?? "ohne Projektnummer"} · {record.fields.projektstand ?? "—"} · Zeile {record.ref}</span>
        <PolicyHint label="mehrdeutig" text={REGISTER_POLICY.ambiguous} />
      </div>
      <p className="mt-1 line-clamp-2 text-muted-foreground">{record.fields.projektbeschreibung ?? "ohne Beschreibung"}</p>
      <p className="mt-1 text-muted-foreground">{plan.reason}</p>
      <div className="mt-2 space-y-2">
        <Select value={String(choice ?? "open")} onValueChange={(v) => onChoice(v === "open" || v === "skip" || v === "new" ? v : Number(v))}>
          <SelectTrigger className="h-8 w-full text-xs sm:w-[34rem]" aria-label={`Zuordnung für Zeile ${record.ref}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {OPEN}
            <SelectItem value="new">Als neues Projekt anlegen</SelectItem>
            {plan.candidates.map((c) => (
              <SelectItem key={c.projectId} value={String(c.projectId)}>
                Diesem Projekt zuordnen: #{c.projectId} · {c.station ?? "—"} · {c.projektstand ?? "—"} · {short(c.projektbeschreibung)}
              </SelectItem>
            ))}
            {SKIP}
          </SelectContent>
        </Select>
        {chosen && (
          <div className="rounded-md bg-muted/40 p-2" data-testid="register-candidate-diff">
            <p className="mb-1 font-medium">Änderungen an Projekt #{chosen.projectId}:</p>
            <ChangeList changes={chosen.changes} />
          </div>
        )}
      </div>
    </li>
  );
}

/** A group of rows of the FILE that share one identity but differ in content: the differing cells, side by side, and "this row wins". */
export function SourceGroupCard({ rows, choices, onChoice }: { rows: ReviewRow[]; choices: Readonly<Record<number, Choice | undefined>>; onChoice: (ref: number, c: Choice) => void }) {
  const first = rows[0]!;
  const diff = first.plan.sourceDiff ?? [];
  const winner = rows.find((r) => choices[r.plan.ref] === "wins")?.plan.ref;
  const setAll = (c: Choice) => rows.forEach((r) => onChoice(r.plan.ref, c));
  return (
    <li className="rounded-lg border p-3 text-xs" data-testid="register-source-group">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-2xs">Datei nicht eindeutig</Badge>
        <span className="font-medium">{first.record.fields.station ?? "—"}</span>
        <span className="text-muted-foreground">{first.record.fields.projektnummer ?? "ohne Projektnummer"} · {first.record.fields.projektstand ?? "—"} · Zeilen {rows.map((r) => r.record.ref).join(", ")}</span>
        <PolicyHint label="Datei nicht eindeutig" text={REGISTER_POLICY.sourceGroup} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-medium">Zelle</th>
              {rows.map((r) => <th key={r.record.ref} scope="col" className="py-1 pr-3 font-medium">Zeile {r.record.ref}</th>)}
            </tr>
          </thead>
          <tbody>
            {diff.map((d) => (
              <tr key={d.key} className="border-t">
                <th scope="row" className="py-1 pr-3 font-normal text-muted-foreground">{changeLabel(d.key)}</th>
                {rows.map((r) => <td key={r.record.ref} className="py-1 pr-3">{short(d.values[r.record.ref] ?? null)}</td>)}
              </tr>
            ))}
            <tr className="border-t">
              <th scope="row" className="py-1 pr-3 font-normal text-muted-foreground">Entscheidung</th>
              {rows.map((r) => (
                <td key={r.record.ref} className="py-1 pr-3">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio" name={`group-${first.record.ref}`} checked={winner === r.plan.ref}
                      onChange={() => rows.forEach((o) => onChoice(o.plan.ref, o.plan.ref === r.plan.ref ? "wins" : "open"))}
                      data-testid={`register-wins-${r.record.ref}`}
                    />
                    Diese Zeile gilt
                  </label>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" className="text-primary hover:underline" onClick={() => setAll("skip")} data-testid="register-skip-group">Alle Zeilen dauerhaft ausschließen</button>
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => setAll("open")}>Offen lassen</button>
      </div>
    </li>
  );
}
