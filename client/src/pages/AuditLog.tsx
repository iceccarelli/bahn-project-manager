import { Card, CardContent } from "@/components/ui/card";
import { History } from "lucide-react";

export default function AuditLogPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Änderungshistorie</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Protokoll aller Änderungen an Projekten und Prüfungen
        </p>
      </div>

      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center text-center space-y-3">
            <History className="h-12 w-12 text-muted-foreground/50" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Änderungshistorie
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Alle Bearbeitungen in dieser Sitzung werden hier protokolliert.
                In der statischen Demo-Version werden Änderungen lokal im Browser gespeichert.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
