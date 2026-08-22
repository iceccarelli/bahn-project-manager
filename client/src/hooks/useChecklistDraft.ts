import { useCallback, useMemo, useState } from "react";
import { AUDIT_ACTIONS } from "@shared/audit-actions";
import { apiClient } from "@/_core/api/client";
import {
  CHECKLIST_QUESTIONS,
  buildDepartmentReviews,
  defaultAnswers,
  notifiedRoles,
  visibleQuestions,
  type ChecklistAnswer,
  type ChecklistAnswers,
  type ChecklistMode,
  type GeneratedReview,
} from "@shared/checklist";
import { ChecklistSubmitSchema, type ProjectChecklist } from "@shared/validation";
import type { Bahnhofsmanagement } from "@shared/bahnhofsmanagement";

/** The header block — Formular rows 6-9. */
export interface ChecklistHeader {
  projektnummer: string;
  projektbezeichnung: string;
  stationsname: string;
  bahnhofsnummer: string;
  streckennummer: string;
  projektstand: string;
  bahnhofsmanagement: Bahnhofsmanagement | "";
  projektleitung: string;
}

const EMPTY_HEADER: ChecklistHeader = {
  projektnummer: "",
  projektbezeichnung: "",
  stationsname: "",
  bahnhofsnummer: "",
  streckennummer: "",
  projektstand: "",
  bahnhofsmanagement: "",
  projektleitung: "",
};

export interface TerminSelection {
  slotId: string;
  datum: string;
  von: string;
  bis: string;
}

export interface StepIssue {
  field: string;
  message: string;
}

/**
 * State machine behind /anmeldung.
 *
 * Everything the wizard decides is derived from `answers` through the pure
 * functions in shared/checklist.ts, so the 14 generated reviews and the
 * Unterschriftenblatt can never disagree with the checklist the user filled in.
 */
export function useChecklistDraft() {
  const [mode, setModeState] = useState<ChecklistMode>("Projektanmeldung");
  const [header, setHeader] = useState<ChecklistHeader>(EMPTY_HEADER);
  const [answers, setAnswers] = useState<ChecklistAnswers>(() =>
    defaultAnswers("Projektanmeldung"),
  );
  const [termin, setTermin] = useState<TerminSelection | null>(null);
  const [checklistId, setChecklistId] = useState<number | null>(null);
  const [syncVersion, setSyncVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Switching mode re-applies that mode's defaults, exactly as
   * Sub Projektanmeldung() / Sub PKonfiguration() do. Answers whose mode default
   * is null are left alone — the workbook does not reset F15 either.
   */
  const setMode = useCallback((next: ChecklistMode) => {
    setModeState(next);
    setAnswers((prev) => {
      const defaults = defaultAnswers(next);
      const merged: ChecklistAnswers = {};
      for (const q of CHECKLIST_QUESTIONS) {
        const def = q.modes[next].default;
        const previous = prev[q.key];
        merged[q.key] =
          def === null
            ? (previous ?? defaults[q.key] ?? { answer: null })
            : (defaults[q.key] ?? { answer: def });
      }
      return merged;
    });
    setHeader((h) => ({
      ...h,
      projektstand: next === "Projektkonfiguration" ? "Projektkonfiguration" : h.projektstand,
    }));
  }, []);

  const setField = useCallback(<K extends keyof ChecklistHeader>(
    field: K,
    value: ChecklistHeader[K],
  ) => {
    setHeader((h) => ({ ...h, [field]: value }));
  }, []);

  const setAnswer = useCallback((key: string, patch: Partial<ChecklistAnswer>) => {
    setAnswers((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { answer: null }), ...patch } }));
  }, []);

  const questions = useMemo(() => visibleQuestions(mode), [mode]);
  const reviews: GeneratedReview[] = useMemo(() => buildDepartmentReviews(answers), [answers]);
  const notified = useMemo(() => notifiedRoles(answers), [answers]);
  const requiredCount = reviews.filter((r) => r.status === "offen").length;

  /** Serialised shape, shared by draft-save and submit. */
  const toPayload = useCallback(
    (status: ProjectChecklist["status"]): ProjectChecklist => ({
      id: checklistId ?? undefined,
      projectId: null,
      mode,
      status,
      projektnummer: header.projektnummer.trim() || null,
      projektbezeichnung: header.projektbezeichnung.trim() || null,
      stationsname: header.stationsname.trim() || null,
      bahnhofsnummer: header.bahnhofsnummer.trim() || null,
      streckennummer: header.streckennummer.trim() || null,
      projektstand: header.projektstand.trim() || null,
      bahnhofsmanagement: header.bahnhofsmanagement || null,
      projektleitung: header.projektleitung.trim() || null,
      pkpLink: (answers.pkpLink?.answer ?? "").trim() || null,
      freischaltungFaa: (answers.freischaltungFaa?.answer as never) ?? null,
      unterschriftenblatt: (answers.unterschriftenblatt?.answer as never) ?? null,
      mitProjektvorstellung: (answers.mitProjektvorstellung?.answer as never) ?? null,
      uebergabeDatum: answers.mitProjektvorstellung?.comment ?? null,
      anmerkungen: answers.anmerkungen?.answer ?? null,
      terminDatum: termin?.datum ?? null,
      terminVon: termin?.von ?? null,
      terminBis: termin?.bis ?? null,
      answers: CHECKLIST_QUESTIONS.map((q) => ({
        questionKey: q.key,
        answer: answers[q.key]?.answer ?? null,
        secondary: answers[q.key]?.secondary ?? null,
        comment: answers[q.key]?.comment ?? null,
      })),
      syncVersion: syncVersion ?? 1,
    }),
    [answers, checklistId, header, mode, syncVersion, termin],
  );

  /**
   * Per-step validation. Step 1 mirrors the two guards in
   * `Makro_mit_Termin.PDF_und_Mail` — including the one the workbook gets wrong:
   * it tests D6 twice instead of D9, so a Projektstand of "Bitte auswählen"
   * currently passes. Here the check is applied to the field it was meant for.
   */
  const stepIssues = useMemo<Record<number, StepIssue[]>>(() => {
    const step1: StepIssue[] = [];
    if (!header.projektnummer.trim())
      step1.push({ field: "projektnummer", message: "Projektnummer ist erforderlich" });
    if (!header.projektbezeichnung.trim())
      step1.push({ field: "projektbezeichnung", message: "Projektbezeichnung ist erforderlich" });
    else if (header.projektbezeichnung.includes("/"))
      step1.push({
        field: "projektbezeichnung",
        message: 'Bitte kein "/" verwenden (Vorgabe des Formulars)',
      });
    if (!header.bahnhofsmanagement)
      step1.push({ field: "bahnhofsmanagement", message: "BM ist erforderlich" });
    if (!header.stationsname.trim())
      step1.push({ field: "stationsname", message: "Stationsname ist erforderlich" });
    if (!header.projektstand.trim())
      step1.push({ field: "projektstand", message: "Projektstand ist erforderlich" });
    if (!header.projektleitung.trim())
      step1.push({ field: "projektleitung", message: "Name der Projektleitung ist erforderlich" });

    const step2: StepIssue[] = [];
    for (const q of questions) {
      const a = answers[q.key];
      const value = (a?.answer ?? "").trim();
      if (q.answerType === "jaNein" && value !== "Ja" && value !== "Nein") {
        step2.push({ field: q.key, message: `Nr. ${q.nr} — bitte Ja oder Nein wählen` });
      }
      if (q.answerType === "freischaltung" && !value) {
        step2.push({ field: q.key, message: `Nr. ${q.nr} — bitte auswählen` });
      }
      if (q.key === "mitProjektvorstellung" && value === "Nein" && !(a?.comment ?? "").trim()) {
        step2.push({
          field: q.key,
          message: 'Bei "Nein": Datum der Übergabe der Unterlagen angeben',
        });
      }
    }

    const step4: StepIssue[] =
      answers.mitProjektvorstellung?.answer === "Nein" || mode === "Projektkonfiguration"
        ? []
        : termin
          ? []
          : [{ field: "termin", message: "Bitte einen freien Termin auswählen" }];

    return { 1: step1, 2: step2, 3: [], 4: step4, 5: [] };
  }, [answers, header, mode, questions, termin]);

  const canSubmit = useMemo(
    () => Object.values(stepIssues).every((issues) => issues.length === 0),
    [stepIssues],
  );

  const saveDraft = useCallback(async () => {
    setSaving(true);
    try {
      const saved = await apiClient.checklists.save(toPayload("draft"));
      setChecklistId(saved.id ?? null);
      setSyncVersion(saved.syncVersion ?? 1);
      return saved;
    } finally {
      setSaving(false);
    }
  }, [toPayload]);

  /**
   * Submit: validate, persist the checklist, then create the project with the
   * 14 reviews the checklist decided. The project is what the rest of the app
   * already understands; the checklist is the record of why those reviews exist.
   */
  const submit = useCallback(async () => {
    const payload = toPayload("submitted");
    const parsed = ChecklistSubmitSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => i.message).join(" · "));
    }

    setSaving(true);
    try {
      const saved = await apiClient.checklists.save({
        ...payload,
        submittedAt: new Date().toISOString(),
      });
      setChecklistId(saved.id ?? null);
      setSyncVersion(saved.syncVersion ?? 1);

      const project = await apiClient.projects.create({
        projektnummer: header.projektnummer.trim(),
        bahnhofsmanagement: header.bahnhofsmanagement || undefined,
        station: header.stationsname.trim(),
        bahnhofsnummer: header.bahnhofsnummer.trim() || undefined,
        streckennummer: header.streckennummer.trim() || undefined,
        projektbeschreibung: header.projektbezeichnung.trim(),
        projektstand: header.projektstand.trim(),
        projektleiter: header.projektleitung.trim(),
        terminProjektvorstellung: termin?.datum,
        kommentar: answers.anmerkungen?.answer ?? undefined,
        projektLink: (answers.pkpLink?.answer ?? "").trim() || undefined,
        reviews: reviews.map((r) => ({
          department: r.department,
          status: r.status,
          prueferName: null,
          pruefDatum: null,
        })),
      });

      // "Wunschtermin", not "Termin": at this point the slot has been chosen
      // but not taken. bookSlot() runs after this returns and can still fail
      // because someone else took the slot in the meantime, and the caller then
      // sends the user back to step 4. Writing "Termin 28.05. 09:00" here put a
      // booking in the audit trail that may never have happened. The booking
      // gets its own entry, from the caller, once bookSlot has actually
      // succeeded.
      await apiClient.audit.record(
        AUDIT_ACTIONS.anmeldungEingereicht,
        `${header.projektnummer.trim()} · ${header.stationsname.trim()} · ${requiredCount} von 14 Gewerken erforderlich${
          termin ? ` · Wunschtermin ${termin.datum} ${termin.von}` : " · ohne Projektvorstellung"
        }`,
      );

      return { checklist: saved, project };
    } finally {
      setSaving(false);
    }
  }, [answers, header, requiredCount, reviews, termin, toPayload]);

  return {
    mode,
    setMode,
    header,
    setField,
    answers,
    setAnswer,
    questions,
    reviews,
    notified,
    requiredCount,
    termin,
    setTermin,
    stepIssues,
    canSubmit,
    saveDraft,
    submit,
    saving,
    checklistId,
  };
}

export type ChecklistDraft = ReturnType<typeof useChecklistDraft>;
