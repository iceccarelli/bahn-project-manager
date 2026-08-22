import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { ChecklistPdfData } from "./ChecklistDocument";
import { documentFilename } from "@shared/generated-stamp";

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

  // Date AND time in the name, from the same stamp the document prints, so a
  // second export on the same day is a second file rather than an overwrite.
  const filename = documentFilename(
    "Checkliste",
    [data.projektnummer || "Entwurf", data.stationsname],
    data.generatedAt,
  );

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
