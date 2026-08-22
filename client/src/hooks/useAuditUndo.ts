import { useCallback } from "react";
import { toast } from "sonner";
import { useProjectEdits, type AuditLogEntry } from "@/hooks/useDataQuery";

/**
 * Taking back a change inside the grace window.
 *
 * People mis-click. A Prüfer opens the wrong row's status, picks the wrong
 * value, and the record now says an approval was withdrawn. Without a way back
 * they either leave it wrong or fix it by hand and the trail carries two
 * unexplained changes.
 *
 * This writes the old value back through the ordinary mutation, so the undo is
 * itself validated, optimistic, rolled back on refusal — and recorded. It does
 * NOT delete the entry it reverses. An audit trail that can lose rows is not
 * evidence of anything; the pair (change, undo) is the honest record of what
 * happened, and markCorrections is what stops that pair from reading as two
 * separate decisions.
 */
export function useAuditUndo() {
  const { applyEdit, applyReviewEdit } = useProjectEdits();

  return useCallback(
    (entry: AuditLogEntry) => {
      const meta = entry.meta;
      if (!meta || meta.projectId === undefined || !meta.field) {
        toast.error("Diese Änderung trägt keine Angaben, die sich zurücknehmen lassen.");
        return;
      }
      const previous = meta.from ?? "";
      if (meta.department) {
        applyReviewEdit(
          meta.projectId,
          meta.department,
          meta.field as "status" | "prueferName" | "pruefDatum",
          previous,
        );
      } else {
        applyEdit(meta.projectId, meta.field as never, previous);
      }
      const who = [meta.projektnummer, meta.station].filter(Boolean).join(" · ") || `Projekt ${meta.projectId}`;
      toast.success(`Zurückgenommen: ${who} · ${meta.field} wieder „${previous || "leer"}"`);
    },
    [applyEdit, applyReviewEdit],
  );
}
