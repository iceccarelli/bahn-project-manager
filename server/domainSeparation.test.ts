/**
 * The two workbooks live in their own domains. The Übersichtsliste (projects + department reviews) and the Prüfbericht
 * register (itk_pruefberichte) meet in exactly one place — the project ↔ Prüfbericht link — and nowhere else. This test
 * fails when a register module starts importing Prüfbericht concepts, when a Prüfbericht module starts importing register
 * concepts, or when the link bridge grows beyond its two sanctioned files.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = (dir: string) => walk(dir).filter(f => /\.(ts|tsx)$/.test(f));
const importsOf = (f: string) => [...fs.readFileSync(path.join(root, f), "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]!);

const BRIDGE_FILES = new Set(["shared/link-fixtures.ts", "shared/link-fixtures.test.ts"]);
const REGISTER = [...files("shared/register"), "server/domain/registerImportService.ts", "client/src/components/projects/RegisterImportDialog.tsx"];
const PRUEFBERICHT = [...files("shared/itk"), "server/infra/pruefberichtStore.ts", "client/src/components/itk/PruefberichtImportDialog.tsx", "client/src/components/itk/PdfCodesView.tsx", "client/src/components/itk/TechnikView.tsx", "client/src/components/itk/JahresansichtView.tsx", ...files("client/src/components/itk")];

describe("domain separation: register import ⟂ Prüfbericht import", () => {
  it("register modules import nothing from the Prüfbericht domain", () => {
    for (const f of REGISTER) for (const i of importsOf(f)) expect(/\/itk\/|components\/itk|pruefbericht/i.test(i), `${f} imports ${i}`).toBe(false);
  });

  it("Prüfbericht modules import nothing from the register domain", () => {
    for (const f of PRUEFBERICHT) for (const i of importsOf(f)) expect(/\/register\/|components\/projects\/Register|registerImport/i.test(i), `${f} imports ${i}`).toBe(false);
  });

  it("the generic cell helpers are shared through neutral modules, not through either domain", () => {
    for (const f of ["shared/workbook-cells.ts", "shared/workbook.ts"]) for (const i of importsOf(f)) expect(/itk|register/.test(i), `${f} imports ${i}`).toBe(false);
  });

  it("the only bridges are the link rule, the link service/store reads and the screens that show a link", () => {
    const BRIDGE = new Set([
      "shared/itk/project-link.ts",                       // pure evidence rule; knows only project-identity
      "shared/link-fixtures.ts",                          // the one fixture pair that meets (tests of the link only)
      "shared/link-fixtures.test.ts",
      "server/domain/pruefberichtLinkService.ts",         // the audited write path of the link
      "shared/abnahme/pruefbericht.ts",                   // Abnahme reads a project's linked reports
      "client/src/components/itk/ProjectPruefberichte.tsx", // project detail section
      "client/src/components/abnahme/AbnahmeReport.tsx",
    ]);
    for (const f of BRIDGE) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    // neither register module may reach into the link, and the link may only use the neutral identity helpers
    for (const i of importsOf("shared/itk/project-link.ts")) expect(i === "../project-identity", `project-link imports ${i}`).toBe(true);
    for (const f of REGISTER) for (const i of importsOf(f)) expect(/project-link|LinkService|useProjectLinks/.test(i), `${f} imports ${i}`).toBe(false);
  });
});
