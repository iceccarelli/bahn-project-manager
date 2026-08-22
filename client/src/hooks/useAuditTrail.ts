import { useCallback } from "react";
import { useRecordAudit } from "@/hooks/useDataQuery";
import { AUDIT_ACTIONS, type AuditAction } from "@shared/audit-actions";
import { generatedLabel } from "@shared/generated-stamp";

/**
 * Recording the things that happen outside a data mutation.
 *
 * The trail already captured every field edit, because those go through
 * applyEdit/applyReviewEdit and each of those calls recordAudit. What it did
 * not capture was everything else a user does that leaves the app: exporting a
 * PDF, exporting the CSV, handing a prefilled message to Outlook or Teams. From
 * the log's point of view those users did nothing all afternoon.
 *
 * All four write through the same query cache the Änderungshistorie page and
 * the header bell read, so an entry appears in both the moment it is made.
 */
export function useAuditTrail() {
  const record = useRecordAudit();

  /** A generated document. `what` names it, `filename` proves which file. */
  const recordDocument = useCallback(
    (what: string, filename: string, subjectLine?: string) => {
      record.mutate({
        action: filename.toLowerCase().endsWith(".pdf")
          ? AUDIT_ACTIONS.pdfErzeugt
          : AUDIT_ACTIONS.exportErzeugt,
        // The filename carries the generation stamp already, but the entry
        // repeats it in German so the log reads without decoding a filename.
        details: [what, subjectLine, filename, `Stand ${generatedLabel()}`]
          .filter(Boolean)
          .join(" · "),
      });
    },
    [record],
  );

  /**
   * A prefilled message handed to Outlook or Teams.
   *
   * "vorbereitet", not "gesendet" — see shared/audit-actions.ts. The app hands
   * the message over and never learns whether it was sent.
   */
  const recordMessage = useCallback(
    (channel: "mail" | "teams", recipient: string, subjectLine: string) => {
      record.mutate({
        action:
          channel === "mail" ? AUDIT_ACTIONS.mailGeoeffnet : AUDIT_ACTIONS.teamsGeoeffnet,
        details: [subjectLine, `an ${recipient}`].filter(Boolean).join(" · "),
      });
    },
    [record],
  );

  /**
   * Anything else in the closed vocabulary.
   *
   * Typed to `AuditAction` on purpose: a call site cannot invent a phrase, which
   * is how the log ended up with "Projekt erstellt" and "Projekt angelegt"
   * meaning the same thing.
   */
  const recordEvent = useCallback(
    (action: AuditAction, details: string) => {
      record.mutate({ action, details });
    },
    [record],
  );

  return { recordDocument, recordMessage, recordEvent };
}
