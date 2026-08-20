import { Button } from "@/components/ui/button";
import { Unterschriftenblatt } from "./Unterschriftenblatt";
import type { ChecklistDraft } from "@/hooks/useChecklistDraft";
import { CHECKLIST_BY_KEY } from "@shared/checklist";
import { formatGerman } from "@shared/date";
import { Printer } from "lucide-react";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-2xs font-bold text-muted-foreground">{label}</dt>
      <dd className="text-2xs">{value || <span className="text-muted-foreground">—</span>}</dd>
    </>
  );
}

export function Step5Bestaetigung({ draft }: { draft: ChecklistDraft }) {
  const { header, mode, reviews, requiredCount, termin, notified, answers, stepIssues, canSubmit } =
    draft;
  const blocking = Object.entries(stepIssues).flatMap(([step, issues]) =>
    issues.map((i) => ({ step: Number(step), ...i })),
  );

  return (
    <div className="space-y-6">
      {!canSubmit && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
          <div className="text-xs font-black text-primary-strong">
            Noch nicht vollständig — {blocking.length}{" "}
            {blocking.length === 1 ? "offener Punkt" : "offene Punkte"}
          </div>
          <ul className="mt-1.5 space-y-0.5 text-2xs">
            {blocking.map((b) => (
              <li key={`${b.step}-${b.field}`}>
                <span className="font-bold">Schritt {b.step}:</span> {b.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-sm font-black tracking-tight">Zusammenfassung</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <Row label="Modus" value={mode} />
              <Row label="Projektnummer" value={header.projektnummer} />
              <Row label="Projektbezeichnung" value={header.projektbezeichnung} />
              <Row label="Station" value={header.stationsname} />
              <Row label="Bahnhofsnummer" value={header.bahnhofsnummer} />
              <Row label="BM" value={header.bahnhofsmanagement} />
              <Row label="Projektstand" value={header.projektstand} />
              <Row label="Projektleitung" value={header.projektleitung} />
              <Row
                label="Termin"
                value={
                  termin
                    ? `${formatGerman(termin.datum)} · ${termin.von}–${termin.bis}`
                    : "ohne Projektvorstellung"
                }
              />
              <Row label="Freischaltung FAA" value={answers.freischaltungFaa?.answer ?? ""} />
              <Row label="Unterschriftenblatt" value={answers.unterschriftenblatt?.answer ?? ""} />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-black tracking-tight">
              Fachprüfungen · {requiredCount} von 14 offen
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {reviews.map((r) => (
                <span
                  key={r.department}
                  className={`rounded px-2 py-0.5 text-2xs font-bold ${
                    r.status === "offen"
                      ? "bg-primary/10 text-primary-strong"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {r.department}
                </span>
              ))}
            </div>
            {notified.length > 0 && (
              <p className="mt-2 text-2xs text-muted-foreground">
                Zusätzlich benachrichtigt:{" "}
                {notified.map((k) => CHECKLIST_BY_KEY[k]?.gewerk).join(" · ")}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-muted/40 px-4 py-3">
            <h3 className="text-xs font-black">Was beim Anmelden passiert</h3>
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-2xs text-muted-foreground">
              <li>Die Checkliste wird als „submitted" gespeichert.</li>
              <li>Ein Projekt mit allen 14 Prüfzeilen wird angelegt.</li>
              {termin && <li>Der gewählte Termin wird auf „Gebucht" gesetzt.</li>}
              <li>Ein Eintrag in der Änderungshistorie wird geschrieben.</li>
            </ol>
            <p className="mt-2 text-2xs text-muted-foreground">
              PDF-Export und der Versand an FAA / TBQ / BM folgen in Stufe 4. Bis dahin lässt sich
              das Unterschriftenblatt über „Drucken" als PDF ausgeben.
            </p>
          </section>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-black tracking-tight">Unterschriftenblatt</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              className="text-xs print:hidden"
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Drucken / als PDF sichern
            </Button>
          </div>
          <div id="unterschriftenblatt-print">
            <Unterschriftenblatt
              projektnummer={header.projektnummer}
              projektbezeichnung={header.projektbezeichnung}
              projektleitung={header.projektleitung}
              reviews={reviews}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
