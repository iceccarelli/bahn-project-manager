import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Step1Projekt } from "@/components/anmeldung/Step1Projekt";
import { Step2Checkliste } from "@/components/anmeldung/Step2Checkliste";
import { Step3Pruefungen } from "@/components/anmeldung/Step3Pruefungen";
import { Step4Termin } from "@/components/anmeldung/Step4Termin";
import { Step5Bestaetigung } from "@/components/anmeldung/Step5Bestaetigung";
import { useChecklistDraft } from "@/hooks/useChecklistDraft";
import { bookSlot } from "@/hooks/useSchedule";
import { CHECKLIST_MODES } from "@shared/checklist";
import { Check, ChevronLeft, ChevronRight, Save } from "lucide-react";

const STEPS = [
  { n: 1, title: "Projekt", subtitle: "Kopfdaten & Station" },
  { n: 2, title: "Checkliste", subtitle: "22 Fragen" },
  { n: 3, title: "Prüfungen", subtitle: "14 Gewerke" },
  { n: 4, title: "Termin", subtitle: "Fachspezialistenprüfung" },
  { n: 5, title: "Bestätigung", subtitle: "Anmelden" },
] as const;

export default function Anmeldung() {
  const [, setLocation] = useLocation();
  const draft = useChecklistDraft();
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState<{ projectId: number } | null>(null);

  const issuesForStep = draft.stepIssues[step] ?? [];
  const stepIsComplete = (n: number) => (draft.stepIssues[n]?.length ?? 0) === 0;

  const goTo = (n: number) => setStep(Math.min(5, Math.max(1, n)));

  const handleSaveDraft = async () => {
    try {
      const saved = await draft.saveDraft();
      toast.success(`Entwurf gespeichert (Nr. ${saved.id})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Entwurf konnte nicht gespeichert werden");
    }
  };

  const handleSubmit = async () => {
    try {
      const { project } = await draft.submit();
      if (draft.termin) {
        const info = `${draft.header.projektleitung} - ${draft.header.stationsname} - ${draft.header.projektstand}`;
        if (!bookSlot(draft.termin.slotId, String(project.id), info)) {
          toast.warning("Der Termin war bereits vergeben — bitte einen anderen wählen.");
          goTo(4);
          return;
        }
      }
      setSubmitted({ projectId: project.id });
      toast.success(
        `Fachspezialistenprüfung angemeldet — Projekt ${project.projektnummer ?? project.id} angelegt`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen");
    }
  };

  if (submitted) {
    return (
      <div className="space-y-6 p-6">
        <Card className="mx-auto max-w-xl">
          <CardContent className="space-y-4 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary">
              <Check className="h-8 w-8 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-black tracking-tight">Anmeldung abgeschlossen</h1>
            <p className="text-sm text-muted-foreground">
              Projekt <strong className="text-foreground">{draft.header.projektnummer}</strong> ist
              angelegt, {draft.requiredCount} von 14 Fachprüfungen stehen offen
              {draft.termin ? ` und der Termin am ${draft.termin.datum} ist gebucht` : ""}.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button
                onClick={() => setLocation("/projects")}
                className="bg-primary text-white hover:bg-primary/90"
              >
                Zur Projektübersicht
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
          <h1 className="text-3xl font-bold tracking-tight">Projektanmeldung</h1>
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
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-black ${
                        done
                          ? "bg-emerald-600 text-white"
                          : active
                            ? "bg-primary text-white"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {done ? <Check className="h-3 w-3" aria-hidden="true" /> : s.n}
                    </span>
                    <span className="text-xs font-black leading-none">{s.title}</span>
                  </div>
                  <div className="mt-1 pl-7 text-2xs leading-none text-muted-foreground">
                    {s.subtitle}
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
