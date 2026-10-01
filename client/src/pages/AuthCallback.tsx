import { useEffect, useRef, useState } from "react";
import { OIDC } from "@/realtime/serverApi";
import { browserDeps, completeSignIn } from "@/realtime/oidcClient";
import { Button } from "@/components/ui/button";

/** OIDC redirect URI. Exchanges the code (PKCE), stores the access token for this tab, then does a full load. */
export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false); // StrictMode double-invoke must not spend the single-use flow twice
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!OIDC) { setError("Anmeldung ist nicht konfiguriert."); return; }
    completeSignIn(OIDC, browserDeps(), window.location.search)
      .then(to => window.location.replace(to))
      .catch(e => setError(e instanceof Error ? e.message : "Anmeldung fehlgeschlagen"));
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {error ? (
        <div role="alert" className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">Anmeldung fehlgeschlagen</h1>
          <p className="text-sm text-muted-foreground break-words">{error}</p>
          <Button onClick={() => window.location.replace("/login")}>Zurück zur Anmeldung</Button>
        </div>
      ) : <p role="status" className="text-muted-foreground">Anmeldung wird abgeschlossen …</p>}
    </div>
  );
}
