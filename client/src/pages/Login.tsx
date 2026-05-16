import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth, loginDemo } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function Login() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, authLoading, setLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 800));

    const success = loginDemo(email, password);
    if (success) {
      setSuccess(true);
      setTimeout(() => setLocation("/"), 500);
    } else {
      setError("Ungültige E-Mail oder Passwort. Bitte versuchen Sie es erneut.");
      setIsLoading(false);
    }
  };

  const handleDemoLogin = async (role: "admin" | "user") => {
    setIsLoading(true);
    setError(null);
    
    const demoEmail = role === "admin" ? "admin@bahn.de" : "pruefer@bahn.de";
    const demoPass = role === "admin" ? "admin" : "user";
    
    setEmail(demoEmail);
    setPassword(demoPass);

    await new Promise(resolve => setTimeout(resolve, 800));
    
    const success = loginDemo(demoEmail, demoPass);
    if (success) {
      setSuccess(true);
      setTimeout(() => setLocation("/"), 500);
    } else {
      setError("Demo-Login fehlgeschlagen.");
      setIsLoading(false);
    }
  };

  if (authLoading) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-16 h-16 bg-[#FF0000] rounded-xl flex items-center justify-center text-white font-bold text-5xl shadow-lg mb-4">
            DB
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Bahn Project Manager</h1>
          <p className="text-muted-foreground">Melden Sie sich an, um fortzufahren</p>
        </div>

        <Card className="border-none shadow-xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl">Anmelden</CardTitle>
            <CardDescription>
              Geben Sie Ihre Zugangsdaten ein oder nutzen Sie einen Demo-Account
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Fehler</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            {success && (
              <Alert className="border-green-500 text-green-600 bg-green-50">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertTitle>Erfolg</AlertTitle>
                <AlertDescription>Anmeldung erfolgreich. Weiterleitung...</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleLogin} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="name@bahn.de" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading || success}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Passwort</Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading || success}
                  required
                />
              </div>
              <Button type="submit" className="w-full bg-[#FF0000] hover:bg-[#CC0000]" disabled={isLoading || success}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Anmelden
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Oder Demo nutzen</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button variant="outline" onClick={() => handleDemoLogin("admin")} disabled={isLoading || success}>
                Admin Demo
              </Button>
              <Button variant="outline" onClick={() => handleDemoLogin("user")} disabled={isLoading || success}>
                Prüfer Demo
              </Button>
            </div>
          </CardContent>
          <CardFooter>
            <p className="text-xs text-center w-full text-muted-foreground">
              Version 1.0.0 | © 2026 Deutsche Bahn AG
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
