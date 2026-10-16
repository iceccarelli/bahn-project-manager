import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SERVER_MODE, serverApi } from "@/realtime/serverApi";
import type { DepartmentSubscriptionDTO } from "@shared/notification-contract";

export const SUBSCRIPTIONS_KEY = ["server", "subscriptions"] as const;

/**
 * Einstellungen → Benachrichtigungen: which Gewerke the signed-in person follows. What is offered is what the server
 * says the CURRENT grant allows (eligibility); the switch stores an explicit decision that survives sign-ins and imports.
 * Browser-local demo: there is no server, so the page explains itself instead of pretending.
 */
export default function Einstellungen() {
  const { session } = useAuth() as ReturnType<typeof useAuth> & { session?: { role: string; departments: string[]; name: string | null; email: string | null } | null };
  const qc = useQueryClient();
  const subs = useQuery({ queryKey: SUBSCRIPTIONS_KEY, queryFn: () => serverApi.notifications.subscriptions.query() as Promise<DepartmentSubscriptionDTO[]>, enabled: SERVER_MODE, staleTime: 10_000 });
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (department: string, enabled: boolean) => {
    setBusy(department);
    try {
      const next = await serverApi.notifications.setSubscription.mutate({ department, enabled });
      qc.setQueryData(SUBSCRIPTIONS_KEY, next);
      toast.success(enabled ? `${department}: Benachrichtigungen aktiv` : `${department}: keine Benachrichtigungen mehr`);
    } catch (e) {
      const code = (e as { data?: { code?: string } } | null)?.data?.code;
      toast.error(code === "FORBIDDEN" ? `Für ${department} liegt keine Freigabe vor.` : "Die Einstellung konnte nicht gespeichert werden.");
    } finally { setBusy(null); }
  };

  const eligible = (subs.data ?? []).filter((s) => s.eligible);
  const others = (subs.data ?? []).filter((s) => !s.eligible);
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6" data-testid="settings-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Einstellungen</h1>
        <p className="text-sm text-muted-foreground">{session?.name ?? session?.email ?? ""}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5" aria-hidden /> Benachrichtigungen je Gewerk</CardTitle>
          <CardDescription>
            Eine Projektanmeldung, die für ein Gewerk eine Prüfung eröffnet, meldet sich bei den Personen, die dieses Gewerk abonniert haben.
            Angeboten wird, was Ihre Freigabe erlaubt; ein Ausschalten bleibt bestehen, bis Sie es zurücknehmen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!SERVER_MODE && (
            <Alert><AlertTitle>Demo</AlertTitle><AlertDescription>In der Demo gibt es keine Benachrichtigungen je Gewerk — sie entstehen auf dem Server aus echten Projektanmeldungen.</AlertDescription></Alert>
          )}
          {SERVER_MODE && subs.isLoading && <output className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Wird geladen …</output>}
          {SERVER_MODE && subs.isError && <Alert variant="destructive"><AlertTitle>Einstellungen konnten nicht geladen werden</AlertTitle></Alert>}
          {subs.data && eligible.length === 0 && (
            <Alert data-testid="settings-no-departments">
              <AlertTitle>Noch kein Gewerk freigegeben</AlertTitle>
              <AlertDescription>Ihr Konto trägt derzeit keine Gewerke-Freigabe (EEA, ITK, …). Ein Administrator weist sie in Microsoft Entra zu; danach erscheinen die Gewerke hier.</AlertDescription>
            </Alert>
          )}
          {eligible.length > 0 && (
            <ul className="divide-y rounded-xl border" data-testid="subscription-list">
              {eligible.map((s) => (
                <li key={s.department} className="flex items-center justify-between gap-4 px-4 py-3" data-testid={`subscription-${s.department}`}>
                  <div className="min-w-0">
                    <Label htmlFor={`sub-${s.department}`} className="text-sm font-semibold">{s.department}</Label>
                    <p className="text-xs text-muted-foreground">
                      {s.explicit ? (s.explicit.source === "admin" ? "vom Administrator festgelegt" : "von Ihnen festgelegt") : session?.role === "admin" ? "Standard für Administratoren: aus" : "Standard aus Ihrer Freigabe: an"}
                      {s.explicit ? ` · ${new Date(s.explicit.updatedAt).toLocaleDateString("de-DE")}` : ""}
                    </p>
                  </div>
                  <Switch id={`sub-${s.department}`} checked={s.subscribed} disabled={busy === s.department} onCheckedChange={(v) => void toggle(s.department, v)} aria-label={`${s.department} abonnieren`} />
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Ohne Freigabe (nicht abonnierbar): {others.map((s) => <Badge key={s.department} variant="outline" className="mr-1 text-2xs">{s.department}</Badge>)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
