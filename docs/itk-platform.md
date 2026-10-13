# Projektübersicht ITK platform → where it lives here

> Labels as elsewhere in `docs/`: **DONE** (in the code, with a test or gate named), **NOT DONE** (specified, blocked
> only on the thing named). Source: `iceccarelli/projektuebersicht-itk-platform` (FastAPI + Next.js + Expo, an Excel
> replacement for the Prüfstelle ITK). Nothing of that stack is imported; this is a domain mapping onto the one runtime,
> one data plane and one navigation model of this app.

> Related: [project-register-import.md](project-register-import.md) (the Übersichtsliste import, identity, links, decisions) ·
> [abnahme.md](abnahme.md) (the Prüfbericht reference of the protocol) · [data-governance.md](data-governance.md) (`private-data/`) ·
> [production-readiness.md](production-readiness.md) (what is verified, known red).

## The two records

The platform's central record is the **Prüfbericht** (one row of the yearly workbook: laufende Nummer, Tätigkeitsbereich,
Bahnhof/Strecke, Technik, abgeschlossen, Projektnummer, zuständiger PL, zuständiger FS, Termin, Beschriftung/PDF-Code,
Link …). This app's central record is the **Project** with one review per Gewerk; the ITK review carries Prüfer,
Prüfdatum and status. They overlap on Projektnummer, Station, PL (`projektleiter`) and FS (the ITK Prüfer) — and differ on
Technik, Tätigkeitsbereich, laufende Nummer and PDF-Code, which only the Prüfbericht has.
Measured on the shipped dataset: 510 ITK Prüfzeilen, 426 with a Prüfdatum (2021–2026), 510 with a Projektleiter, 484 with a
Prüfer; **0 of 510** project descriptions name a Technik, so Technik cannot be derived and is not guessed.

## Placement

| Platform feature | Home here | Status |
|---|---|---|
| Jahres-Tabs, Jahrestrend, KPI cards, Top PL / Top FS | `/psv-itk` → **Jahresansicht** — `shared/itk/jahresansicht.ts` (pure), `client/src/components/itk/JahresansichtView.tsx`; server read model `dashboard.itkYears` (same pattern as `dashboard.portfolio`/`reel`); demo build derives locally (`useItkYears`) | **DONE** — `shared/itk/jahresansicht.test.ts` incl. "alle Jahre equals the Übersicht KPIs on the shipped data"; e2e section "ITK-Jahresansicht" |
| Table with sort / filter / search / inline edit / modal / export | `/psv-itk` → **Übersicht** (`ReviewWorkspace`), unchanged | **DONE** (already existed; not re-implemented) |
| Abnahme checklists (from the Abnahme prototype) | `/psv-itk` → **Abnahme** | **DONE** — `docs/abnahme.md` |
| RBAC admin / PL / FS / viewer | existing OIDC roles + workspaces (`server/domain/permissions.ts`); no second user store | **DONE** (not ported) |
| Audit log, version history, optimistic locking, WebSocket sync | existing Änderungshistorie, `version` + conflict dialog, SSE | **DONE** (not ported) |
| Technik filter / Technik-Verteilung | needs the Prüfbericht record | see below |
| PDF-Code (Beschriftung) | derived from the Prüfbericht record | done |
| Excel import "100 % Datentreue", 2017–2019 legacy formats | Prüfbericht workbook import (below); the project register has its own import under Projekte | **DONE** |
| Expo mobile app, offline-first | out of scope | — |

## Prüfberichte — DONE, verified against the real workbook

`Projekt_bersicht_ITK_2.xlsx` (10 year sheets 2017–2026) is the reference. `pnpm itk:inspect "<xlsx>"` is a dry run that
changes nothing; importing it (admin only, Technik-Übersicht / PDF-Codes tabs) yields **1226 Prüfberichte**, idempotent on
re-import, dates intact. What the real file taught us (all handled in `shared/itk/pruefbericht-import.ts`):

- **Headers** are multi-line and differ per era → prefix-based aliases for 2020+, 2018–2019 and 2017.
- **Placeholders**: 751 pre-numbered rows with no content are counted and excluded, not imported as reports.
- **Duplicate numbers** are kept as `NNN/2` and reported (`770/2`, `25.010/2`), never dropped; "907a"-style numbers are valid.
- **Technik**: in 2020+ sheets the installation's Technik is the *Bauform / Bezeichnung der Anlage* column; the column headed
  "Technik" is the product. We store both and derive `technikArt` (filters, Technik-Übersicht). Vocabulary comes from the
  workbook's own Tabelle3; values outside it are reported ("ZIM ELA", "ZIM/ElA", "Rückbau"), not rewritten.
- **PDF-Code** is the workbook's formula, and it differs per sheet (2020+: `P25.001 - Bahnhof`; 2019: plain concatenation of
  Prüfnr, Bahnhof, Technik, Phase; 2018: `yyyymmdd-NNN …`; 2017: none). It is derived, never stored as truth; the stored
  workbook text is kept only to flag "weicht ab". On the real file 1149 of 1210 stored codes match; the remaining 61 are
  genuine edits or drift in the workbook (e.g. 2022 A/P prefixes), shown to the user rather than silently normalised.
- The platform's README form `PB_…` is never produced by its own code; the workbook formula is the truth.

## Prüfbericht ↔ Projekt — DONE (this change), see [project-register-import.md](project-register-import.md)

The relationship the platform's two records lacked is now a column: `itk_pruefberichte.projectId` (nullable; one project, many
reports; a report may stay unlinked), written only by `PruefberichtLinkService` (versioned, idempotent, one audit row per change),
never by the workbook import. The evidence rule is *same Projektnummer **and** same station, exactly one project* — anything less
is a suggestion a person confirms (`shared/itk/project-link.ts`; measured on the supplied workbooks in the new doc). The links
show where they belong:

| Where | What |
|---|---|
| `/psv-itk` → **Projektübersicht ITK** (new tab) | the Prüfbericht register with the canonical project of each report, back-link to the project, filters *zugeordnet / nicht zugeordnet*, *Zuordnen …*, admin *Automatisch zuordnen* (dry run first) and the existing workbook import |
| `/psv-itk` → **PDF-Codes** | a *Projekt* column linking back to the project |
| `/projects` → project detail | *ITK-Prüfberichte*: the linked reports with their canonical PDF-Code |
| `/psv-itk` → **Abnahme** | for a project: its linked report of the selected Technik — none: explicit empty state; one: used; several: the user must choose, and the protocol carries the running number and the **derived** PDF-Code (`docs/abnahme.md`) |

The project register itself (the *Übersichtsliste*) is imported under **Projekte**, not here:
[project-register-import.md](project-register-import.md). Still open: the migration of platform-only data (its seed script
reads the wrong columns, so nothing is taken from it).
