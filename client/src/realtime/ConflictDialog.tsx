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
            <table className="w-full text-sm" aria-label="Konfliktdetails">
              <thead><tr className="text-left text-muted-foreground"><th>Feld</th><th>Aktuell (Server)</th><th>Ihre Änderung</th></tr></thead>
              <tbody>
                {Object.keys(conflict.localValues).map(f => (
                  <tr key={f} className={conflict.conflictingFields.includes(f) ? "font-semibold" : ""}>
                    <td>{fieldLabel(f)}</td><td>{conflict.serverValues[f] ?? "—"}</td><td>{conflict.localValues[f] ?? "—"}</td>
                  </tr>
                ))}
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
