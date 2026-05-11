# Bahn Project Manager

> A modern, enterprise-ready platform for managing Deutsche Bahn infrastructure and station development projects across multiple technical departments (Fachbereiche).

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express.js-4.21-000000?logo=express)](https://expressjs.com/)
[![Drizzle](https://img.shields.io/badge/Drizzle_ORM-0.44-FF6B6B)](https://orm.drizzle.team/)
[![Vitest](https://img.shields.io/badge/Vitest-2.1-6E9F18?logo=vitest)](https://vitest.dev/)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?logo=vercel)](https://vercel.com/)
[![pnpm](https://img.shields.io/badge/pnpm-9.x-F69220?logo=pnpm)](https://pnpm.io/)

**Current status:** Production-ready frontend with rich interactive table, map view, filtering, inline editing, Excel import/export, and audit logging. Backend API layer and database schema are implemented. Authentication is currently in demo mode. Full Microsoft 365 integration and mobile app are the next major milestones.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Database Setup](#database-setup)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Backend API](#backend-api)
- [Frontend Highlights](#frontend-highlights)
- [Authentication & Authorization](#authentication--authorization)
- [Deployment](#deployment)
- [Roadmap & Next Steps](#roadmap--next-steps)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**Bahn Project Manager** is a specialized workflow and data management platform designed for complex infrastructure projects at Deutsche Bahn. It centralizes project information, tracks review and approval processes across 14+ specialized technical departments (EEA, ITK, GA, Energie, HFT, HKLS, TBQ, BS, UM, BIM, LST, Vermessung, Baubetriebstechnologie, Baubetriebsplanung), and provides real-time visibility into status, workload, and bottlenecks.

The system supports:
- Station and line-based project tracking
- Department-specific review cycles with status, reviewer, and date fields
- Powerful filtering, search, sorting, and inline editing
- Interactive geospatial visualization
- Complete audit trail of all changes
- Excel-based bulk import/export aligned with existing business processes

It is built as a modern full-stack TypeScript monorepo optimized for rapid iteration, type safety, and future extensibility into the broader Microsoft 365 and Azure ecosystem.

---

## Key Features

### Current Capabilities
- **Unified Project Registry** — 1,298+ seeded projects with rich metadata (Projektnummer, Station, Bahnhofsmanagement/Region, Projektleiter, Beschreibung, Kommentar, Link).
- **Multi-Department Review Tracking** — Dedicated columns or expandable rows for all 14 Fachbereiche with status, Prüfer (reviewer), and Prüfdatum.
- **Advanced Data Interaction**
  - Global full-text search across multiple fields
  - Filter by Region, Projektleiter, Prüfer, Department, and Status
  - Client-side + server-backed sorting and pagination (50/100 rows configurable)
  - Inline cell editing with optimistic updates and toast feedback
  - Status color coding following corporate DB conventions
- **Interactive Map View** — Leaflet + OpenStreetMap visualization of station locations with popup details (synced with current filters).
- **Specialized Views**
  - BVB-EEA (Freigabeerklärung, Kosteneinsparung)
  - PSV-ITK (Projektstand, Termin)
- **Data Portability** — One-click Excel export of current view; bulk import from Excel matching existing templates.
- **Audit & History** — Complete change log (who changed what, when).
- **Role-Based Access** — Admin (full edit) vs User (limited to assigned departments).
- **Professional UX** — Dark mode ready, responsive, keyboard-friendly, sticky headers, smooth interactions.

### Quality & Developer Experience
- Full TypeScript coverage (strict mode)
- Vitest unit tests for backend procedures
- Prettier + consistent formatting
- Drizzle type-safe queries and migrations
- Vercel-ready serverless deployment configuration

---

## Tech Stack

### Frontend
- **React 19** + **Vite 7** + **TypeScript 5.9**
- **shadcn/ui** + **Tailwind CSS** + **Lucide React** icons
- **Leaflet** for interactive maps
- **Sonner** for elegant toasts
- Custom data hooks with in-memory caching + server synchronization layer
- Responsive table with expandable department columns

### Backend
- **Express** (TypeScript)
- **Drizzle ORM** + **drizzle-kit** for schema, queries, and migrations
- REST / procedure-style endpoints for projects, department reviews, statistics, import/export, audit
- Zod / schema validation (planned full adoption)

### Database
- **PostgreSQL** (recommended: Neon, Vercel Postgres, or Supabase)
- Comprehensive schema: `projects`, `department_reviews`, `bvb_eea`, `psv_itk`, `audit_log`

### Tooling & Deployment
- **pnpm** workspaces / monorepo
- **Vitest** for testing
- **Vercel** (frontend + serverless functions / API routes)
- GitHub Actions ready (expandable)

---

## Architecture

This is a **monorepo** with clear separation of concerns:

```
bahn-project-manager/
├── client/                 # React + Vite frontend (pages, components, hooks)
├── server/                 # Express backend + Drizzle queries & procedures
├── shared/                 # Shared TypeScript types, constants, utilities (used by both)
├── drizzle/                # Drizzle schema definitions and migration files
├── patches/                # Dependency patches (if any)
├── package.json            # Root scripts & dependencies
├── drizzle.config.ts
├── vercel.json
└── tsconfig.json
```

**Data flow (current):**
Frontend hooks (`useProjects`, `useAllData`) ↔ Backend Express procedures ↔ Drizzle ORM ↔ PostgreSQL

The architecture is designed to evolve cleanly toward:
- Full server state management (TanStack Query / React Query)
- Real-time updates
- Microsoft Entra ID protected APIs
- Shared code with a future React Native app

---

## Getting Started

### Prerequisites
- **Node.js** ≥ 20.x (LTS recommended)
- **pnpm** ≥ 9.x (`corepack enable pnpm`)
- **PostgreSQL** database (local Docker, Neon.tech, or Vercel Postgres)
- Git

### Installation

```bash
git clone https://github.com/iceccarelli/bahn-project-manager.git
cd bahn-project-manager
pnpm install
```

### Database Setup

1. Create a PostgreSQL database and obtain a connection string (`DATABASE_URL`).

2. Configure Drizzle:

```bash
cp .env.example .env
# Edit .env and set DATABASE_URL=postgresql://user:pass@host:port/db
```

3. Push schema and seed (or run migrations):

```bash
pnpm db:push          # Generates & applies migrations (development)
# or for production-grade:
# pnpm drizzle-kit generate
# pnpm drizzle-kit migrate
```

The database is pre-seeded with 1,298 realistic project records during initial setup.

### Environment Variables

Create a `.env` file (or configure in Vercel):

```env
# Database
DATABASE_URL="postgresql://..."

# Microsoft Entra ID (future / optional for now)
MICROSOFT_CLIENT_ID=""
MICROSOFT_TENANT_ID="common"   # or your specific tenant
MICROSOFT_CLIENT_SECRET=""     # for backend if using confidential client

# Optional
NODE_ENV=development
PORT=3000
```

### Running Locally

```bash
# Development (watches server + serves frontend via Vite)
pnpm dev

# Type checking
pnpm check

# Run tests
pnpm test

# Format code
pnpm format
```

The app will be available at `http://localhost:5173` (Vite) with backend on the configured port.

---

## Project Structure

```
client/src/
├── components/          # Reusable UI (StatusBadge, InlineEditCell, MapView, etc.)
├── hooks/               # Data fetching & mutation hooks (useProjects, useAllData, useFilters...)
├── pages/               # Main views (Projects.tsx, Dashboard, BVB-EEA, PSV-ITK...)
├── lib/                 # Utilities, API client
└── App.tsx / main.tsx

server/
├── _core/               # Express app setup, middleware
├── procedures/          # Business logic (projects, reviews, stats, import/export, audit)
├── db/                  # Drizzle schema + connection
└── index.ts             # Server entry

shared/
├── types.ts             # Project, Review, Stats, Filters interfaces
└── constants.ts         # Department lists, status enums, colors

drizzle/
└── schema.ts            # All table definitions (projects, department_reviews, audit_log...)
```

---

## Database Schema

Core tables (Drizzle):

- `projects` — Master project data (id, projektnummer, station, bahnhofsmanagement, projektleiter, beschreibung, kommentar, projektLink, created/updated timestamps)
- `department_reviews` — One row per project × department (status, prueferName, pruefDatum)
- `bvb_eea`, `psv_itk` — Specialized extension tables
- `audit_log` — Immutable history of all mutations (user, action, old/new values, timestamp)

All relationships are enforced at the database level with proper foreign keys and indexes for performance on filtered queries.

---

## Backend API

The backend exposes procedure-style endpoints (mounted under `/api`):

- `GET/POST/PATCH /api/projects` + filtering, pagination, search
- `GET/PATCH /api/projects/:id/reviews` (per department)
- `GET /api/stats` (KPIs, distributions, workload)
- `POST /api/import/excel`, `GET /api/export/excel`
- `GET /api/audit/:projectId`
- Specialized routes for BVB-EEA and PSV-ITK

All responses are fully typed and validated. The frontend currently uses a combination of direct fetch and optimistic client-side updates (transitioning to full server synchronization).

---

## Frontend Highlights

- **Projects Table** — Sticky columns, expandable department sub-rows, powerful inline editing, status dropdowns with corporate color palette.
- **Map Integration** — Filter-aware Leaflet map with project pins and rich popups.
- **Dashboard KPIs** — Accurate totals calculated from the complete dataset.
- **Excel Alignment** — Import/export designed to match existing business Excel workflows.
- **Accessibility & UX** — Keyboard navigation, screen-reader friendly labels, smooth loading states, error toasts.

---

## Authentication & Authorization

**Current state:** Demo / mock authentication (easy to replace).

**Target architecture (Microsoft 365 native):**

- **Frontend (SPA):** MSAL.js (`@azure/msal-browser` + `@azure/msal-react`) for Entra ID login, token acquisition, and silent refresh.
- **Backend (Express):** JWT validation middleware using `@azure/identity` or `passport-azure-ad`. Support for both delegated (user) and application permissions.
- **Role-Based Access Control (RBAC):** Map Microsoft 365 security groups / Entra ID app roles to internal roles (Admin, Department Reviewer, ReadOnly).
- **Conditional Access & MFA:** Leveraged automatically via Entra ID policies.
- **User Provisioning:** Just-in-time creation from Microsoft Graph profile + group membership.

This approach gives single sign-on across web, future mobile app, Teams tabs, and SharePoint web parts with zero additional password management.

---

## Deployment

### Vercel (Recommended)

The repository already contains `vercel.json` configured for:

- Static frontend hosting
- Serverless function adapter for the Express backend (`/api/*` routes)

**Steps:**

1. Connect the GitHub repository to Vercel.
2. Add `DATABASE_URL` and Microsoft Entra ID environment variables in Vercel dashboard.
3. (Optional) Configure custom domain and preview branches.
4. Push to `main` → automatic deployment.

For production database, prefer **Neon** or **Vercel Postgres** with connection pooling enabled.

---

## Roadmap & Next Steps

The frontend and core data model are mature. The highest-impact next investments are:

### 1. Backend Persistence & Real API Synchronization (High Priority)
- Replace remaining client-side only mutations (`cachedData` in `useData.ts`) with real `fetch` calls to Express endpoints + proper loading/error states.
- Introduce **TanStack Query** (React Query) for caching, invalidation, optimistic updates, and background refetching.
- Add comprehensive error boundaries and retry logic.

### 2. Microsoft Entra ID Authentication & Microsoft 365 Integration (High Priority)
- Implement MSAL-based login flow (popup + redirect) with proper token caching.
- Protect all API routes with JWT validation.
- Sync user roles from Microsoft 365 groups.
- **Interoperability features:**
  - Store and retrieve project documents in **SharePoint** document libraries (per station/project folder structure) via Microsoft Graph.
  - Post adaptive card notifications to **Teams** channels when a review status changes.
  - Create **Planner** tasks or Outlook events for upcoming `Prüfdatum` deadlines.
  - Surface key metrics in **Power BI** dashboards (embedded or via Direct Lake).

### 3. React Native Mobile Companion App (High Priority)
- Create `mobile/` or `apps/mobile/` folder using **Expo SDK 52+**.
- Share TypeScript types, business logic, and (where possible) UI components via the `shared/` package or a dedicated `@bahn-project-manager/shared` npm package.
- Implement offline-first data layer (Expo SQLite + Drizzle or WatermelonDB) with background sync.
- Native map experience (`react-native-maps` or WebView + Leaflet).
- Push notifications via **Expo Notifications** bridged to **Azure Notification Hubs** or Microsoft Graph.
- Microsoft authentication via `react-native-msal` or Expo AuthSession + Entra ID.

### 4. Real-time Collaboration & Notifications
- Add WebSocket / Server-Sent Events layer (or **Azure Web PubSub** / **Azure SignalR Service**) for live status updates across users.
- Comment threads with @mentions and email/Teams digest.

### 5. Advanced Reporting, Automation & AI
- Server-side PDF generation (Puppeteer or React-PDF) + scheduled reports.
- **Microsoft Power Automate** flows triggered by status changes (e.g., escalate overdue reviews).
- Optional future: Azure OpenAI integration for summarizing long comment threads or flagging potential risks in project descriptions.

### 6. Developer Experience & Operations
- Full **GitHub Actions** CI/CD pipeline (lint, type-check, test, build, preview deploy).
- End-to-end tests with **Playwright**.
- Structured logging + correlation IDs + integration with **Azure Application Insights** or Sentry.
- Infrastructure as Code (Bicep/Terraform) for any Azure resources beyond Vercel.
- Expand test coverage to 80%+ on critical paths.
- Internationalization (German primary + English) using `react-i18next` or native React 19 features.
- Accessibility audit (WCAG 2.2 AA) and keyboard-only workflows.

### 7. Scalability & Performance
- Evaluate migration of frontend to **Next.js App Router** (React Server Components) for better SEO and streaming if public dashboards are needed.
- Database query optimization, read replicas, and caching layer (Redis / Upstash).
- Rate limiting, request validation, and security hardening (Helmet, CORS, input sanitization).

---

## Contributing

We welcome contributions that align with the enterprise vision:

1. Fork the repository and create a feature branch.
2. Follow existing code style (Prettier + TypeScript strict).
3. Add or update tests for any new logic.
4. Update this README and relevant documentation.
5. Open a Pull Request with a clear description of changes and business impact.

For large features (especially Microsoft 365 integration or mobile app), please open an issue first to discuss architecture.

---

## License

This project is licensed under the terms of the [MIT License](LICENSE) (or your chosen license).  
© 2025–2026 Bahn Project Manager contributors.

---

**Built with care for reliable railway infrastructure project delivery.**

*Questions or feedback? Open an issue or start a discussion on GitHub.*

---

*This README is designed to be living documentation. Please keep it updated as the platform evolves toward deeper Microsoft 365 and cross-platform integration.*
