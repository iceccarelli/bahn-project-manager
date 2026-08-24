import { Button } from "@/components/ui/button";
import { Unterschriftenblatt } from "./Unterschriftenblatt";
import type { ChecklistDraft } from "@/hooks/useChecklistDraft";
import { CHECKLIST_BY_KEY } from "@shared/checklist";
import { formatGerman } from "@shared/date";
import {
  bahnhofsmanagementContact,
  displayName,
  mailListFor,
  recipientsFor,
} from "@shared/contacts";
import { Printer } from "lucide-react";
import { effectiveRecipients } from "@shared/contact-overrides";
import { useRecipientOverrides } from "@/hooks/useRecipientOverrides";
import { RecipientGap } from "./RecipientGap";

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

  // Who this actually reaches. The Excel macro never showed this, which is how
  // the ITK off-by-two survived: the mail went out, and nobody could see that
  // it went to a Brandschutz specialist instead of the two busiest ITK
  // reviewers. shared/contacts.ts has the corrected ranges.
  const { overrides } = useRecipientOverrides();
  const openDepartments = reviews.filter((r) => r.status === "offen").map((r) => r.department);
  const mailCount = mailListFor(openDepartments).length;
  /*
   * Unreachable AFTER everything, not just after the workbook.
   *
   * It used to ask the Hilfsdatei alone, so a department stayed flagged even
   * once somebody had supplied the missing address — the warning could never
   * be cleared, which is the fastest way to teach a reader to ignore it.
   */
  const unreachable = openDepartments.filter(
    (d) => effectiveRecipients(d, recipientsFor(d), overrides).length === 0,
  );
  const bmContact = bahnhofsmanagementContact(header.bahnhofsmanagement);

  return (
    <div className="space-y-6">
      {!canSubmit && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
          <div className="text-xs font-bold text-primary-strong">
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
            <h3 className="mb-2 text-sm font-bold tracking-tight">Zusammenfassung</h3>
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
            <h3 className="mb-2 text-sm font-bold tracking-tight">
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

          <section>
            <h3 className="mb-2 text-sm font-bold tracking-tight">
              Benachrichtigungen
            </h3>
            {openDepartments.length === 0 ? (
              <p className="text-2xs text-muted-foreground">
                Keine Fachprüfung erforderlich — es wird niemand benachrichtigt.
              </p>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {openDepartments.map((dept) => {
                    const people = recipientsFor(dept);
                    return (
                      <li key={dept} className="grid grid-cols-[auto_1fr] gap-x-3 text-2xs">
                        <span className="font-bold">{dept}</span>
                        {people.length > 0 ? (
                          <span className="text-muted-foreground">
                            {people.map(displayName).join(", ")}
                          </span>
                        ) : (
                          <span className="font-bold text-primary-strong">
                            keine Adresse hinterlegt — es wird niemand benachrichtigt
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-2xs text-muted-foreground">
                  {mailCount} {mailCount === 1 ? "Empfänger" : "Empfänger"} insgesamt
                  {bmContact ? ` · BM ${bmContact.group}: ${bmContact.name}` : ""}
                </p>
                {/*
                  Named, and now fixable.
                  
                  The Excel macro reported a successful send for these too,
                  which is how LST went 52 reviews without one person being
                  told. Saying so was the first half; the second half is a
                  field for whoever knows the address, because a gap nobody can
                  close is a gap that stays open.
                */}
                <RecipientGap departments={unreachable} />
              </>
            )}
          </section>

          <section className="rounded-lg border border-border bg-muted/40 px-4 py-3">
            <h3 className="text-xs font-bold">Was beim Anmelden passiert</h3>
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-2xs text-muted-foreground">
              <li>Die Checkliste wird als „submitted" gespeichert.</li>
              <li>Ein Projekt mit allen 14 Prüfzeilen wird angelegt.</li>
              {termin && <li>Der gewählte Termin wird auf „Gebucht" gesetzt.</li>}
              <li>Ein Eintrag in der Änderungshistorie wird geschrieben.</li>
            </ol>
            <p className="mt-2 text-2xs text-muted-foreground">
              Die Checkliste lässt sich jederzeit über „Checkliste als PDF" exportieren und das
              Unterschriftenblatt über „Drucken". Ein automatischer Versand an FAA / TBQ / BM
              findet nicht statt.
            </p>
          </section>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold tracking-tight">Unterschriftenblatt</h3>
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
