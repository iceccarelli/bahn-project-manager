import type { ConflictInfo } from "@shared/project-contract";
import { fieldLabel, relativeTime } from "./RecentChangeLine";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/**
 * Shows the server value, the local value and WHY it conflicted.
 * Policy: "Meine Änderung erneut senden" is offered directly when the other
 * change touched different fields; when the same field changed, the label makes
 * the overwrite explicit. The server never merges silently.
 */
export default function ConflictDialog({
  conflict, onTakeServer, onRebase,
}: { conflict: ConflictInfo | null; onTakeServer(): void; onRebase(): void }) {
  return (
    <AlertDialog open={!!conflict}>
      <AlertDialogContent>
        {conflict && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Konflikt: Das Projekt wurde zwischenzeitlich geändert</AlertDialogTitle>
              <AlertDialogDescription>
                {conflict.lastChange
                  ? `${conflict.lastChange.actorName ?? "Jemand"} hat es ${relativeTime(conflict.lastChange.at)} geändert (Version ${conflict.expectedVersion} → ${conflict.currentVersion}).`
                  : `Version ${conflict.expectedVersion} → ${conflict.currentVersion}.`}{" "}
                {conflict.disjoint
                  ? "Ihre Änderung betrifft andere Felder und kann auf den aktuellen Stand angewendet werden."
                  : "Dasselbe Feld wurde geändert. Sie entscheiden, welcher Wert gilt."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <table className="w-full text-sm" aria-label="Konfliktdetails" data-testid="conflict-diff">
              <thead><tr className="text-left text-muted-foreground"><th>Feld</th><th>Ihre Ausgangsbasis</th><th>Aktuell (Server)</th><th>Ihre Änderung</th><th><span className="sr-only">Status</span></th></tr></thead>
              <tbody>
                {Object.keys(conflict.localValues).map(f => {
                  const clash = conflict.conflictingFields.includes(f);
                  return (
                    <tr key={f} className={clash ? "bg-red-50 font-semibold dark:bg-red-950/30" : ""} data-conflict={clash ? "true" : "false"}>
                      <td>{fieldLabel(f)}</td>
                      <td>{conflict.changedSince[f] ? (conflict.changedSince[f]!.from ?? "—") : (conflict.serverValues[f] ?? "—")}</td>
                      <td>{conflict.serverValues[f] ?? "—"}</td>
                      <td>{conflict.localValues[f] ?? "—"}</td>
                      <td className={clash ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}>{clash ? "Konflikt" : "unverändert"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={onTakeServer}>Serverwert behalten</AlertDialogCancel>
              <AlertDialogAction onClick={onRebase}>
                {conflict.disjoint ? "Meine Änderung anwenden" : "Meinen Wert übernehmen (überschreibt)"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
