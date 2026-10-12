# Projektübersicht ITK platform → where it lives here

> Labels as elsewhere in `docs/`: **DONE** (in the code, with a test or gate named), **NOT DONE** (specified, blocked
> only on the thing named). Source: `iceccarelli/projektuebersicht-itk-platform` (FastAPI + Next.js + Expo, an Excel
> replacement for the Prüfstelle ITK). Nothing of that stack is imported; this is a domain mapping onto the one runtime,
> one data plane and one navigation model of this app.

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
| Technik filter / Technik-Verteilung | needs the Prüfbericht record | **NOT DONE** |
| PDF-Code (Beschriftung) | needs the Prüfbericht record | **NOT DONE** |
| Excel import "100 % Datentreue", 2017–2019 legacy formats | extends the existing Excel import with the Prüfbericht columns | **NOT DONE** |
| Expo mobile app, offline-first | out of scope | — |

## Decision needed before the Prüfbericht work: which PDF-Code?

The platform's README documents `PB_[Technik]_[Bahnhof]_[Nummer]_[Jahr]`, but its code (`services/pdf_code.py`, "replicates
the Excel formula") implements something else:

```
prefix  = G  if Tätigkeitsbereich == "Gutachten"
          S  if "Stellungnahme"
          A  if "Abnahmeprüfung" or "fachtechnische Prüfung vor Ibn"
          P  otherwise (EP / AP / VEP, Planprüfung)
code    = prefix + laufendeNummer + " - " + Bahnhof/Strecke        e.g. "P25.001 - Frankfurt Hbf"
legacy 2018–19:  Prüfnr - Bahnhof - Technik - Phase
```

The existing workbooks contain the second form, so it is the one that matches the data; the README form appears to be a
design intention that was never implemented. Confirm which one the Prüfstelle wants on the PDFs; the function is a pure,
test-first piece either way (`shared/itk/pdf-code.ts`).

## The Prüfbericht increment (NOT DONE) — what it needs

1. **Storage**: table `itk_pruefberichte` — `id`, `year`, `laufende_nummer` (`UNIQUE(year, laufende_nummer)`),
   `datum`, `taetigkeitsbereich`, `art_der_baumassnahme`, `eba_aktenzeichen`, `bahnhof_strecke`,
   `zustaendige_eba_aussenstelle`, `art_der_technik`, `bauform_bezeichnung`, `technik`, `abgeschlossen`,
   `projektnummer`, `zustaendiger_pl`, `zustaendiger_fs`, `termin`, `link`, `version`, plus a nullable `project_id` FK
   resolved through `projektnummer`. The PDF-Code is **derived, not stored** (the platform stores it; a stored copy is a
   second truth). Drizzle schema + migration, tRPC read/write behind `permissions.ts`, audit entries, conflict handling via
   the existing sync engine.
2. **Vocabularies** in `shared/itk/`: Technik (ELA, Video, WLAN, ZIM, DSA+, SAA, dBOS — the Abnahme's `Technik` is a subset;
   FQM, 3SZ, BÜ appear in the platform's manual), Tätigkeitsbereich, Abgeschlossen (Ja / Ja (m.A.) / Nein / in Bearbeitung)
   with tones from `status-appearance.ts`. The manual's long names for the Kürzel are not adopted: it expands ZIM as
   "Zuginternes Monitoring" while the Abnahme checklists call the same Technik "Optische Kundeninformationssysteme (FIA-ZIM)".
3. **Import**: the workbook's 17 columns (`excel_service.COLUMNS_2020_PLUS`) and the 2017–2019 mappings, into the above.
4. **UI**: Technik-Übersicht and PDF-Codes become entries in `TABS` (`client/src/pages/PsvItk.tsx`); the Jahresansicht gains
   Technik in its chart and a Technik ranking, from the same `buildItkYears` (a `technik` field on the entry, nothing else).
5. **Link to the Abnahme**: an Abnahme *is* an "Abnahmeprüfung" (prefix `A`), so a bound Prüfbericht gives the
   Abnahmeprotokoll its laufende Nummer and PDF-Code in the header and filename.
