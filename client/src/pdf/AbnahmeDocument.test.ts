/**
 * What the Abnahmeprotokoll PRINTS. The document is a React element tree; walking it for text proves that the running number
 * and the derived PDF-Code reach the page (or are absent), without rendering a PDF.
 */
import React, { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { templateFor } from "@shared/abnahme/templates";
import { EMPTY_ABNAHME_HEADER } from "@shared/abnahme/types";
import { AbnahmeDocument, type AbnahmePdfData } from "./AbnahmeDocument";

/** every string in the tree; function components are expanded (the document's own Meta cell), library primitives are walked through their children */
function textOf(node: ReactNode, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((c) => textOf(c, out)); return out; }
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (typeof el.type === "function") {
      try { textOf((el.type as (p: unknown) => ReactNode)(el.props), out); return out; } catch { /* a library primitive: its children are the content */ }
    }
    textOf(el.props.children, out);
  }
  return out;
}

// the test config compiles JSX with the classic runtime (the app's Vite build uses the automatic one)
(globalThis as unknown as { React: typeof React }).React = React;

const data = (over: Partial<AbnahmePdfData> = {}): AbnahmePdfData => ({
  template: templateFor("ZIM")!, answers: {}, header: EMPTY_ABNAHME_HEADER,
  projektnummer: "G.TEST0001", station: "Musterstadt", projektleiter: "Pia Projektleitung", pruefer: "Pia Prüfer", pruefDatum: "15.03.2023",
  generatedAt: "2026-10-13T08:00:00.000Z", generatedBy: "Test", ...over,
});
const printed = (d: AbnahmePdfData) => textOf(AbnahmeDocument({ data: d }) as ReactNode).join(" | ");

describe("Abnahmeprotokoll — Prüfbericht reference", () => {
  it("prints the running number and the derived PDF-Code once a report is selected", () => {
    const t = printed(data({ pruefbericht: { nummer: "25.002 (2025)", pdfCode: "A25.002 - Musterstadt" } }));
    expect(t).toContain("Prüfbericht-Nr. | 25.002 (2025)");
    expect(t).toContain("PDF-Code | A25.002 - Musterstadt");
  });

  it("prints no reference for none / unchosen — never an empty or stale one", () => {
    for (const pruefbericht of [null, undefined]) {
      const t = printed(data({ pruefbericht }));
      expect(t).not.toContain("Prüfbericht-Nr.");
      expect(t).not.toContain("PDF-Code");
    }
  });

  it("the rest of the protocol is unchanged by the reference", () => {
    const t = printed(data({ pruefbericht: { nummer: "25.002 (2025)", pdfCode: "X" } }));
    expect(t).toMatch(/Abnahme[ |]+ZIM/);
    expect(t).toContain("G.TEST0001");
    expect(t).toContain("Musterstadt");
  });
});
