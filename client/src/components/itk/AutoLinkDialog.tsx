import { AlertTriangle, CheckCircle2, Link2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAutoLink } from "@/hooks/useProjectLinks";
import { UNMATCHED_TEXT, type UnmatchedReason } from "@shared/itk/project-link";
import type { AutoLinkResult } from "@shared/itk/pruefbericht-contract";

const n = (x: number) => x.toLocaleString("de-DE");

/**
 * Admin: link every unlinked Prüfbericht whose Projektnummer AND Bahnhof identify exactly one project. Opens with a dry
 * run (nothing is written) that says how many reports would be linked and why the others would not; only the button
 * writes. Ambiguous and unmatched reports stay as they are, to be decided one by one.
 */
export function AutoLinkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const run = useAutoLink();
  const [preview, setPreview] = useState<AutoLinkResult | null>(null);
  const [done, setDone] = useState<AutoLinkResult | null>(null);
  const started = useRef(false);

  // `mutate` and `reset` are stable; `run` itself is a new object on every render and must not be an effect dependency
  const { mutate, reset } = run;
  useEffect(() => {
    if (!open) { started.current = false; setPreview(null); setDone(null); reset(); return; }
    if (started.current) return;
    started.current = true;
    mutate({ dryRun: true }, { onSuccess: setPreview });
  }, [open, mutate, reset]);

  const result = done ?? preview;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-lg" data-testid="autolink-dialog">
        <DialogHeader className="text-left">
          <DialogTitle>Prüfberichte automatisch zuordnen</DialogTitle>
          <DialogDescription>Nur wenn Projektnummer und Bahnhof zu genau einem Projekt passen. Alles andere bleibt offen.</DialogDescription>
        </DialogHeader>
        {run.isPending && !result && <output className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Wird geprüft …</output>}
        {run.isError && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden /><AlertTitle>Das ging schief</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              Bitte erneut versuchen.
              <Button size="sm" variant="outline" onClick={() => (preview ? run.mutate({ dryRun: false }, { onSuccess: setDone }) : run.mutate({ dryRun: true }, { onSuccess: setPreview }))} data-testid="autolink-retry">Erneut versuchen</Button>
            </AlertDescription>
          </Alert>
        )}
        {result && (
          <div className="space-y-3 text-sm" data-testid="autolink-result">
            {done ? (
              <Alert role="status"><CheckCircle2 aria-hidden /><AlertTitle>{n(done.linked)} Prüfberichte zugeordnet</AlertTitle><AlertDescription>Jede Zuordnung steht in der Änderungshistorie.</AlertDescription></Alert>
            ) : (
              <p><strong>{n(result.linked)}</strong> von {n(result.examined)} nicht zugeordneten Prüfberichten würden zugeordnet.</p>
            )}
            <ul className="space-y-1 text-muted-foreground">
              <li>{n(result.ambiguous.count)} mit mehreren passenden Projekten — einzeln entscheiden</li>
              {Object.entries(result.unmatched).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                <li key={reason}>{n(count)} × {UNMATCHED_TEXT[reason as UnmatchedReason] ?? reason}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{done ? "Schließen" : "Abbrechen"}</Button>
          {!done && (
            <Button className="gap-2" disabled={!preview || preview.linked === 0 || run.isPending} onClick={() => run.mutate({ dryRun: false }, { onSuccess: setDone })} data-testid="autolink-apply">
              <Link2 className="h-4 w-4" aria-hidden /> Jetzt zuordnen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
