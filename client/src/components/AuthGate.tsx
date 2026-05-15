import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import Login from "@/pages/Login";
import DashboardLayout from "./DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, loading } = useAuth();
  const [location, navigate] = useLocation();

  // Redirect logic based on auth state
  useEffect(() => {
    if (loading) return; // Don't redirect while loading

    if (!isAuthenticated && location !== "/login") {
      navigate("/login", { replace: true });
    } else if (isAuthenticated && location === "/login") {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, location, navigate, loading]);

  // Show loading state while checking auth
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

  // Render login page if not authenticated
  if (!isAuthenticated) {
    return <Login />;
  }

  // Render dashboard with children if authenticated
  return (
    <DashboardLayout>
      {children}
    </DashboardLayout>
  );
}
