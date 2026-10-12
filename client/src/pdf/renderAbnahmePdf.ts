import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { AbnahmePdfData } from "./AbnahmeDocument";
import { renderPdf, type PdfFile } from "./pdfFile";
import { documentFilename } from "@shared/generated-stamp";

/** Build the Abnahmeprotokoll as a file; the caller decides whether to show, save or print it. */
export async function renderAbnahmePdf(data: AbnahmePdfData): Promise<PdfFile> {
  const [{ AbnahmeDocument }, React] = await Promise.all([import("./AbnahmeDocument"), import("react")]);
  const element = React.createElement(AbnahmeDocument, { data }) as ReactElement<DocumentProps>;
  const filename = documentFilename(
    "Abnahme",
    [data.template.technik, data.projektnummer || "frei", data.station],
    data.generatedAt,
  );
  return renderPdf(element, filename);
}
