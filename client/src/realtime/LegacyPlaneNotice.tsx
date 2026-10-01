import { useLocation } from "wouter";
import { SERVER_MODE } from "./serverApi";

/** Routes whose data path is already the server (everything else still reads the static snapshot). */
const SERVER_ROUTES = ["/projects", "/bvb-eea", "/psv-itk", "/anmeldung"];

/** Honest labelling in server mode for pages not yet migrated to the server data plane. */
export default function LegacyPlaneNotice() {
  const [path] = useLocation();
  if (!SERVER_MODE) {
    // The static (Vercel-style) build has no backend: say so, so it is never mistaken for the production system.
    return (
      <p role="note" data-testid="preview-mode-notice" className="border-b border-sky-300 bg-sky-50 px-4 py-1.5 text-xs text-sky-900">
        Demo-Vorschau: Daten liegen nur in diesem Browser. Kein Server, keine Mehrbenutzer-Synchronisation, keine echte Anmeldung.
      </p>
    );
  }
  if (SERVER_ROUTES.some(r => path.startsWith(r))) return null;
  return (
    <p role="note" data-testid="legacy-plane-notice" className="border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
      Diese Ansicht zeigt noch den lokalen Datenbestand (statischer Stand, nicht live, Änderungen sind hier deaktiviert).
    </p>
  );
}
