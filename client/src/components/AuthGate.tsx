import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { useEffect, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      setLocation("/login");
    }
  }, [user, loading, setLocation]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-lg font-medium text-muted-foreground">Verbindung wird hergestellt...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
