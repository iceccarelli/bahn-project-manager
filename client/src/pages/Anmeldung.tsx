import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Step1Projekt } from "@/components/anmeldung/Step1Projekt";
import { Step2Checkliste } from "@/components/anmeldung/Step2Checkliste";
import { Step3Pruefungen } from "@/components/anmeldung/Step3Pruefungen";
import { Step4Termin } from "@/components/anmeldung/Step4Termin";
import { Step5Bestaetigung } from "@/components/anmeldung/Step5Bestaetigung";
import { visibleQuestions } from "@shared/checklist";
import { useChecklistDraft, type ChecklistDraft } from "@/hooks/useChecklistDraft";
import { bookSlot } from "@/hooks/useSchedule";
import { CHECKLIST_MODES } from "@shared/checklist";
import { Check, ChevronLeft, ChevronRight, FileDown, Mail, Save } from "lucide-react";
import { recipientsFor } from "@shared/contacts";
import type { Department } from "@shared/types";
import { mailtoWithContext, messageSubject, type MessageContext } from "@shared/message";
import { useAuditTrail } from "@/hooks/useAuditTrail";
import { useUpdateProject } from "@/hooks/useDataQuery";
import { AUDIT_ACTIONS } from "@shared/audit-actions";
import { generatedLabel } from "@shared/generated-stamp";

const STEPS = [
  { n: 1, title: "Projekt", subtitle: "Kopfdaten & Station" },
  // Was the literal "22 Fragen" (= CHECKLIST_QUESTIONS.length), but Step 2
  // renders visibleQuestions(mode): 19 in Projektanmeldung, 18 in
  // Projektkonfiguration. The step header promised three questions that are
  // never shown.
  { n: 2, title: "Checkliste", subtitle: null },
  { n: 3, title: "Prüfungen", subtitle: "14 Gewerke" },
  { n: 4, title: "Termin", subtitle: "Fachspezialistenprüfung" },
  { n: 5, title: "Bestätigung", subtitle: "Anmelden" },
] as const;

export default function Anmeldung() {
  const [, setLocation] = useLocation();
  const draft = useChecklistDraft();
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState<{ projectId: number } | null>(null);
  /**
   * The project this wizard already created, if it did.
   *
   * A failed slot booking sends the user back to step 4 to pick another time,
   * and the retry called draft.submit() again — which persists the checklist
   * and creates a *second* project with the same Projektnummer. One rejected
   * booking was enough to duplicate a project in a 1,298-row dataset. The
   * project is created once; a retry only books.
   */
  type CreatedProject = Awaited<ReturnType<ChecklistDraft["submit"]>>["project"];
  const createdRef = useRef<CreatedProject | null>(null);
  const { recordDocument, recordMessage, recordEvent } = useAuditTrail();
  const updateProject = useUpdateProject();
  const [pdfState, setPdfState] = useState<"idle" | "working">("idle");

  const issuesForStep = draft.stepIssues[step] ?? [];
  const stepIsComplete = (n: number) => (draft.stepIssues[n]?.length ?? 0) === 0;

  const goTo = (n: number) => setStep(Math.min(5, Math.max(1, n)));

  const handleSaveDraft = async () => {
    try {
      const saved = await draft.saveDraft();
      recordEvent(
        AUDIT_ACTIONS.entwurfGespeichert,
        [
          `Entwurf Nr. ${saved.id}`,
          draft.header.projektnummer.trim() || "ohne Projektnummer",
          draft.header.stationsname.trim(),
        ]
          .filter(Boolean)
          .join(" · "),
      );
      toast.success(`Entwurf gespeichert (Nr. ${saved.id})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Entwurf konnte nicht gespeichert werden");
    }
  };

  const handleDownloadPdf = async () => {
    setPdfState("working");
    try {
      const { downloadChecklistPdf } = await import("@/pdf/downloadChecklistPdf");
      const filename = await downloadChecklistPdf({
        projektnummer: draft.header.projektnummer,
        projektbezeichnung: draft.header.projektbezeichnung,
        stationsname: draft.header.stationsname,
        bahnhofsnummer: draft.header.bahnhofsnummer,
        bahnhofsmanagement: draft.header.bahnhofsmanagement,
        projektstand: draft.header.projektstand,
        projektleitung: draft.header.projektleitung,
        mode: draft.mode,
        termin: draft.termin
          ? { datum: draft.termin.datum, von: draft.termin.von, bis: draft.termin.bis }
          : null,
        answers: draft.answers,
        reviews: draft.reviews,
        generatedAt: new Date().toISOString(),
        complete: draft.canSubmit,
      });
      recordDocument("Checkliste", filename, draft.header.projektnummer || "Entwurf");
      toast.success(`${filename} heruntergeladen`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF konnte nicht erzeugt werden");
    } finally {
      setPdfState("idle");
    }
  };

  const handleSubmit = async () => {
    try {
      // Create once. On a retry after a rejected slot the project already
      // exists and only the booking is repeated.
      const project = createdRef.current ?? (await draft.submit()).project;
      createdRef.current = project;

      if (draft.termin) {
        const info = `${draft.header.projektleitung} - ${draft.header.stationsname} - ${draft.header.projektstand}`;
        if (!bookSlot(draft.termin.slotId, String(project.id), info)) {
          toast.warning("Der Termin war bereits vergeben — bitte einen anderen wählen.");
          goTo(4);
          return;
        }
        // A retry can land on a different day than the project was created
        // with. Leaving terminProjektvorstellung on the first pick would put
        // the project and the booking on two different dates — the exact drift
        // this project exists to prevent. The write goes through the normal
        // mutation, so it is optimistic, rolled back on refusal, and audited.
        if (draft.termin.datum && project.terminProjektvorstellung !== draft.termin.datum) {
          updateProject.mutate({
            id: project.id,
            field: "terminProjektvorstellung",
            value: draft.termin.datum,
          });
        }

        // Only now is the slot actually taken.
        recordEvent(
          AUDIT_ACTIONS.terminGebucht,
          `${project.projektnummer ?? `Projekt ${project.id}`} · ${draft.header.stationsname.trim()} · ${draft.termin.datum} ${draft.termin.von}–${draft.termin.bis}`,
        );
      }
      setSubmitted({ projectId: project.id });
      toast.success(
        `Fachspezialistenprüfung angemeldet — Projekt ${project.projektnummer ?? project.id} angelegt`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen");
    }
  };

  /** The Gewerke this Anmeldung left open, with whoever Hilfsdatei addresses. */
  const openReviewDepartments = draft.reviews
    .filter((r) => r.status === "offen")
    .map((r) => ({
      dept: r.department,
      recipients: recipientsFor(r.department as Department),
    }));

  /** The same message body the detail dialog sends, built from the draft. */
  const notifyContext = (department: string): MessageContext => ({
    projektnummer: draft.header.projektnummer,
    station: draft.header.stationsname,
    department,
    bahnhofsmanagement: draft.header.bahnhofsmanagement,
    projektstand: draft.header.projektstand,
    projektbeschreibung: draft.header.projektbezeichnung,
    terminProjektvorstellung: draft.termin
      ? `${draft.termin.datum} ${draft.termin.von}–${draft.termin.bis}`
      : "",
    status: "offen",
    absender: draft.header.projektleitung,
    href:
      typeof window !== "undefined" && draft.header.projektnummer
        ? `${window.location.origin}/projects?q=${encodeURIComponent(draft.header.projektnummer)}`
        : "",
    generatedAt: generatedLabel(),
  });

  if (submitted) {
    return (
      <div className="space-y-6 p-6">
        <Card className="mx-auto max-w-xl">
          <CardContent className="space-y-4 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary">
              <Check className="h-8 w-8 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Anmeldung abgeschlossen</h1>
            <p className="text-sm text-muted-foreground">
              Projekt <strong className="text-foreground">{draft.header.projektnummer}</strong> ist
              angelegt, {draft.requiredCount} von 14 Fachprüfungen stehen offen
              {draft.termin ? ` und der Termin am ${draft.termin.datum} ist gebucht` : ""}.
            </p>
            {/*
              Notify the Fachbereiche whose Prüfung this Anmeldung just opened.
            
              The wizard creates the project and the review rows and then the
              process stops: nothing tells the departments that a Prüfung is
              waiting. That was the whole point of the Excel macro this replaces.
              There is no server to send from — production is a static SPA — so
              the app opens the user's own Outlook with the message already
              written, one per Fachbereich, addressed from Hilfsdatei.
            
              Only the Gewerke that are actually open, and only those with an
              address on file. LST has neither of its two rows filled in, so it
              says so instead of opening an empty mail.
            */}
            {openReviewDepartments.length > 0 && (
              <div className="rounded-xl border bg-muted/30 p-4 text-left">
                <p className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">
                  Fachbereiche benachrichtigen
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Öffnet Outlook mit fertig ausgefülltem Betreff und Text — Projektnummer, Station,
                  Projektstand und Termin stehen bereits darin.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {openReviewDepartments.map(({ dept, recipients }) =>
                    recipients.length > 0 ? (
                      <Button key={dept} asChild variant="outline" size="sm" className="h-9 gap-1.5">
                        <a
                          href={mailtoWithContext(
                            recipients.map((r) => r.mail).join(","),
                            notifyContext(dept),
                          )}
                          onClick={() =>
                            recordMessage(
                              "mail",
                              `${dept} (${recipients.length})`,
                              messageSubject(notifyContext(dept)),
                            )
                          }
                        >
                          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                          {dept}
                        </a>
                      </Button>
                    ) : (
                      <span
                        key={dept}
                        className="inline-flex h-9 items-center rounded-md border border-dashed px-3 text-xs text-amber-700 dark:text-amber-500"
                        title={`Für ${dept} ist in der Hilfsdatei keine Adresse hinterlegt`}
                      >
                        {dept}: keine Adresse
                      </span>
                    ),
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {/*
                To the project that was just created, not to all 1,298.
                The Projekte page seeds its search from `?q=`, so this lands on
                the record the user has been filling in for five steps.
              */}
              <Button
                onClick={() =>
                  setLocation(
                    draft.header.projektnummer
                      ? `/projects?q=${encodeURIComponent(draft.header.projektnummer)}`
                      : "/projects",
                  )
                }
                className="bg-primary text-white hover:bg-primary/90"
              >
                Projekt öffnen
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Weitere Anmeldung
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Projektanmeldung</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fachspezialistenprüfung RB Mitte — ersetzt die Excel-Checkliste
          </p>
        </div>
        <fieldset className="flex items-center gap-1 rounded-lg border border-border p-1">
          <legend className="sr-only">Modus</legend>
          {CHECKLIST_MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={draft.mode === m}
              onClick={() => draft.setMode(m)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                draft.mode === m
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {m}
            </button>
          ))}
        </fieldset>
      </header>

      {/* Stepper */}
      <nav aria-label="Fortschritt">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((s) => {
            const active = s.n === step;
            const done = s.n < step && stepIsComplete(s.n);
            const invalid = s.n < step && !stepIsComplete(s.n);
            return (
              <li key={s.n} className="flex-1 min-w-[150px]">
                <button
                  type="button"
                  onClick={() => goTo(s.n)}
                  aria-current={active ? "step" : undefined}
                  // An explicit name: the visible content concatenates to
                  // "2Checkliste19 Fragen" with no separators, which is what a
                  // screen reader announced.
                  aria-label={`Schritt ${s.n}: ${s.title}${
                    s.subtitle ? ` – ${s.subtitle}` : ` – ${visibleQuestions(draft.mode).length} Fragen`
                  }`}
                  className={`w-full rounded-lg border-2 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                    active
                      ? "border-primary bg-primary/5"
                      : invalid
                        ? "border-primary/40 bg-background hover:bg-muted/50"
                        : "border-border bg-background hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${
                        done
                          ? "bg-emerald-600 text-white"
                          : active
                            ? "bg-primary text-white"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {done ? <Check className="h-3 w-3" aria-hidden="true" /> : s.n}
                    </span>
                    <span className="text-xs font-bold leading-none">{s.title}</span>
                  </div>
                  <div className="mt-1 pl-7 text-2xs leading-none text-muted-foreground">
                    {/* The Checkliste subtitle is derived, because the count
                        depends on the mode: 19 questions in Projektanmeldung,
                        18 in Projektkonfiguration. */}
                    {s.subtitle ?? `${visibleQuestions(draft.mode).length} Fragen`}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <Card>
        <CardContent className="p-6">
          {step === 1 && <Step1Projekt draft={draft} />}
          {step === 2 && <Step2Checkliste draft={draft} />}
          {step === 3 && <Step3Pruefungen draft={draft} />}
          {step === 4 && <Step4Termin draft={draft} />}
          {step === 5 && <Step5Bestaetigung draft={draft} />}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button
          variant="outline"
          onClick={() => goTo(step - 1)}
          disabled={step === 1}
          className="text-xs"
        >
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Zurück
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          {/* reserved height so the row does not jump when the hint appears */}
          <span className="min-h-[16px] text-2xs font-bold text-primary-strong">
            {step < 5 && issuesForStep.length > 0
              ? `${issuesForStep.length} ${issuesForStep.length === 1 ? "Angabe fehlt" : "Angaben fehlen"}`
              : ""}
          </span>
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            disabled={draft.saving}
            className="text-xs"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Als Entwurf speichern
          </Button>
          {/* Always available, never gated on completeness: an incomplete
              checklist still exports, watermarked ENTWURF. A tool that refuses
              to hand over the document until every field is perfect is a tool
              people work around with screenshots. */}
          <Button
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={pdfState === "working"}
            className="text-xs"
          >
            <FileDown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {pdfState === "working" ? "PDF wird erzeugt …" : "Checkliste als PDF"}
          </Button>
          {step < 5 ? (
            <Button
              onClick={() => goTo(step + 1)}
              className="bg-primary text-xs text-white hover:bg-primary/90"
            >
              Weiter
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!draft.canSubmit || draft.saving}
              className="bg-primary text-xs text-white hover:bg-primary/90 disabled:opacity-50"
            >
              <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Fachspezialistenprüfung anmelden
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
