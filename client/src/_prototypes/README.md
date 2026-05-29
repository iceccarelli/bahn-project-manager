# _prototypes — Experimental UX prototypes

This folder contains experimental code preserved for **reference only**. It is
explicitly excluded from production builds, type checking, and linting.

## Rules

1. **Nothing in production code imports from `_prototypes/`.** The leading
   underscore on the folder name, `tsconfig.json` `exclude`, and `biome.json`
   `files.ignore` enforce this together.
2. **Files here are NOT type-checked, NOT linted, NOT bundled** with the
   production build. Every file should have `// @ts-nocheck` at the top.
3. **Files here are NOT runnable as-is against the real `data.json`.** They
   are kept for the UX/design ideas they contain. To port any feature into
   the production app, rewrite it against the real architecture:
   - Types: `shared/types.ts` (Project, Review, Stats, Filters)
   - Data: `client/src/_core/api/client.ts` (apiClient)
   - Hooks: `client/src/hooks/useDataQuery.ts`
   - Layout: `client/src/components/DashboardLayout.tsx`

## What's here

### `query-studio/`

A 986-line single-page prototype of the project manager. Originally located
at `client/src/hooks/App.tsx`. Moved here to isolate it from the build.

Worth reviewing for:

- **Natural-language query** (`processNLQuery`) — keyword matching across
  region, department, status, and risk
- **AI Insights panel** (`aiInsights` useMemo) — rule-based recommendations
  for high-risk projects and bottlenecks
- **Inline edit modal** with a quick department-status grid
- **Styled Excel export** with bold header rows

**Known incompatibilities with real data:**

- References `project.lat` and `project.lng`, which do not exist in
  `client/public/data.json` (1,298 projects, no coordinates). The Map view
  would render zero markers.
- Hardcodes dark theme (`bg-[#0A0F1A]`); breaks light mode.
- Stores state in component-local `useState` — no persistence, no
  React Query, no `apiClient` integration.

If you want to port a feature, treat this file as a design reference, not a
code source. Read the JSX for layout ideas; rewrite the data layer from
scratch.
