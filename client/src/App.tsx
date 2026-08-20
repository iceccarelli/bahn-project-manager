import { Suspense, lazy } from "react";
import { Route, Switch } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { QueryClientProvider } from "@/_core/query/QueryProvider";
import AuthGate from "@/components/AuthGate";
import DashboardLayout from "@/components/DashboardLayout";
import Login from "@/pages/Login";

/**
 * Route-level code splitting.
 *
 * Everything used to land in one 771 kB entry chunk, so opening the login
 * screen downloaded Recharts, Leaflet and the whole 22-question wizard before
 * anything could render. Each route below is now its own chunk, fetched when
 * it is first visited. `Login` stays eager because it is the first thing an
 * unauthenticated visitor sees and a spinner there would be a regression.
 *
 * `manualChunks` in vite.config.ts already isolates react / recharts / leaflet
 * into shared vendor chunks; these lazy boundaries are what let the browser
 * skip fetching them entirely until a route actually needs them.
 */
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Projects = lazy(() => import("@/pages/Projects"));
const Anmeldung = lazy(() => import("@/pages/Anmeldung"));
const BvbEea = lazy(() => import("@/pages/BvbEea"));
const PsvItk = lazy(() => import("@/pages/PsvItk"));
const AuditLogPage = lazy(() => import("@/pages/AuditLog"));
const NotFound = lazy(() => import("@/pages/NotFound"));

/**
 * Fixed-height placeholder rather than a centred spinner: it occupies the same
 * vertical space the page will, so swapping it for real content causes no
 * layout shift.
 */
function RouteFallback() {
  return (
    <div
      className="min-h-[60vh] w-full animate-pulse rounded-xl bg-muted/40"
      role="status"
      aria-live="polite"
      aria-label="Seite wird geladen"
    />
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
            <Switch>
              <Route path="/login" component={Login} />
              <Route>
                <AuthGate>
                  <DashboardLayout>
                    <Suspense fallback={<RouteFallback />}>
                      <Switch>
                        <Route path="/" component={Dashboard} />
                        <Route path="/anmeldung" component={Anmeldung} />
                        <Route path="/projects" component={Projects} />
                        <Route path="/bvb-eea" component={BvbEea} />
                        <Route path="/psv-itk" component={PsvItk} />
                        <Route path="/audit" component={AuditLogPage} />
                        <Route component={NotFound} />
                      </Switch>
                    </Suspense>
                  </DashboardLayout>
                </AuthGate>
              </Route>
            </Switch>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
