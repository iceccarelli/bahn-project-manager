import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAccessPending, useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading, logout } = useAuth();
  const access = useAccessPending();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated && location !== "/login") {
      navigate("/login", { replace: true });
    } else if (isAuthenticated && location === "/login") {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, location, navigate, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-4 w-full max-w-md px-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated && location === "/login") {
    return <>{children}</>;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (access.pending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
        <div role="status" data-testid="access-pending" className="max-w-md space-y-4 rounded-xl bg-background p-8 text-center shadow-xl">
          <h1 className="text-xl font-semibold">Angemeldet — noch keine Freigabe</h1>
          <p className="text-sm text-muted-foreground">
            {access.who ? `${access.who}, ` : ""}Ihre Anmeldung hat funktioniert, für Ihr Konto ist aber noch kein Bahnhofsmanagement
            freigegeben. Bitte den Administrator, Ihnen in der Anwendung in Microsoft Entra eine Rolle und Arbeitsbereiche zuzuweisen.
            Danach genügt eine erneute Anmeldung.
          </p>
          <Button variant="outline" onClick={logout}>Abmelden</Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
