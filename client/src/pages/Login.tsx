import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Train, Shield, User } from "lucide-react";
import { loginDemo } from "@/_core/hooks/useAuth";

const DEMO_USERS = [
  { name: "Admin Demo", email: "admin@bahn.de", role: "admin", password: "admin" },
  { name: "Prüfer Demo", email: "pruefer@bahn.de", role: "user", password: "user" },
];

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const doLogin = (loginEmail: string, loginPassword: string) => {
    setError("");
    setIsLoading(true);
    const success = loginDemo(loginEmail, loginPassword);
    if (success) {
      // Force full page reload to pick up new auth state everywhere
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo") || "/";
      window.location.href = returnTo;
    } else {
      setError("Ungültige Zugangsdaten. Verwenden Sie einen Demo-Account.");
      setIsLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    doLogin(email, password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Train className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-bold">Bahn Project Manager</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Prüfverwaltung für Bahnhofsprojekte
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Anmelden</CardTitle>
            <CardDescription>
              Verwenden Sie Ihre Zugangsdaten oder einen Demo-Account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@bahn.de"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Wird angemeldet..." : "Anmelden"}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Demo-Zugänge</span>
              </div>
            </div>

            <div className="grid gap-2">
              {DEMO_USERS.map((user) => (
                <Button
                  key={user.email}
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => doLogin(user.email, user.password)}
                  disabled={isLoading}
                >
                  {user.role === "admin" ? (
                    <Shield className="h-4 w-4 text-amber-500" />
                  ) : (
                    <User className="h-4 w-4 text-blue-500" />
                  )}
                  <div className="text-left">
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-muted-foreground">{user.email} / {user.password}</div>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Demo-Version &bull; Alle Daten aus der Übersichtsliste.xlsm
        </p>
      </div>
    </div>
  );
}
