import { useConnectionStatus } from "./RealtimeProvider";
import type { ConnectionStatus } from "./connection";

/** Pure so it can be unit-tested and reused (e.g. in the footer). */
export function describeConnection(s: Pick<ConnectionStatus, "state" | "lastSyncedChanges">): { dot: string; text: string } {
  switch (s.state) {
    case "connected":
      return s.lastSyncedChanges
        ? { dot: "bg-emerald-500", text: `Wiederverbunden · ${s.lastSyncedChanges} ${s.lastSyncedChanges === 1 ? "Projekt" : "Projekte"} aktualisiert` }
        : { dot: "bg-emerald-500", text: "Live" };
    case "connecting": return { dot: "bg-amber-400", text: "Verbinde …" };
    case "degraded": return { dot: "bg-amber-500", text: "Verbindung instabil" };
    case "reconnecting": return { dot: "bg-amber-500", text: "Verbindung wird wiederhergestellt …" };
    case "resynchronizing": return { dot: "bg-sky-500", text: "Synchronisiere …" };
    case "offline": return { dot: "bg-red-500", text: "Offline" };
  }
}

export default function ConnectionBadge() {
  const s = useConnectionStatus();
  const { dot, text } = describeConnection(s);
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="connection-badge" data-state={s.state}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
