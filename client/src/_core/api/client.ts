/**
 * client.ts — API Client & Mock Backend (UPDATED FOR PERFECT data.json INTEGRATION)
 * 
 * Handles data fetching, persistence, and simulated server procedures.
 * Now prioritizes local /data.json for maximum reliability and consistency.
 * 
 * Project fields match Excel Übersichtsliste column structure exactly.
 */

import { DEPARTMENTS } from "@shared/validation";
import { AUDIT_ACTIONS } from "@shared/audit-actions";
import type { ProjectChecklist } from "@shared/validation";
import type { Project, Review, Stats, AuditLogEntry } from "@/hooks/useDataQuery";
import { describeIngest, ingestProjects } from "@shared/ingest";
import { ProjectSchema, ReviewSchema } from "@shared/validation";

export interface ProjectUpdateInput {
  id: number;
  field: keyof Omit<Project, "id" | "reviews">;
  value: string;
}

export interface ReviewUpdateInput {
  projectId: number;
  department: string;
  field: keyof Review;
  value: string;
}

export interface ProjectCreateInput {
  projektnummer?: string;
  bahnhofsmanagement?: string;
  station?: string;
  bahnhofsnummer?: string;
  streckennummer?: string;
  projektbeschreibung?: string;
  projektstand?: string;
  projektleiter?: string;
  terminProjektvorstellung?: string;
  kommentar?: string;
  projektLink?: string;
  /** set by the Projektanmeldung wizard — the 14 reviews its checklist decided */
  reviews?: Review[];
}

/**
 * Bump SCHEMA_VERSION whenever the shape or the vocabulary of data.json changes.
 * The suffix makes every browser drop its stale cached copy and re-seed from the
 * new file, instead of keeping pre-normalisation values forever (a project
 * edited once used to freeze the whole dataset in localStorage).
 *
 * v2: Stage 1 — canonical Bahnhofsmanagement, string bahnhofsnummer /
 *     streckennummer, whitespace-normalised text fields.
 * v3: Stage 2 — terminProjektvorstellung and reviews[].pruefDatum converted
 *     from German dd.mm.yyyy to ISO yyyy-mm-dd.
 */
const SCHEMA_VERSION = 3;
const STORAGE_KEY_PROJECTS = `bahn_projects_v${SCHEMA_VERSION}`;
const STORAGE_KEY_AUDIT = "bahn_audit_log";
const STORAGE_KEY_CHECKLISTS = `bahn_checklists_v${SCHEMA_VERSION}`;

/** Remove caches written by earlier schema versions so they cannot be resurrected. */
function purgeLegacyCaches() {
  try {
    localStorage.removeItem("bahn_projects");
    for (let v = 1; v < SCHEMA_VERSION; v++) localStorage.removeItem(`bahn_projects_v${v}`);
  } catch {
    // private mode / quota — nothing to clean up, and nothing that should break boot
  }
}

// Local-first data source (served automatically by Vercel from public/data.json)
const LOCAL_DATA_JSON_URL = "/data.json";

// --- Data normalization ----------------------------------------------------
// Source data (Excel import) contains trailing whitespace ("Frankfurt ") and
// placeholder tokens ("???", "Bitte auswählen") that break exact-match filters
// and pollute dropdowns. Normalize once, at the single read chokepoint, so that
// filter options, `===` filtering, and display are always consistent.
// PLACEHOLDER_TOKENS and cleanStr moved to shared/ingest.ts. The copy that
// lived here recognised 6 placeholders; the workbook also produces "-", "--",
// "?", "??", "undefined" and "Bitte ausfüllen", which this copy passed through
// as if they were real values. One list now, and it is the longer one.

/**
 * Validate, then normalize. This used to be `(projects: any[])` ending in
 * `as Project[]` — an assertion, not a check: whatever arrived became a
 * Project as far as the compiler was concerned.
 *
 * ingestProjects() runs the payload through ProjectSchema (49 ms for all
 * 1,298 rows) and hands back the rows that passed plus the ones that did not,
 * so a malformed row is reported rather than rendered as a half-empty card.
 */
function normalizeProjects(raw: unknown): Project[] {
  const result = ingestProjects(raw);
  if (!result.clean) {
    console.warn(`[data] ${describeIngest(result)}`);
  }
  return result.projects as unknown as Project[];
}

async function initializeStorage() {
  purgeLegacyCaches();
  const stored = localStorage.getItem(STORAGE_KEY_PROJECTS);
  if (stored) {
    try {
      const cached = ingestProjects(JSON.parse(stored));
      // A cache written by an older build can hold a shape this build no
      // longer understands. Serving it forever is how a single browser ends up
      // quietly disagreeing with every other one, so a cache that does not
      // validate cleanly is discarded and refetched rather than trusted.
      if (cached.projects.length > 0) {
        if (!cached.clean) {
          // Keep the rows that validated rather than discarding the cache.
          // Refetching would replace every local edit with the shipped
          // snapshot to punish one bad row, which is a far larger loss than
          // the row itself. Writes are validated now, so a bad row here means
          // the cache was corrupted from outside the app.
          console.warn(`[data] ${describeIngest(cached)} — keeping the valid rows`);
          localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(cached.projects));
        }
        return cached.projects;
      }
      console.warn("[data] cache held no usable rows; reloading from /data.json");
      localStorage.removeItem(STORAGE_KEY_PROJECTS);
    } catch (_e) {
      console.warn("[data] cache is not valid JSON; reloading from /data.json");
      localStorage.removeItem(STORAGE_KEY_PROJECTS);
    }
  }

  try {
    // 1. Try local /data.json first (fastest + most reliable)
    const res = await fetch(LOCAL_DATA_JSON_URL);
    if (res.ok) {
      const result = ingestProjects(await res.json());
      // Cache only what validated. Writing the raw payload back would put the
      // bad rows straight into the cache we just taught ourselves to distrust.
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(result.projects));
      console.log(`[data] /data.json — ${describeIngest(result)}`);
      return result.projects;
    }
  } catch (_err) {
    console.warn("Local /data.json not available, trying remote fallback...");
  }

  // 2. Fallback to remote GitHub raw (original behavior)
  try {
    const res = await fetch("https://raw.githubusercontent.com/iceccarelli/bahn-project-manager/refs/heads/main/client/public/data.json");
    const result = ingestProjects(await res.json());
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(result.projects));
    console.log(`[data] remote fallback — ${describeIngest(result)}`);
    return result.projects;
  } catch (err) {
    console.error("Failed to load any data source:", err);
    return [];
  }
}

function recordAudit(action: string, details: string) {
  const user = JSON.parse(localStorage.getItem("bahn-demo-user") || '{"name":"System"}');
  const audit = JSON.parse(localStorage.getItem(STORAGE_KEY_AUDIT) || "[]");
  const entry: AuditLogEntry = {
    id: Math.random().toString(36).substring(7),
    timestamp: new Date().toISOString(),
    user: user.name,
    action,
    details,
  };
  audit.unshift(entry);
  localStorage.setItem(STORAGE_KEY_AUDIT, JSON.stringify(audit.slice(0, 1000)));
  return entry;
}

export const apiClient = {
  projects: {
    async list(): Promise<Project[]> {
      return normalizeProjects(await initializeStorage());
    },

    async get(id: number): Promise<Project | null> {
      const projects = await this.list();
      return projects.find((p) => p.id === id) || null;
    },

    async create(input: ProjectCreateInput): Promise<Project> {
      const projects = await this.list();
      const maxId = projects.length > 0 ? Math.max(...projects.map((p) => p.id)) : 0;

      const newProject: Project = {
        id: maxId + 1,
        projektnummer: input.projektnummer || null,
        bahnhofsmanagement: input.bahnhofsmanagement || null,
        station: input.station || null,
        bahnhofsnummer: input.bahnhofsnummer || null,
        streckennummer: input.streckennummer || null,
        projektbeschreibung: input.projektbeschreibung || null,
        projektstand: input.projektstand || null,
        projektleiter: input.projektleiter || null,
        terminProjektvorstellung: input.terminProjektvorstellung || null,
        kommentar: input.kommentar || null,
        projektLink: input.projektLink || null,
        // Reviews come from the caller when a checklist decided them; otherwise
        // all 14 are created empty. DEPARTMENTS is the shared list — this used
        // to be a fourth hard-coded copy of the same 14 strings.
        reviews:
          input.reviews ??
          DEPARTMENTS.map((dept) => ({
            department: dept,
            status: null,
            prueferName: null,
            pruefDatum: null,
          })),
      };

      projects.push(newProject);
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
      recordAudit(
        AUDIT_ACTIONS.projektAngelegt,
        `Projekt ${newProject.projektnummer} (${newProject.station}) angelegt.`,
      );

      window.dispatchEvent(new StorageEvent("storage", {
        key: STORAGE_KEY_PROJECTS,
        newValue: JSON.stringify(projects),
      }));

      return newProject;
    },

    async update(input: ProjectUpdateInput): Promise<Project> {
    const projects = await this.list();
    const index = projects.findIndex((p) => p.id === input.id);
    if (index === -1) throw new Error("Project not found");
    const project = projects[index];
    if (!project) throw new Error("Project not found");
    const oldVal = project[input.field];
    const candidate = { ...project, [input.field]: input.value };

    // Validate BEFORE persisting. Without this the write path accepted values
    // the read path rejects — a comment over ProjectSchema's 5,000-character
    // limit saved happily, and then on the next load ingestProjects rejected
    // that row, the cache was judged untrustworthy, and *every* local edit went
    // with it. One over-long comment silently discarded the lot.
    const check = ProjectSchema.safeParse(candidate);
    if (!check.success) {
      const issue = check.error.issues[0];
      throw new Error(
        `${input.field} ist ungültig: ${issue?.message ?? "Wert nicht zulässig"}`,
      );
    }

    Object.assign(project, { [input.field]: input.value });
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    recordAudit(
      AUDIT_ACTIONS.projektAktualisiert,
      `Feld ${input.field} von ${oldVal} auf ${input.value} geändert.`,
    );
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY_PROJECTS, newValue: JSON.stringify(projects) }));
    return project;
  },

    async delete(id: number): Promise<void> {
      const projects = await this.list();
      const filtered = projects.filter((p) => p.id !== id);
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(filtered));
      recordAudit(AUDIT_ACTIONS.projektGeloescht, `Projekt ID ${id} entfernt.`);

      window.dispatchEvent(new StorageEvent("storage", {
        key: STORAGE_KEY_PROJECTS,
        newValue: JSON.stringify(filtered),
      }));
    },

  },

  reviews: {
    async update(input: ReviewUpdateInput): Promise<Project> {
    const projects = await apiClient.projects.list();
    const index = projects.findIndex((p) => p.id === input.projectId);
    if (index === -1) throw new Error("Project not found");
    const project = projects[index];
    if (!project || !project.reviews) throw new Error("Project or reviews not found");
    const reviewIndex = project.reviews.findIndex((r) => r.department === input.department);
    if (reviewIndex === -1) throw new Error("Review not found");
    const existingReview = project.reviews[reviewIndex];
    if (!existingReview) throw new Error("Review not found");
    const oldVal = existingReview[input.field];
    const candidateReview = { ...existingReview, [input.field]: input.value };

    // Same gate as the project path: the review is validated before it is
    // persisted, so the write can never produce a row the read will reject.
    const reviewCheck = ReviewSchema.safeParse(candidateReview);
    if (!reviewCheck.success) {
      const issue = reviewCheck.error.issues[0];
      throw new Error(
        `${input.field} ist ungültig: ${issue?.message ?? "Wert nicht zulässig"}`,
      );
    }

    project.reviews[reviewIndex] = candidateReview;
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    recordAudit(
      AUDIT_ACTIONS.pruefungAktualisiert,
      `${input.department}: ${input.field} von ${oldVal} auf ${input.value} gesetzt.`,
    );
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY_PROJECTS, newValue: JSON.stringify(projects) }));
    return project;
  },
  },

  dashboard: {
    async getStats(): Promise<Stats> {
      const projects = await apiClient.projects.list();
      const statusDistribution: Record<string, number> = {};
      const regionStats: Record<string, number> = {};
      const prueferWorkload: Record<string, number> = {};
      const departmentStats: Array<{ department: string; status: string; count: number }> = [];

      projects.forEach((p) => {
        if (p.bahnhofsmanagement) regionStats[p.bahnhofsmanagement] = (regionStats[p.bahnhofsmanagement] || 0) + 1;
        p.reviews.forEach((r) => {
          if (r.status) statusDistribution[r.status] = (statusDistribution[r.status] || 0) + 1;
          if (r.prueferName) prueferWorkload[r.prueferName] = (prueferWorkload[r.prueferName] || 0) + 1;
          departmentStats.push({ department: r.department, status: r.status || "Offen", count: 1 });
        });
      });

      return {
        totalProjects: projects.length,
        statusDistribution: Object.entries(statusDistribution).map(([status, count]) => ({ status, count })),
        regionStats: Object.entries(regionStats).map(([region, count]) => ({ region, count })),
        prueferWorkload: Object.entries(prueferWorkload).map(([name, count]) => ({ name, count })),
        departmentStats,
      };
    },
  },

  /**
   * Projektanmeldung checklists. Same local-first storage as everything else:
   * drafts and submissions live in localStorage until the backend is deployed.
   */
  checklists: {
    async list(): Promise<ProjectChecklist[]> {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_CHECKLISTS);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        console.warn("Corrupted checklist storage — starting empty");
        return [];
      }
    },

    async get(id: number): Promise<ProjectChecklist | null> {
      return (await this.list()).find((c) => c.id === id) ?? null;
    },

    /** Create or update a draft. Returns the stored checklist, with its id. */
    async save(input: ProjectChecklist): Promise<ProjectChecklist> {
      const all = await this.list();
      const now = new Date().toISOString();
      let saved: ProjectChecklist;

      if (input.id != null) {
        const index = all.findIndex((c) => c.id === input.id);
        if (index === -1) throw new Error(`Checklist ${input.id} not found`);
        const existing = all[index];
        if (!existing) throw new Error(`Checklist ${input.id} not found`);
        // Optimistic locking: refuse to overwrite a newer version rather than
        // silently clobbering it.
        if (input.syncVersion != null && existing.syncVersion !== input.syncVersion) {
          throw new Error(
            `Checkliste wurde zwischenzeitlich geändert (v${existing.syncVersion} statt v${input.syncVersion}). Bitte neu laden.`,
          );
        }
        saved = { ...existing, ...input, syncVersion: (existing.syncVersion ?? 1) + 1, updatedAt: now };
        all[index] = saved;
      } else {
        const maxId = all.reduce((n, c) => Math.max(n, c.id ?? 0), 0);
        saved = { ...input, id: maxId + 1, syncVersion: 1, createdAt: now, updatedAt: now };
        all.push(saved);
      }

      localStorage.setItem(STORAGE_KEY_CHECKLISTS, JSON.stringify(all));
      return saved;
    },

    async remove(id: number): Promise<void> {
      const all = (await this.list()).filter((c) => c.id !== id);
      localStorage.setItem(STORAGE_KEY_CHECKLISTS, JSON.stringify(all));
    },
  },

  audit: {
    async list(): Promise<AuditLogEntry[]> {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_AUDIT) || "[]");
    },

    async record(action: string, details: string): Promise<AuditLogEntry> {
      const entry = recordAudit(action, details);
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY_AUDIT }));
      return entry;
    },
  },
};
