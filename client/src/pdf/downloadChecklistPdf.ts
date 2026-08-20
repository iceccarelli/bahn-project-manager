import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { ChecklistPdfData } from "./ChecklistDocument";

/**
 * Build the Checkliste PDF and hand it to the browser as a download.
 *
 * @react-pdf/renderer and its font/layout engine are ~400 kB. They are imported
 * dynamically so the cost lands only on the click that asks for a PDF, not on
 * the entry chunk that every visitor downloads. The route-level code splitting
 * added earlier would otherwise have been undone by one import.
 */
export async function downloadChecklistPdf(data: ChecklistPdfData): Promise<string> {
  const [{ pdf }, { ChecklistDocument }, React] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./ChecklistDocument"),
    import("react"),
  ]);

  // The cast narrows to what pdf() wants: ChecklistDocument returns a
  // <Document>, but createElement types it as a generic element.
  const element = React.createElement(ChecklistDocument, { data }) as ReactElement<DocumentProps>;
  const blob = await pdf(element).toBlob();

  const safe = (s: string) => s.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
  const parts = [
    "Checkliste",
    safe(data.projektnummer) || "Entwurf",
    safe(data.stationsname),
    data.generatedAt.slice(0, 10),
  ].filter(Boolean);
  const filename = `${parts.join("_")}.pdf`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: revoking synchronously can cancel the download in
  // Safari before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}
