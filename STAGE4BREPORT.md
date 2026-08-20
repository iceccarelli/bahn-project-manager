# Stage 4b — PDF export, a working Änderungshistorie, and E2E proof

Base: Stage 4a. Everything below was measured against the production bundle in
headless Chromium.

---

## What "prove the buttons work" turned up

I started by writing a crawler that clicked every control on every route. It
proved nothing — 93 of the controls on the dashboard are Recharts legend items,
and clicking them tells you only that Recharts works. Two rewrites in, I threw
it away and wrote assertions about the flows that carry data instead.

That found a real defect on the first run:

> `ok   inline edit writes through and survives a reload`
> `FAIL the edit is recorded in the audit trail`

**The Änderungshistorie page was a placeholder.** It never called
`useAuditLog()`. It rendered a centred icon and the sentence *"Alle
Bearbeitungen in dieser Sitzung werden hier protokolliert"* — and showed
nothing, ever.

Meanwhile every edit *was* being written, correctly:

```json
{"id":"s7y7ic","timestamp":"2026-08-20T07:56:17.493Z","user":"V",
 "action":"Projekt aktualisiert",
 "details":"Feld projektstand von Mieterumbau iAG auf DBG-mt18822u geändert."}
```

Old value, new value, user, ISO timestamp. The audit trail the brief called
non-negotiable had been written faithfully for the entire project and had no
reader. It never looked broken — it looked *quiet*, which is why it survived.

A second defect sat behind it: `useUpdateProject`, `useUpdateReview` and
`useDeleteProject` invalidated `projects` and `stats` but never `audit`. Even
once the page read data, an edit would only have appeared after a hard reload.

Both fixed. The page now reads the log, formats German timestamps, tones each
action by verb, filters, and shows an empty state only when the log is
genuinely empty.

---

## The PDF

**Where:** "Checkliste als PDF", next to "Als Entwurf speichern" and "Weiter",
as asked.

**What:** two A4 pages that paginate to three — header block with all eight
project fields, the 22 questions with answers and comments, each Gewerk marked
*Prüfung offen* or *nicht erforderlich*, the 19-block Unterschriftenblatt with
drawn tick boxes and signature rules, and the notification list.

**Why `@react-pdf/renderer`** — this was decided on evidence, not taste:

- `vercel.json` declares rewrites and **no functions**. Production is a static
  SPA, so there is no server to render on. That removes the highest-fidelity
  option (headless Chromium) outright — it would not exist in the deployed
  environment.
- Of the client-side libraries, this is the one with a real layout engine and
  pagination, which a 22-row table plus a 19-block signature sheet needs.
  jsPDF would mean hand-positioning every cell.
- It emits a `Blob`, so the user gets a **download**, not a print dialog.
- `4.6.1` lists React 19 in its peer range; both its packages resolved against
  19.2.1 here.

**Cost:** loaded by dynamic `import()`. The 1.29 MB engine is its own chunk;
the entry chunk is **unchanged at 429 kB**. The route splitting from the
earlier pass would otherwise have been undone by a single import.

**Incomplete checklists still export**, watermarked ENTWURF. A tool that
withholds the document until every field is perfect is one people work around
with screenshots.

### Four defects found while verifying it

None of these would have shown up by looking at the PDF:

| what | how it showed | fix |
|---|---|---|
| `pdffonts` reported **`uni no`** | text could not be searched, copied, or read by a screen reader — the standard-14 Helvetica has no ToUnicode map | instance two static TTFs from the variable Inter the app already ships |
| wrong Inter subset | `latin-ext` holds only the *extended* range: en dash, em dash, middle dot and German quotes were all missing, and every run containing one silently fell back to Helvetica | use the `latin` subset — 230 glyphs, covers all of them |
| bold matched the regular face | `instantiateVariableFont` sets `usWeightClass` but leaves the name table describing the default instance, so both files called themselves "Inter Regular" and the subsetter could not dedupe | stamp name table + `fsSelection`; output dropped **522 kB → 34 kB** |
| ENTWURF watermark fragmented | `@react-pdf` lays rotated text out glyph by glyph — `pdftotext` showed loose `F`, `R`, `U`, `W` on separate lines | horizontal band, stays one searchable string |

Final state: `Helvetica fallbacks: 0`, both Inter faces embedded with
`uni yes`, 34 kB, umlauts extract correctly.

A sample export is attached as `Checkliste-Beispiel.pdf`.

---

## `pnpm e2e` — 14 assertions, all green

```
== navigation ==
  ok   sidebar "Dashboard" reaches /
  ok   sidebar "Projektanmeldung" reaches /anmeldung
  ok   sidebar "Projekte" reaches /projects
  ok   sidebar "BVB-EEA" reaches /bvb-eea
  ok   sidebar "PSV-ITK" reaches /psv-itk
  ok   sidebar "Änderungshistorie" reaches /audit

== data flow and persistence ==
  ok   inline edit writes through and survives a reload
  ok   the edit is recorded in the audit trail
  ok   localStorage is the persistence layer and holds the edit

== filtering and sorting ==
  ok   search narrows the table
  ok   sort headers reorder and announce aria-sort
  ok   view toggles switch between table, cards and map

== Projektanmeldung wizard ==
  ok   wizard exports a real PDF with the corrected ITK recipients
  ok   step 5 names who each Fachprüfung reaches
```

The last two assert the Stage 4a fix from the outside: the PDF must be a valid
`%PDF-` over 10 kB with the right filename, and step 5 must list **Emin Er**
and **Daniel Goldhausen** while **not** listing a Brandschutz specialist under
ITK.

It exits non-zero on the first failure, so CI can gate on it.

---

## Gates

```
tsc --noEmit    0 errors
biome check     85 warnings (unchanged)
vitest          124 passed | 6 skipped
verify:data     all checks passed
vite build      clean, entry still 429 kB
pnpm e2e        14 passed, 0 failed
```

Verified on a clean clone with the bootstrap applied — including the E2E run.

---

## Honest gaps

- **The E2E suite covers flows, not every pixel.** It does not click all 7,814
  inline-edit buttons in the projects table; it clicks one and proves the
  write-through path. That is the meaningful test.
- **`pnpm e2e` is not yet in CI.** It needs a Chromium install step in the
  workflow; say the word and I will add it.
- The mail layer is still blocked on the two Stage 4a questions: the 20
  reviewers with no contact record, and who LST should notify.
