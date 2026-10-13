# Project register import and Prüfbericht links

> Labels as elsewhere in `docs/`: **DONE** (in the code, with a test or gate named), **NOT DONE** (known gap), **UNVERIFIED**
> (written, but no evidence in this environment). Numbers are measured on the two supplied workbooks with
> `pnpm register:inspect` / `pnpm itk:inspect`; the workbooks themselves are never committed (`/private-data/`, see
> [data-governance.md](data-governance.md)).

## What was missing

Two workbooks describe the same work from two sides and share no identifier:

| Workbook | Record | Lives in |
|---|---|---|
| **Übersichtsliste** (`.xlsm`, sheet *Übersicht*) | one *registration* of a project, with the status / name / date of 14 departments | `projects` + `department_reviews` |
| **Projektübersicht ITK** (`.xlsx`, one sheet per year) | one ITK *Prüfbericht*: running number, Tätigkeit, Technik, PDF-Code | `itk_pruefberichte` |

The first had no import at all (the project data entered the database through operator scripts); the second was imported but
**not related to any project** (`docs/itk-platform.md` listed this as the open gap). This change adds the import of the first
workbook through the existing project write path, and a durable, audited relationship `itk_pruefberichte.projectId`.

No second schema, runtime or navigation was added: `projects` stays the one project entity, `department_reviews` the one
home of department status / person / date, `itk_pruefberichte` the one report table; `/projects`, `/psv-itk`, `/bvb-eea`
are unchanged apart from what is listed below. The deprecated `bvb_eea` / `psv_itk` tables are untouched.

## Field mapping (Übersichtsliste → canonical)

Header-driven (`shared/register/register-import.ts`): a column is mapped by what its header says; the column letters below
are the layout of the supplied file and are only *compared* — a moved column is reported (`header-moved`) and followed by
name, never silently read as another field.

| Source (column) | Target | Notes |
|---|---|---|
| Projektnummer (A) | `projects.projektnummer` | not unique, see identity |
| Bahnhofsmanagement (B) | `projects.bahnhofsmanagement` | `normalizeBahnhofsmanagement`; "Darmstadt LOS 1" → Darmstadt, "???"/"Bitte auswählen" → empty, an unknown value → withheld and reported |
| Station (C) / Bahnhofsnummer (D) / Streckennummer (E) | `station` / `bahnhofsnummer` / `streckennummer` | "0945" keeps its zero |
| Projektbeschreibung (F) / Projektstand (G) / Projektleiter (H) | `projektbeschreibung` / `projektstand` / `projektleiter` | |
| Termin Projektvorstellung (I) | `terminProjektvorstellung` | Excel serial, `dd.mm.yyyy`, ISO; "-" = no value; anything else (two dates in a cell, `30.12.20025`) is **reported and left empty**, never guessed |
| Kommentar (AZ) / Link zum Projekt (BA) | `kommentar` / `projektLink` | |
| EEA J·K·L, ITK M·N·O, BS P·Q·R, GA S·T·U, Energie V·W·X, HFT Y·Z·AA, HKLS AB·AC·AD, TBQ AE·AF·AG, UM AH·AI·AJ, BIM AK·AL·AM, LST AN·AO·AP, Vermessung AQ·AR·AS, Baubetriebstechnologie AT·AU·AV, Baubetriebsplanung AW·AX·AY | `department_reviews` `(projectId, department)` → `status`, `prueferName`, `datum` | Status / Name / Datum. The workbook's spelling "Baubetriebstechnnologie" is an explicit alias. A status outside the review vocabulary is withheld (name and date are kept) and reported; variants of one group ("Projektkonfiguration") are stored as written and compared by group. A department with three empty cells creates no review. Test: `register-import.test.ts` "maps … all 14 department groups". |

Other sheets (the visible *BVB-EEA* and *PSV-ITK* extracts, the very hidden pivot / helper / dashboard sheets) are listed by
the inspector and **not read**: they are duplicate representations of the same rows.

## Identity — the part that must not be guessed

`Projektnummer` identifies nothing on its own: in the supplied file 177 numbers occur on more than one row (one number on up
to 100 rows, across different stations), 21 rows have none, and even *Projektnummer + Station + Beschreibung* repeats
(a project is registered once per phase — AP, EP, VEP … — or per Projektvorstellung). A workbook row number moves when
someone sorts. So identity is built only from fields whose meaning is known (`shared/project-identity.ts`):

* `coreKey` = Projektnummer | Station | Projektbeschreibung
* `fullKey` = coreKey | Projektstand | Termin Projektvorstellung

(normalised: case, accents, punctuation, bracketed qualifiers like "(Main)", Hbf/Hauptbahnhof are not identity).

### Inside the file (`analyzeSource`)

Rows with the same `fullKey` are either *cell-for-cell identical* (kept once, reported) or *different content under one
identity* — then the file cannot say which is right, and **none is imported**; the report names the rows. Measured on the
supplied file: 1408 rows → 1340 distinct identities, 24 groups (68 rows) held. Nothing is merged, no row wins silently.

### Against the database (`planRegister`, pure, shared by preview / apply / inspector)

| Result | Condition | Applied |
|---|---|---|
| **add** | no existing project can be this registration | by default |
| **unchanged** | exactly one existing project, equal | nothing written (the source key is remembered) |
| **update** | exactly one existing project; the file only **fills empty fields** | by default |
| **conflict** | exactly one existing project; the file would **replace a non-empty value** | held until the administrator ticks it, per row |
| **ambiguous** | several candidates, or an existing project at the same Projektnummer + Station with another description (an *edited* project, or a *new* registration?) | held until a project is chosen — or "new project" is said — per row |

Evidence for "exactly one": a stored **source key** (below) → the project's own fields spell out the same `fullKey` → same
`coreKey` with one record on each side (Projektstand/Termin moved on; their differences are overwrites, hence `conflict`).
`Projektnummer` alone is never evidence. An existing project that *another* record of the same chunk matches exactly is
"claimed" and does not make a sibling ambiguous; chunks keep a Projektnummer group together (`chunkRecords`) so this holds.

A blank cell **never clears** a stored value; there is no "clear" rule. An identity field is compared as identity compares
it (a stored "Musterstadt (Main) Marktplatz" is not overwritten by "Musterstadt Marktplatz").

### Durable mapping: `project_source_keys`

`(source, sha256(fullKey)) → projectId`, UNIQUE per key. It is written in the import transaction when a record is created or
matched, and removed with the project. It lets a later import find a project after the *project's* fields were edited in the
app. It stores no readable data and **never a row number**. Limits (UNVERIFIED on production data): if the *workbook's*
Projektnummer / Station / Beschreibung / Stand / Termin of a registration change together, the old key no longer matches and
the row shows up as `ambiguous` (candidate: the old project) — it needs one explicit click, after which the new key is stored
for the same project. A source that cannot supply a durable id cannot do better than that.

## Preview and apply (`projects.registerPreview` / `projects.registerApply`, admin only)

1. The browser reads the file (cell values only; `bookVBA` off — **macros are never parsed or executed**), parses it and sends
   chunks to `registerPreview` (read-only; a mutation only to carry the body, like `projects.sync`).
2. The dialog (*Projekte → Übersichtsliste importieren*) shows what was understood (sheet, header row, 14/14 departments),
   counts (new / filled / unchanged / conflicts / ambiguous), the source rows held back, warnings by kind, and — per
   conflict / ambiguous row — the station, number, stand, the field-level `old → new`, and the decision control.
3. **Übernehmen** sends each chunk to `registerApply`: ONE transaction per chunk — idempotency claim → candidates loaded →
   **re-plan under the transaction** (the preview is advice) → per record `ProjectService.createWithin` /
   `updateWithin` (project row lock, version check, audit rows per field and `review.<Gewerk>.<field>`, one outbox event per
   project, read models, watcher notifications — the rows a single edit writes) → source key → one audit row for the batch →
   stored response → COMMIT; the relay is nudged afterwards.
4. The server refuses on the client's word: *create* when the evidence says a project exists (`exists`), *update* of a project
   that is not the planned match unless the administrator chose it from the listed candidates (`refused`), an update when the
   project changed since the preview (`stale`), replacing values without `overwrite` (`held`).

Re-importing the unchanged file creates nothing, changes nothing, publishes no event and writes no audit row except the
batch row (`registerImport.db.test.ts` "re-importing the unchanged file …"). The same key replays the stored answer; the same
key with another body is refused. A failing chunk rolls back completely.

**Recovery.** An import stopped half-way (browser closed, network) leaves the committed chunks in place — each is complete and
audited. Run the same file again: committed registrations are `unchanged`, the rest is added. There is no undo button; a
wrong *overwrite* is reverted by editing the project (the audit log has `old → new` per field) or by restoring from backup.
**Never point a first run at production**: run `pnpm register:inspect` on the file, then a staging copy.

## Prüfbericht ↔ project link

`itk_pruefberichte.projectId` (nullable, indexed; `projectLinkSource` `auto|manual`, `projectLinkedAt`). One project, many
reports; a report may stay unlinked. The workbook import neither sets nor clears it (`registerImport.db.test.ts` "re-importing the
workbook keeps the links"). Deleting a project clears and audits the links of its reports in the same transaction.

**Evidence rule** (`shared/itk/project-link.ts`, used by the server, the CLI and the tests): exactly one project with the
same Projektnummer **and** the same station (normalised) → `unique`; several → `ambiguous`; otherwise `unmatched` with a reason
(no Projektnummer on the report / no such project / no station on the report / station differs). Projects carrying the number
are offered as *suggestions* in the dialog — never linked on their own. A station alone never links.

* `pruefberichte.setLink` — one report, explicit choice (`manual`); needs an all-workspaces editor/admin and edit rights on the
  target; versioned (`expectedVersion` → CONFLICT), idempotent, one audit row (`projectId old → new`).
* `pruefberichte.autoLink` — admin; `dryRun` first. Links only `unique` reports that have no link yet.
* `pruefberichte.forProject`, `linkCandidates`, `list` (`verknuepfung`, `projectId`) — need `canViewPruefberichte` (admin or an
  explicit ALL grant); a workspace-limited principal gets FORBIDDEN on every one of them and never sees a report.

No project event is emitted for a link (reports are not part of the Project aggregate and carry no workspace); the project's
version does not move. Clients re-read a project's reports when its detail opens or after a link change.

Measured with `pnpm register:inspect … --itk …` on the supplied files (projection against the register as if imported):
of 1226 Prüfberichte, 704 have no Projektnummer, 108 name a number no project carries, 212 name a number at another
station; **106 would link automatically, 96 are ambiguous** (one station carries several registrations of the job). The
rest stays visible as "nicht zugeordnet".

## Where it shows

* **Projekte** → *Übersichtsliste importieren* (admin, server mode): `client/src/components/projects/RegisterImportDialog.tsx`.
* **Projekt-Detail** → *ITK-Prüfberichte*: the linked reports with canonical PDF-Code, attach / detach for who may,
  "In der Projektübersicht ITK" (`ProjectPruefberichte.tsx`). Only where the server would answer.
* **/psv-itk → Projektübersicht ITK** (new tab; Prüfbericht register with the project each report belongs to, back-link to the
  project, filters *zugeordnet / nicht zugeordnet*, *Zuordnen …*, admin *Automatisch zuordnen* with dry run and the existing
  workbook import) and a *Projekt* column in **PDF-Codes**.
* **/psv-itk → Abnahme**: for a project, the linked reports **of the selected Technik** (`shared/abnahme/pruefbericht.ts`):
  none → explicit empty state (the protocol is produced without a reference); one → used and shown; several → the user must
  pick, nothing preselected, and the PDF is disabled until then. The protocol carries the report's running number and the
  **derived** PDF-Code (never the free text stored in the workbook).

## Inspector

```bash
pnpm register:inspect "private-data/Übersichtsliste.xlsm" [--itk "private-data/Projektübersicht ITK.xlsx"] [--json]
```

Dry run: recognised sheet / header row / columns / 14 department groups, row counts, rows that would be skipped and why,
unparseable dates, unknown headers and statuses, repeated and missing Projektnummern, identities the file cannot decide, the
change summary against an empty database, a plan digest (identical on every run over an unchanged file), the ignored sheets with
their visibility, and with `--itk` the link projection above. Exit 0 only when the sheet and all required columns and all 14
department groups were found.

## Not decided here (business decisions)

* Status values in the file outside the review vocabulary (`Protokoll erstellt`, `planungsbegleitend` on TBQ) are withheld and
  reported; whether they join the vocabulary is the data owner's call.
* The 24 groups of rows with one identity but different content: someone has to decide which rows are real.
* Whether a *Projektstand* change (AP → EP) is the same project moving on (what `core` matching assumes, as a held conflict)
  or a new registration.
* Prüfberichte without a Projektnummer (the majority) cannot be linked by any rule that does not guess; they need a person, or a
  Projektnummer in the Prüfstelle's workbook.

## Verified / not verified

Verified here: unit tests (`shared/register/*.test.ts`, `shared/itk/project-link.test.ts`, `shared/abnahme/pruefbericht.test.ts`),
real-database tests on MariaDB 10.11 (`server/domain/registerImport.db.test.ts`, `server/routers.register.db.test.ts`),
`server/mutationPlane.test.ts`, the inspector on the two supplied workbooks. Not verified: MySQL 8.4 (CI's engine; only MariaDB
was available), a production-sized import, real Entra sign-in. See the pull request for the exact commands and results.
