import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, ExternalLink, FileX, Loader2, Printer, RotateCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { savePdf, type PdfFile } from "@/pdf/pdfFile";

type Phase = "idle" | "loading" | "ready" | "error";

/**
 * State of one PDF preview: which document is being built, whether it is ready,
 * and how to build it again. `show` takes the builder so the (heavy, lazily
 * imported) renderer runs only when somebody asks to see a document, and a
 * second request while one is in flight supersedes it instead of racing it.
 */
export function usePdfPreview() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<PdfFile | null>(null);
  const [error, setError] = useState("");
  const builder = useRef<(() => Promise<PdfFile>) | null>(null);
  const ticket = useRef(0);

  const run = useCallback(async () => {
    const build = builder.current;
    if (!build) return;
    const mine = ++ticket.current;
    setPhase("loading");
    setError("");
    try {
      const next = await build();
      if (mine !== ticket.current) return;
      setFile(next);
      setPhase("ready");
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
      setPhase("error");
    }
  }, []);

  const show = useCallback(
    (build: () => Promise<PdfFile>) => {
      builder.current = build;
      setFile(null);
      setOpen(true);
      void run();
    },
    [run],
  );

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      ticket.current++; // a build still running when the dialog closes must not reopen anything
      setPhase("idle");
      setFile(null);
    }
  }, []);

  return { open, phase, file, error, show, retry: run, onOpenChange };
}

/**
 * Shows a generated PDF in the page, with the three things a reader does next:
 * save it, open it in its own tab, print it. The header buttons are the same
 * height and spacing as the project dialog's action row (h-9, gap-1.5), and
 * they stay enabled-or-disabled together so the row never changes shape.
 *
 * Browsers that cannot embed a PDF (phones, locked-down kiosk builds) get the
 * same buttons and a sentence saying why the preview is empty — the document is
 * still one tap away.
 */
export function PdfPreviewDialog({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: ReturnType<typeof usePdfPreview>;
}) {
  const { open, phase, file, error, retry, onOpenChange } = state;
  const frame = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const embeddable = useMemo(() => typeof navigator === "undefined" || navigator.pdfViewerEnabled !== false, []);
  const ready = phase === "ready" && file !== null && url !== null;

  const print = () => {
    try {
      frame.current?.contentWindow?.focus();
      frame.current?.contentWindow?.print();
    } catch {
      // Cross-origin or blocked frame: the PDF in its own tab prints with the browser's own viewer.
      if (url) window.open(url, "_blank", "noopener");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-5xl">
        <DialogHeader className="space-y-3 border-b p-5 pr-12 text-left">
          <div>
            <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
            <DialogDescription className="mt-1 text-sm">{description}</DialogDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-9 gap-1.5" disabled={!ready} onClick={() => file && savePdf(file)}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Herunterladen
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 gap-1.5" aria-disabled={!ready}>
              <a
                href={url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => !ready && e.preventDefault()}
                className={ready ? "" : "pointer-events-none opacity-50"}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                In neuem Tab
              </a>
            </Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!ready || !embeddable} onClick={print}>
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              Drucken
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 bg-muted/40 p-3" data-testid="pdf-preview-body">
          {phase === "loading" && (
            <output className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary-strong" aria-hidden="true" />
              <span className="text-sm font-medium">PDF wird erzeugt …</span>
            </output>
          )}
          {phase === "error" && (
            <div className="flex h-full items-center justify-center p-4">
              <Alert variant="destructive" role="alert" className="max-w-lg">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>PDF konnte nicht erzeugt werden</AlertTitle>
                <AlertDescription>
                  <p>{error}</p>
                  <Button variant="outline" size="sm" className="mt-3 h-9 gap-1.5" onClick={() => void retry()}>
                    <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Erneut versuchen
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}
          {ready && embeddable && (
            <iframe ref={frame} src={url ?? undefined} title={title} className="h-full w-full rounded-lg border bg-background" />
          )}
          {ready && !embeddable && (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileX aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Dieser Browser zeigt PDFs nicht eingebettet an</EmptyTitle>
                <EmptyDescription>Das Dokument ist fertig — „Herunterladen“ oder „In neuem Tab“ öffnet es.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
