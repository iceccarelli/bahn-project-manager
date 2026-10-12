import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

/**
 * A rendered document: the bytes and the name they should be saved under.
 *
 * Every PDF the app makes goes through these two functions, so "show it",
 * "download it" and "print it" are three actions on one value instead of three
 * code paths that each build the document again.
 */
export interface PdfFile {
  blob: Blob;
  filename: string;
}

/**
 * Render a @react-pdf document element to a Blob.
 *
 * @react-pdf/renderer and its layout engine are ~400 kB; they are imported on
 * the click that asks for a PDF, never in a route's entry chunk.
 */
export async function renderPdf(element: ReactElement<DocumentProps>, filename: string): Promise<PdfFile> {
  const { pdf } = await import("@react-pdf/renderer");
  return { blob: await pdf(element).toBlob(), filename };
}

/** Hand a rendered file to the browser as a download. */
export function savePdf({ blob, filename }: PdfFile): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in Safari before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
