import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AbnahmeRecordSchema, pruneAnswers, type AbnahmeRecord } from "@shared/abnahme/persistence";
import { reduce, type AbnahmeState as State } from "@shared/abnahme/state";
import {
  EMPTY_ABNAHME_HEADER,
  type AbnahmeAnswer,
  type AbnahmeHeader,
  type ChecklistTemplate,
} from "@shared/abnahme/types";

/**
 * The state of one Abnahme (one Technik, optionally for one project).
 *
 * First increment: client-only. Answers live in a reducer and are mirrored to
 * sessionStorage as an `AbnahmeRecord` — byte for byte the shape a later
 * `abnahme_records` row will hold (shared/abnahme/persistence.ts), so moving to
 * the server replaces `loadRecord`/`saveRecord` and nothing else. sessionStorage
 * and not localStorage on purpose: a half-filled Abnahme of a real project must
 * not outlive the tab on a shared Dienst-PC.
 *
 * Storage may be blocked, full or hold bytes from another version. Every access
 * is guarded, a record that fails validation is ignored, and the hook reports
 * `persistence: "unavailable"` so the page can say the work is not being kept,
 * rather than pretending it is.
 */

const STORAGE_PREFIX = "abnahme:v1";

export function storageKey(technik: string, projectId: number | null): string {
  return `${STORAGE_PREFIX}:${technik}:${projectId ?? "frei"}`;
}

function itemIds(template: ChecklistTemplate): Set<string> {
  return new Set(template.sections.flatMap((s) => s.items.map((i) => i.id)));
}

function loadRecord(key: string, template: ChecklistTemplate, projectId: number | null): State {
  const empty: State = { answers: {}, header: EMPTY_ABNAHME_HEADER };
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return empty;
    const parsed = AbnahmeRecordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return empty;
    const rec = parsed.data;
    if (rec.technik !== template.technik || rec.projectId !== projectId) return empty;
    return { answers: pruneAnswers(rec.answers, itemIds(template)), header: rec.header };
  } catch {
    return empty;
  }
}

function saveRecord(key: string, template: ChecklistTemplate, projectId: number | null, state: State): boolean {
  const record: AbnahmeRecord = {
    projectId,
    technik: template.technik,
    templateVersion: template.version,
    header: state.header,
    answers: { ...state.answers },
  };
  try {
    window.sessionStorage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export type PersistenceStatus = "ok" | "unavailable";

export function useAbnahmeSession(template: ChecklistTemplate, projectId: number | null) {
  const key = storageKey(template.technik, projectId);
  const [state, dispatch] = useReducer(reduce, undefined, () => loadRecord(key, template, projectId));
  const [persistence, setPersistence] = useState<PersistenceStatus>("ok");
  const first = useRef(true);

  // The first run only restores; writing back what was just read would turn a
  // blocked-storage read failure into a spurious "unavailable" before any edit.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPersistence(saveRecord(key, template, projectId, state) ? "ok" : "unavailable");
  }, [key, template, projectId, state]);

  const setStatus = useCallback(
    (itemId: string, selected: AbnahmeAnswer) => dispatch({ type: "status", itemId, selected }),
    [],
  );
  const setMangel = useCallback((itemId: string, mangel: string) => dispatch({ type: "mangel", itemId, mangel }), []);
  const setHeaderField = useCallback(
    (field: keyof AbnahmeHeader, value: string) => dispatch({ type: "header", field, value }),
    [],
  );
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return useMemo(
    () => ({ answers: state.answers, header: state.header, persistence, setStatus, setMangel, setHeaderField, reset }),
    [state, persistence, setStatus, setMangel, setHeaderField, reset],
  );
}
