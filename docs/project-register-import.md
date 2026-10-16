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

### Inside the file (`analyzeSource`, then the planner) — **DONE**

Rows with the same `fullKey` are either *cell-for-cell identical* (kept once, reported) or *different content under one
identity*. Then the file cannot say which is right: **no row is imported**, nothing is merged, no row wins silently. Each such
row goes to the planner as an explicit question (`ambiguous`, with `sourceRows` and `sourceDiff` — the cells that differ, per
row), and the import dialog shows the group as one card with the differing cells side by side and **Diese Zeile gilt**.
Measured on the supplied file: 1408 rows → 1340 distinct identities and **24 groups (68 rows)** that need that decision.

### Phases are registrations — AP is not EP — **DONE**

`Projektstand` is the project's **phase** (AP, EP, VEP, FA, …). Each phase is its own registration with its own Prüfungen,
Prüfer and Termine. The import therefore **never matches, holds against, or merges across phases**: an EP row next to an AP
project is simply a new registration — no question, no "moved on" conflict, even when the description was reworded
(`standsCompatible` in `shared/project-identity.ts`: stands are compatible only when equal, or when one side is blank — a blank
cannot contradict a phase and is filled, never cleared). In the supplied file 125 of 1204 job cores span more than one phase;
they are plain separate registrations. Tests: `register-plan.test.ts` ("another PHASE is another registration"),
`registerImport.db.test.ts` ("AP and EP are separate registrations").

### Against the database (`planRegister`, pure, shared by preview / apply / inspector)

| Result | Condition | Applied |
|---|---|---|
| **add** | no existing project can be this registration | by default |
| **unchanged** | exactly one existing project, equal | nothing written (the source key is remembered) |
| **update** | exactly one existing project; the file only **fills empty fields** | by default |
| **conflict** | exactly one existing project; the file would **replace a non-empty value** | held until the administrator ticks it, per row |
| **ambiguous** | several candidates, or an existing project at the same Projektnummer + Station with another description (an *edited* project, or a *new* registration?), or a group of rows of the file that disagree | held until a project is chosen, "new project" is said, the winning row is picked, or the row is excluded — per row |
| **skipped** | an administrator excluded exactly this row content earlier | never sent again; can be taken back |

Evidence for "exactly one": a stored **source key** (below) → the project's own fields spell out the same `fullKey` → same
`coreKey` and the **same phase** with one record on each side (only e.g. the Termin differs; the difference is an overwrite, hence `conflict`).
`Projektnummer` alone is never evidence. An existing project that *another* record of the same chunk matches exactly is
"claimed" and does not make a sibling ambiguous; chunks keep a Projektnummer group together (`chunkRecords`) so this holds.

A blank cell **never clears** a stored value; there is no "clear" rule. An identity field is compared as identity compares
it (a stored "Musterstadt (Main) Marktplatz" is not overwritten by "Musterstadt Marktplatz").

### Durable mapping and remembered decisions: `project_source_keys` — **DONE** (migrations 0012, 0013)

`(source, kind, sha256(key)) → projectId`, UNIQUE per key. `kind = match`: `sha256(fullKey)` → the project. It is written in the import transaction when a record is created or
matched, and removed with the project. It lets a later import find a project after the *project's* fields were edited in the
app. It stores no readable data and **never a row number**. Limits (UNVERIFIED on production data): if the *workbook's*
Projektnummer / Station / Beschreibung / Stand / Termin of a registration change together, the old key no longer matches and
the row shows up as `ambiguous` (candidate: the old project) — it needs one explicit click, after which the new key is stored
for the same project. A source that cannot supply a durable id cannot do better than that.

`kind = skip` (migration 0013, `projectId` NULL): the administrator's **"do not import this row"**, keyed by
`sha256("skip:" + contentKey)` where `contentKey` = identity + the exact content of the row. Consequences, all tested
(`registerImport.db.test.ts` "decisions are remembered", `registerEdgeCases.db.test.ts`): the same file asks nothing twice; change
one cell of an excluded row in the workbook and it is a new question; "Entscheidung zurücknehmen" deletes the key; every
exclusion and take-back is an audit row (`import.skip` / `import.unskip`, entity label = Station · Projektnummer · Stand).
A chosen candidate / "new project" / "this row wins" is remembered the same way as any import: through the `match` key written
in the same transaction.

## Preview and apply (`projects.registerPreview` / `projects.registerApply`, admin only)

**Two imports of the same registration create one project (DONE).** A create on the evidence first *claims* the registration key in `project_source_keys` (UNIQUE source+key, no owner yet); a concurrent import of the same registration waits on that unique index and then loses — answered `exists` ("gerade von einer anderen Sitzung angelegt") — and the winner names the key's owner. Test: `registerImport.db.test.ts` "two imports of the same new registration with different keys create ONE project". A Projektnummer group larger than a request (150 rows) is split into several requests; its parts are planned apart, and the claim keeps a registration that appears in two parts from being created twice.

The SQL prefilters that load candidate projects strip exactly the whitespace `normProjektnummer` strips (space, tab, CR/LF, VT/FF, NBSP; `server/infra/sqlNormalize.ts`), so a project whose number carries a non-breaking space is found, not duplicated.

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
   Requests also carry the *context* of the chunk (identity-only stand-ins of the records the request does not act on), so that
   a row is judged exactly as in the preview even when only some rows of its chunk are sent.
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

`itk_pruefberichte.projectId` (nullable, indexed; `projectLinkSource` `auto|manual|detached`, `projectLinkedAt`). One project, many
reports; a report may stay unlinked. The workbook import neither sets nor clears it (`registerImport.db.test.ts` "re-importing the
workbook keeps the links"). Deleting a project clears and audits the links of its reports in the same transaction.

**Evidence rule** (`shared/itk/project-link.ts`, used by the server, the CLI and the tests): exactly one project with the
same Projektnummer **and** the same station (normalised) → `unique`; several → `ambiguous`; otherwise `unmatched` with a reason
(no Projektnummer on the report / no such project / no station on the report / station differs). Projects carrying the number
are offered as *suggestions* in the dialog — never linked on their own. A station alone never links.

**Phase-aware (DONE).** A report that states its phase ("fachtechnische Prüfung EP/AP/VEP", or the legacy sheets' phase column) belongs to
the project of **that** phase: among several projects at one station it picks the one whose Projektstand equals it
(`byPhase`), and it is **never** linked to a project of another phase — not even when that is the only project at the station
(`phase-passt-nicht`, shown with the projects as "andere Phase — kein Treffer"). Reports that state no phase
("Abnahmeprüfung", "Gutachten", "Stellungnahme", "Planprüfung") are not narrowed: several projects stay `ambiguous`. A project whose
stand is no single phase ("EP/AP", "FA", "Mieterumbau …", blank) can neither be picked by nor contradict a phase. Tests:
`project-link.test.ts` ("phases"), `link-fixtures.test.ts`, `registerEdgeCases.db.test.ts`.

* `pruefberichte.setLink` — one report, explicit choice (`manual`); needs an all-workspaces editor/admin and edit rights on the
  target; versioned (`expectedVersion` → CONFLICT), idempotent, one audit row (`projectId old → new`).
* `pruefberichte.autoLink` — admin; `dryRun` first. Links only `unique` reports that have no link yet.
* `pruefberichte.forProject`, `linkCandidates`, `list` (`verknuepfung`, `projectId`) — need `canViewPruefberichte` (admin or an
  explicit ALL grant); a workspace-limited principal gets FORBIDDEN on every one of them and never sees a report.

**Hand linking needs no Projektnummer (DONE).** The link dialog proposes the projects of the report's number, and below that has a project
search (station, number or description; the same scoped list as the Projekte page) — so the 704 reports without a number, or a
report whose number differs from the project's, can be attached explicitly (`manual`, audited). From a project, the offered open
reports are ordered by fit (station + phase first, then station, then the rest) and nothing is cut off silently ("N weitere anzeigen").

**A removed link is a decision (DONE).** Detaching writes `projectLinkSource = 'detached'` (audited, "bewusst gelöst"); `autoLink` and the
"automatisch zuordenbar" count leave such a report alone, a person can still link it by hand. Deleting a project clears its reports' links
without that marker (the project vanished; nobody decided).

**Automatic linking is gentle (DONE).** `autoLink` reads a snapshot (no locks on the whole table), then writes in chunks of 100: the
target projects are share-locked first (a project deleted meanwhile cannot receive a link, and its deletion waits), each report is
written with its own version guard (a report changed since the snapshot is left alone and counted — "inzwischen geändert" — instead of
aborting the run), audit rows go in per chunk. Lock order everywhere is project → reports (`setLink` locks the project first, like
project deletion), so link and delete cannot deadlock.

**Stale automatic links are shown, not undone (DONE).** `linkSummary.staleAuto` counts automatic links whose evidence no longer
holds (report or project edited since); the Projektübersicht ITK shows a notice. Nothing re-links or unlinks by itself.

No project event is emitted for a link (reports are not part of the Project aggregate and carry no workspace); the project's
version does not move. Clients re-read a project's reports when its detail opens or after a link change.

Measured with `pnpm register:inspect … --itk …` on the supplied files (projection against the register as if imported, the
24 undecided groups not yet resolved): of 1226 Prüfberichte, 704 have no Projektnummer, 108 name a number no project carries, 212
name a number at another station, **14 state a phase that contradicts the station's project (not linked)**; **157 would link
automatically, 31 are ambiguous** (one station carries several registrations and the report states no phase). Before the rule was
phase-aware the same projection gave 106 / 96. The rest stays visible as "nicht zugeordnet".

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
change summary against an empty database, the statuses outside the vocabulary, a plan digest (identical on every run over an unchanged file), the ignored sheets with
their visibility, and with `--itk` the link projection above. Exit 0 only when the sheet and all required columns and all 14
department groups were found.

## Open business decisions — where the UI puts them — **DONE** (surfaced) / **NOT DECIDED** (the decision itself)

Each of these is shown in the import dialog or the link UI with the recommended policy as a tooltip / empty state
(`shared/register/policy.ts`, `LINK_POLICY` in `shared/itk/project-link.ts` — the same words as below). None is decided silently.

| Question | Where it appears | Recommended policy | Remembered as |
|---|---|---|---|
| **Rows of the file with one identity, different content** (24 groups / 68 rows measured) | import dialog: one card per group, differing cells side by side | Pick the row the responsible person confirms ("Diese Zeile gilt"); the others are excluded for good. Changing a cell of an excluded row makes it a question again. | `skip` keys for the losers, `match` key for the winner |
| **Status outside the vocabulary** (measured: `planungsbegleitend` 9×, `Protokoll erstellt` 7×, both TBQ) | import dialog: table *Status außerhalb des Vokabulars* with value × Gewerk × rows | Keep withheld (Prüfer and Datum are imported). Extending `REVIEW_STATUSES` is a decision of the data owners, made in code with a test — not in the dialog. | not remembered: a code change |
| **Conflict: the file would replace a stored value** | import dialog: conflict card with `old → new` per cell | Replace only if the file is the better-kept source; otherwise exclude. *Offen lassen* writes nothing and asks again next time. | `skip` key if excluded |
| **Ambiguous: edited project or second measure?** | import dialog: card with one selectable candidate per project and, for the chosen one, its exact cell changes | Map to the project if only the description was reworded; create a new project if it is a second measure. | `match` key / `skip` key |
| **Prüfberichte without a Projektnummer** (704 of 1226 measured, plus 108 naming an unknown number and 212 at another station) | *Projektübersicht ITK*: banner with the counts per reason, filter "ohne Projektnummer"; the link dialog repeats the policy | Add the Projektnummer in the Prüfstelle's workbook and re-import (the link survives); until then link by hand (project search in the link dialog). No rule that guesses is offered. | the link itself (audited) |
| **Several projects at one station for one report** (96 measured) | link dialog / banner | Choose the project whose phase the report concerns. | the link; a re-import of the workbook keeps it |

## Domain separation — **DONE**

The Übersichtsliste (projects + department reviews) and the Prüfbericht register (`itk_pruefberichte`) are separate domains with
separate modules, UI entry points and fixtures: `shared/register/**`, `RegisterImportDialog` and `RegisterImportService` import
nothing of the Prüfbericht domain; `shared/itk/**`, `pruefberichtStore` and the yearly views (`PdfCodesView`, `TechnikView`,
`JahresansichtView`, `PruefberichtImportDialog`) import nothing of the register. The generic cell helpers moved to
`shared/workbook-cells.ts` / `shared/workbook.ts` (neither domain). The only bridges are the link rule
(`shared/itk/project-link.ts`, which knows only `shared/project-identity.ts`), `PruefberichtLinkService`, and the screens that
*show* a link (project detail, the Projektübersicht ITK tab, the Abnahme). `server/domainSeparation.test.ts` fails when that
changes. The new tab adds the project column and linking to the report register; it carries no register-import concept (only the
shared tooltip component `PolicyHint`).

## Fixtures — **DONE**

Synthetic, invented content, reproducing the *shapes* measured on the real files — one set per domain, and one pair for the link:

* `shared/register/fixtures.ts` — one framework number on many stations and phases, rows without a number, undecidable groups, an
  identical duplicate, two dates in a cell, `30.12.20025`, statuses outside and variants of the vocabulary, Bahnhofsmanagement lots
  and placeholders (`fixtures.test.ts` asserts the fixture still has those properties).
* `shared/itk/edge-fixtures.ts` — Technik values outside the list, the 2018 / 2019 / 2022 PDF-Code formulas and a deviating stored
  code, a duplicated running number (`edge-fixtures.test.ts`).
* `shared/link-fixtures.ts` — the only place the two meet: reports that name the register's projects (unique through spelling,
  ambiguous across phases, no number, unknown number, other station). Used by `link-fixtures.test.ts` and
  `registerEdgeCases.db.test.ts` (the whole path on a real database, including what the Abnahme gets after linking) and the browser proof.

## Verified / not verified

**VERIFIED** (MariaDB 10.11 + Redis, local): unit tests (`shared/register/*.test.ts`, `shared/itk/project-link.test.ts`,
`shared/abnahme/pruefbericht.test.ts`, `client/src/pdf/AbnahmeDocument.test.ts` — what the Abnahmeprotokoll prints, walked from the
document tree), real-database tests (`server/domain/registerImport.db.test.ts`, `registerEdgeCases.db.test.ts`,
`server/routers.register.db.test.ts`), `server/mutationPlane.test.ts`, `server/domainSeparation.test.ts`, the server-mode browser
proof, the inspector and a decision-by-decision import of the two real workbooks into a disposable database (nothing committed):
1340 projects created, the same file again changes nothing (no events, no audit rows but the batch row), 24 groups resolved
(24 winners created, 44 rows excluded) and then the file asks nothing; 157 of 1226 reports link automatically before the groups
are decided, 152 after the (test) resolution (the 24 winners add candidates; the numbers depend on which row wins), and **no
linked report contradicts its project's phase** (checked in SQL).

**VERIFIED in CI on MySQL 8.4** (PR #7 runs 160–162, `main` run 163): tests, migrations ×2, container gate, server-mode e2e, UI performance. **UNVERIFIED locally**: MySQL 8.4 (only MariaDB is available here; `LOCK IN SHARE MODE` is used because `FOR SHARE` is MySQL-only); a production-sized
import; the PDF *as rendered bytes* (the printed text is asserted on the document tree); the Redis-outage chaos step of the
browser proof (needs a Docker container).

**Formerly known failure, fixed**: `server/infra/readModels.db.test.ts` › "map: authorization and filters are the list's …" depended on the order of `markers[0]` (an earlier test in the file moves projects between workspaces), not on an authorization defect; it now selects a Frankfurt-only station by SQL (see docs/production-readiness.md). `pnpm test` is fully green on MariaDB and MySQL 8.4.
