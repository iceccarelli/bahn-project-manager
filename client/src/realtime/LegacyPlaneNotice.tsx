import { SERVER_MODE } from "./serverApi";

/**
 * Honest labelling of the DEMO artifact. The server artifact has no browser-local plane (every page reads the server),
 * so it renders nothing — and, because SERVER_MODE is a build-time constant, this string is not in its bundle
 * (scripts/assert-build-target.mjs fails CI if it is).
 */
export default function LegacyPlaneNotice() {
  if (SERVER_MODE) return null;
  return (
    <p role="note" data-testid="preview-mode-notice" className="border-b border-sky-300 bg-sky-50 px-4 py-1.5 text-xs text-sky-900">
      Demo-Vorschau: Daten liegen nur in diesem Browser. Kein Server, keine Mehrbenutzer-Synchronisation, keine echte Anmeldung.
    </p>
  );
}
