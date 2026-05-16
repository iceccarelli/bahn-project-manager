import { Card, CardContent } from "@/components/ui/card";
import { History } from "lucide-react";

export default function AuditLogPage() {
  return (
    <div className="space-y-8 p-6 bg-background min-h-screen">
      {/* HEADER SECTION */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Änderungshistorie</h1>
          <p className="text-muted-foreground mt-2">
            Protokoll aller Änderungen an Projekten und Prüfungen
          </p>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <Card className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <CardContent className="py-24">
          <div className="flex flex-col items-center justify-center text-center space-y-6">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
              <History className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold">Änderungshistorie</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
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
