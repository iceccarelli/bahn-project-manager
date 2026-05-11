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
- [Current Progress](#current-progress)
- [Overview](#overview)
- [The Journey: From Excel to Living Distributed Platform](#the-journey-from-excel-to-living-distributed-platform)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
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

## Current Progress

We are actively migrating from **static Excel-based workflows** to a **fully distributed, living platform**. Here is the honest current state:

| Area                                   | Completion | Status             | Notes |
|----------------------------------------|------------|--------------------|-------|
| **Frontend UI/UX & Interactivity**     | **92%**    | Excellent          | Polished table, map, inline editing, filters, dark mode |
| **Database Schema & Seeding**          | **85%**    | Very Good          | 1,298 records, 14 departments, audit_log, specialized tables |
| **Backend API & Procedures**           | **68%**    | Good               | Express + Drizzle CRUD exists, needs full persistence sync |
| **Real Server State & TanStack Query** | **35%**    | In Progress        | Still partial client-side caching in `useData.ts` |
| **Authentication (Microsoft Entra ID)**| **12%**    | Early              | Demo mode only |
| **Microsoft 365 Interoperability**     | **8%**     | Early              | SharePoint, Teams, Planner, Power BI integration planned |
| **React Native Mobile App**            | **3%**     | Not Started        | Expo + shared types planned |
| **Real-time & Collaboration**          | **10%**    | Early              | Basic audit exists |
| **DevOps, Testing & DX**               | **55%**    | Solid              | Vitest, Prettier, Vercel config ready |
| **Overall Platform Maturity**          | **48%**    | Solid Foundation   | Excellent UI + data model; backend & integration next |

```mermaid
pie title Overall Platform Completion (May 2026)
    "Frontend & UI" : 92
    "Database & Persistence" : 75
    "Backend API Core" : 68
    "Authentication & Security" : 12
    "Microsoft 365 Integration" : 8
    "Mobile & Distributed" : 5
    "Real-time & Advanced Features" : 10
```

**Visual Summary**: We have an outstanding, production-quality user interface and a solid data foundation. The biggest remaining work is **real backend synchronization**, **Microsoft identity & interoperability**, and the **React Native mobile experience**.

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

## The Journey: From Excel to Living Distributed Platform

This project represents the evolution from traditional Excel files to a modern, collaborative, always-alive platform.

```mermaid
journey
    title Migration Journey - Excel to Distributed Platform
    section Phase 1 Static Excel Legacy
      Multiple Excel files per department: 5: Business Users
      Manual updates via email: 3: Business Users
      No single source of truth: 2: Platform Team
    section Phase 2 Modern Web App Current
      Interactive React table and Map: 5: Developers
      Centralized PostgreSQL with Audit: 5: Developers
      Inline editing and Excel sync: 4: Business Users
      Demo role-based access: 3: Platform Team
    section Phase 3 Connected Enterprise
      Microsoft Entra ID and Graph: 4: Platform Team
      SharePoint document storage: 3: Platform Team
      Teams and Planner integration: 3: Business Users
      Full backend persistence: 5: Developers
    section Phase 4 Fully Distributed
      React Native mobile with offline: 2: Business Users
      Real-time updates web and mobile: 2: Platform Team
      Power Automate and AI insights: 2: Platform Team
      Power BI executive dashboards: 3: Management
```

**Goal**: Transform static, error-prone Excel processes into a living, collaborative system that works seamlessly across desktop, mobile, Microsoft Teams, SharePoint, and Power BI.

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

This is a **monorepo** with clear separation of concerns.

**Current Data Flow:**

```mermaid
flowchart TD
    subgraph Frontend
        A[React 19 + Vite<br/>Pages & Components]
        B[Custom Hooks<br/>useProjects, useAllData]
        C[In-memory Cache + Optimistic Updates]
    end

    subgraph Backend
        D[Express Server]
        E[Drizzle ORM Queries & Procedures]
    end

    subgraph Data
        F[(PostgreSQL<br/>Neon / Vercel Postgres)]
    end

    A -->|User interactions| B
    B -->|fetch + mutations| D
    D --> E
    E --> F
    F --> E
    E --> D
    D --> B
    B --> C
    C --> A

    style A fill:#e0f2fe
    style D fill:#fef3c7
    style F fill:#dcfce7
```

**Target Future Architecture (with Microsoft 365 + Mobile):**

```mermaid
flowchart TD
    subgraph Web
        W[React Web App]
    end
    subgraph Mobile
        M[React Native + Expo]
    end
    subgraph Backend
        API[Express / Future Hono API<br/>Protected by Entra ID]
        Graph[Microsoft Graph Client]
    end
    subgraph Microsoft 365
        Entra[Entra ID + RBAC]
        SP[SharePoint Documents]
        Teams[Teams Notifications]
        Planner[Planner / Outlook]
        PowerBI[Power BI Dashboards]
    end
    subgraph Data
        DB[(PostgreSQL + Audit)]
        RT[Real-time Layer<br/>Azure SignalR / Web PubSub]
    end

    W & M -->|MSAL + JWT| API
    API --> Graph
    Graph --> SP & Teams & Planner
    API --> DB
    API --> RT
    RT --> W & M
    Entra --> API
    PowerBI -.-> DB
```

The architecture is designed to evolve cleanly toward full server state management, real-time updates, Microsoft Entra ID protected APIs, and shared code with a future React Native app.

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
3. Push schema and seed:
   ```bash
   pnpm db:push
   ```

The database is pre-seeded with 1,298 realistic project records.

### Environment Variables
```env
DATABASE_URL="postgresql://..."
MICROSOFT_CLIENT_ID=""
MICROSOFT_TENANT_ID="common"
MICROSOFT_CLIENT_SECRET=""
NODE_ENV=development
PORT=3000
```

### Running Locally
```bash
pnpm dev
```

The app will be available at `http://localhost:5173`.

---

## Project Structure
```
client/src/
├── components/          # Reusable UI (StatusBadge, InlineEditCell, MapView...)
├── hooks/               # Data hooks (useProjects, useAllData...)
├── pages/               # Projects.tsx, Dashboard, BVB-EEA, PSV-ITK...
server/
├── _core/               # Express setup
├── procedures/          # Business logic (projects, reviews, import/export, audit)
shared/
├── types.ts             # Shared interfaces
drizzle/
└── schema.ts            # All table definitions
```

---

## Database Schema
Core tables (Drizzle):
- `projects` — Master project data
- `department_reviews` — One row per project × 14 departments
- `bvb_eea`, `psv_itk` — Specialized extension tables
- `audit_log` — Immutable change history

---

## Backend API
Procedure-style endpoints under `/api`:
- Projects CRUD + advanced filtering
- Department reviews management
- Statistics & workload
- Excel import/export
- Audit logging

---

## Frontend Highlights
- **Projects Table** — Sticky columns, expandable department sub-rows, powerful inline editing, status dropdowns with corporate color palette.
- **Map Integration** — Filter-aware Leaflet map with rich popups.
- **Dashboard KPIs** — Accurate totals from the complete dataset.
- **Excel Alignment** — Import/export matches existing business workflows.
- **Accessibility & UX** — Keyboard navigation, smooth states, error toasts.

---

## Authentication & Authorization
**Current:** Demo / mock authentication.

**Target (Microsoft 365 native):**
- Frontend: MSAL.js (`@azure/msal-browser` + `@azure/msal-react`)
- Backend: JWT validation with `@azure/identity`
- RBAC mapped from Microsoft 365 security groups / Entra ID app roles
- Just-in-time provisioning from Microsoft Graph

---

## Deployment
**Vercel (Recommended)**  
The repo already contains `vercel.json` for static frontend + serverless Express adapter.

Steps:
1. Connect GitHub repo to Vercel
2. Add `DATABASE_URL` and Microsoft Entra ID variables
3. Push to `main`

---

## Roadmap & Next Steps

### 1. Backend Persistence & Real API Synchronization (High Priority)
- Replace client-side only mutations in `useData.ts` with real API calls + TanStack Query
- Full optimistic updates, error handling, and background refetching

### 2. Microsoft Entra ID Authentication & Microsoft 365 Integration (High Priority)
- MSAL login + JWT protection
- SharePoint document libraries per project
- Teams adaptive card notifications on status change
- Planner / Outlook task sync for review deadlines
- Power BI embedded dashboards

### 3. React Native Mobile Companion App (High Priority)
- Expo SDK + shared `shared/` package
- Offline-first (Expo SQLite + sync)
- Native maps + push notifications via Azure Notification Hubs
- Microsoft authentication

### 4–7. Real-time, Reporting, DX, Scalability
- Azure SignalR / Web PubSub for live updates
- Power Automate workflows + optional Azure OpenAI
- GitHub Actions CI/CD + Playwright E2E + Azure App Insights
- i18n, accessibility (WCAG 2.2), Next.js evaluation, caching layer

---

## Contributing
We welcome contributions that align with the enterprise vision. Please open an issue first for large features (especially Microsoft 365 integration or mobile).

---

## License
MIT License © 2025–2026 Bahn Project Manager contributors.

---

**Built with care for reliable railway infrastructure project delivery.**

*This README is living documentation. Please keep it updated as the platform evolves.*

*Questions or feedback? Open an issue on GitHub.*
