import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { QueryClientProvider } from "@/_core/query/QueryProvider";
import AuthGate from "@/components/AuthGate";
import DashboardLayout from "@/components/DashboardLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import BvbEea from "@/pages/BvbEea";
import PsvItk from "@/pages/PsvItk";
import AuditLogPage from "@/pages/AuditLog";

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
                    <Switch>
                      <Route path="/" component={Dashboard} />
                      <Route path="/projects" component={Projects} />
                      <Route path="/bvb-eea" component={BvbEea} />
                      <Route path="/psv-itk" component={PsvItk} />
                      <Route path="/audit" component={AuditLogPage} />
                      <Route component={NotFound} />
                    </Switch>
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
