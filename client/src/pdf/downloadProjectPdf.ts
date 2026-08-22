import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { ProjectPdfData } from "./ProjectDocument";
import { documentFilename } from "@shared/generated-stamp";

/**
 * Build the Projektblatt and hand it to the browser as a download.
 *
 * Same dynamic-import discipline as the Checkliste export: @react-pdf and its
 * layout engine are ~400 kB, and they must not land in the entry chunk that
 * every visitor downloads just because a dialog can print.
 */
export async function downloadProjectPdf(data: ProjectPdfData): Promise<string> {
  const [{ pdf }, { ProjectDocument }, React] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./ProjectDocument"),
    import("react"),
  ]);

  const element = React.createElement(ProjectDocument, { data }) as ReactElement<DocumentProps>;
  const blob = await pdf(element).toBlob();

  const filename = documentFilename(
    "Projektblatt",
    [data.projektnummer, data.station],
    data.generatedAt,
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in Safari before it has
  // read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}
