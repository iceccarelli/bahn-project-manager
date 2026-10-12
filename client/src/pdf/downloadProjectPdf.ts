import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { ProjectPdfData } from "./ProjectDocument";
import { renderPdf, savePdf, type PdfFile } from "./pdfFile";
import { documentFilename } from "@shared/generated-stamp";

/**
 * Build the Projektblatt as a file (not yet saved), so the caller can show it
 * in the preview dialog or download it.
 *
 * Same dynamic-import discipline as the Checkliste export: @react-pdf and its
 * layout engine are ~400 kB, and they must not land in the entry chunk that
 * every visitor downloads just because a dialog can print.
 */
export async function renderProjectPdf(data: ProjectPdfData): Promise<PdfFile> {
  const [{ ProjectDocument }, React] = await Promise.all([import("./ProjectDocument"), import("react")]);
  const element = React.createElement(ProjectDocument, { data }) as ReactElement<DocumentProps>;
  const filename = documentFilename("Projektblatt", [data.projektnummer, data.station], data.generatedAt);
  return renderPdf(element, filename);
}

/** Build the Projektblatt and hand it to the browser as a download. */
export async function downloadProjectPdf(data: ProjectPdfData): Promise<string> {
  const file = await renderProjectPdf(data);
  savePdf(file);
  return file.filename;
}
