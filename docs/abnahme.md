# ITK-Abnahme (`/psv-itk` → Abnahme)

> Status labels as in the rest of `docs/`: **DONE** (in the code, covered by a test or gate named below),
> **NOT DONE** (known gap, specified here so it is a build, not a design).

The fachtechnische Abnahme checklists of an ITK installation, worked through on screen. It is a tab of
`/psv-itk` next to the Übersicht; it is not a separate application and shares the Übersicht's page frame,
`KpiCard`, toolbar card, status tones and data plane.

## What exists (DONE)

| Piece | Where | Check |
|---|---|---|
| Domain types (`Technik`, `AbnahmeStatus`, `ChecklistItem/Section/Template`, `AbnahmeAnswers`) | `shared/abnahme/types.ts` | `tsc` |
| Templates ZIM (93 items), Video (74), DSA+ (74), dBOS (85) | `shared/abnahme/templates/*.ts` — **generated** | `shared/abnahme/templates.test.ts`, `pnpm abnahme:check` |
| Source of record for the templates | `data/abnahme-source.json` (verbatim from the Abnahme prototype) | `pnpm abnahme:check` |
| Summary, Mängelliste, search/filter | `shared/abnahme/summary.ts`, `filter.ts` | `summary.test.ts` |
| Session state machine | `shared/abnahme/state.ts` | `state.test.ts` |
| Status → tone mapping (shared with the review statuses) | `shared/abnahme/appearance.ts` | `appearance.test.ts` pins it to `TONE_APPEARANCE` |
| Persistence contract (zod) | `shared/abnahme/persistence.ts` | used to validate sessionStorage today |
| UI | `client/src/components/abnahme/*`, tab shell in `client/src/pages/PsvItk.tsx` | `scripts/e2e-smoke.mjs` section "ITK-Abnahme and the PDF preview" (desktop and phone width) |
| PDF | `client/src/pdf/AbnahmeDocument.tsx`, `renderAbnahmePdf.ts`; shared `pdfFile.ts`; `client/src/components/PdfPreviewDialog.tsx` | e2e: preview, real `%PDF-` download, filename pattern |
| Entry points | tab, search palette ("ITK-Abnahme"), "ITK-Abnahme" button in the project dialog | |

## PDF

The Abnahmeprotokoll is built from the same `(template, answers)` pair and the same `summarizeTemplate` /
`deriveMaengel` as the screen, so printed counts cannot differ from what the Prüfer saw. It is stamped ENTWURF while
any point is unrated, exactly like the Anmeldung Checkliste. `PdfPreviewDialog` shows any generated PDF in the page with
Herunterladen / In neuem Tab / Drucken; the Projektblatt uses the same dialog ("Vorschau"). Every PDF goes through
`renderPdf` / `savePdf` in `client/src/pdf/pdfFile.ts` — a new document type is a `*Document.tsx`, a `render*Pdf.ts`
and one `show(...)` call.

## Regenerating the templates

```
node --import tsx scripts/extract-abnahme-templates.ts --from <abnahme-verlauf-itk dir>   # prototype → data/abnahme-source.json
pnpm abnahme:extract                                                                       # data/abnahme-source.json → shared/abnahme/templates/*.ts
pnpm abnahme:check                                                                         # fails if a template is stale (also runs in CI: job lint-typecheck)
```

A section that is identical in several Techniken (1.1 in all four; 1.2–1.6 in ZIM and dBOS) is emitted once in
`templates/common.ts`. Changing a label means bumping `version` in the generator and regenerating.

## Decisions worth knowing

* **Statuses** are exactly the prototype's: `Erfüllt`, `Offen`, `Entfällt`. "Nicht bewertet" is `null`, not a status.
* **"Kritisch" is not modelled.** The source checklists carry no severity. The summary reports `offenOhneMangel`
  (Offen with no Mangelbeschreibung) instead — a fact, not an invented grade. If the Fachbereich defines
  criticality, it becomes an optional `critical?: boolean` on `ChecklistItem` in the template, nothing else changes.
* **Leaving "Offen" clears the Mangel text** (it is hidden on screen, so it must not feed the Mängelliste or search).
* **Mängelliste is derived**, never stored, so numbering cannot go stale.
* **Project binding** is by `?project=<id>` and reads the Project aggregate through `useProjectsPageExtras` /
  `useProjects` — the two hooks that already work in local and server mode. Nothing is written to the project.
* **State is per (Technik, project)** and the checklist is remounted on change, because item ids such as `1.1.1`
  exist in all four checklists.

## Persistence shape for the next increment (NOT DONE)

The browser already stores, per `abnahme:v1:<technik>:<projectId|frei>` in `sessionStorage`, an `AbnahmeRecord`:

```ts
{ projectId: number | null,          // FK → projects.id
  technik: Technik,
  templateVersion: string,           // which wording the answers belong to
  header: { gewerkAnlage, errichter },
  answers: Record<itemId, { selected: "Erfüllt"|"Offen"|"Entfällt"|null, mangel: string }> }
```

To persist it on the server:

1. Table `abnahme_records`: `id`, `project_id` (FK, `ON DELETE CASCADE`), `technik`, `template_version`,
   `gewerk_anlage`, `errichter`, `answers` (JSON), `version` (optimistic concurrency), `created_by`, `updated_by`,
   timestamps; `UNIQUE (project_id, technik)`. A project-less ("frei") Abnahme stays client-side.
2. Drizzle schema + migration; tRPC `abnahme.get` / `abnahme.save` behind the existing authorization
   (`server/domain/permissions.ts`: same scope as editing the project's ITK review).
3. Save with `expectedVersion`; surface conflicts through the existing `ConflictDialog` path
   (`client/src/realtime/projectSyncEngine.ts`).
4. Add `AUDIT_ACTIONS` entries (`abnahme.save`, `abnahme.reset`) and record them like other document actions.
5. Replace `loadRecord`/`saveRecord` in `useAbnahmeSession.ts` with a query/mutation; keep `AbnahmeRecordSchema`
   as the wire contract. The reducer, summary and UI do not change.
6. Per-item rows instead of one JSON column only if per-item audit or reporting across projects is required.

## Extension points for the Projektübersicht ITK platform (NOT DONE)

* **Technik-Übersicht / Jahresansicht** — new entries in `TABS` in `client/src/pages/PsvItk.tsx`. They consume
  `summarizeTemplate(template, answers)`; `Technik` already uses the platform's names (ELA, Video, WLAN, ZIM, DSA+, SAA, dBOS).
* **PDF-Code** `PB_[Technik]_[Bahnhof]_[Nummer]_[Jahr]` — a pure function over `Project.station`/`bahnhofsnummer`,
  `Technik` and a running number; belongs in `shared/abnahme/` with a test. The year comes from the ITK `pruefDatum`.
* **ELA, WLAN, SAA checklists** — one template module each plus one line in `templates/index.ts`; the selector
  already lists them (disabled).
