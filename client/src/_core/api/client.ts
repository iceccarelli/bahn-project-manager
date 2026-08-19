/**
 * client.ts — API Client & Mock Backend (UPDATED FOR PERFECT data.json INTEGRATION)
 * 
 * Handles data fetching, persistence, and simulated server procedures.
 * Now prioritizes local /data.json for maximum reliability and consistency.
 * 
 * Project fields match Excel Übersichtsliste column structure exactly.
 */

import { normalizeBahnhofsmanagement } from "@shared/bahnhofsmanagement";
import type { Project, Review, Stats, AuditLogEntry } from "@/hooks/useDataQuery";

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
const PLACEHOLDER_TOKENS = new Set(["", "???", "n/a", "na", "null", "bitte auswählen"]);

function cleanStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (PLACEHOLDER_TOKENS.has(s.toLowerCase())) return null;
  return s;
}

function normalizeProjects(projects: any[]): Project[] {
  if (!Array.isArray(projects)) return [];
  return projects.map((p) => ({
    ...p,
    // Canonical BM, so `===` region filters, the station cascade and the map all
    // agree. scripts/normalize-existing-data.ts already cleans data.json; this
    // is the second line of defence for rows created before Stage 1 or edited
    // by hand. Never guesses — an unknown value becomes null.
    bahnhofsmanagement: normalizeBahnhofsmanagement(p?.bahnhofsmanagement).value,
    station: cleanStr(p?.station),
    projektleiter: cleanStr(p?.projektleiter),
    projektstand: cleanStr(p?.projektstand),
    projektnummer: cleanStr(p?.projektnummer),
    reviews: Array.isArray(p?.reviews)
      ? p.reviews.map((r: any) => ({
          ...r,
          prueferName: cleanStr(r?.prueferName),
          status: cleanStr(r?.status),
        }))
      : [],
  })) as Project[];
}

async function initializeStorage() {
  purgeLegacyCaches();
  const stored = localStorage.getItem(STORAGE_KEY_PROJECTS);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.warn("Corrupted localStorage, reloading from data.json");
    }
  }

  try {
    // 1. Try local /data.json first (fastest + most reliable)
    const res = await fetch(LOCAL_DATA_JSON_URL);
    if (res.ok) {
      const data = await res.json();
      const projects = data.projects || data;
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
      console.log(`✅ Loaded ${projects.length} projects from local /data.json`);
      return projects;
    }
  } catch (err) {
    console.warn("Local /data.json not available, trying remote fallback...");
  }

  // 2. Fallback to remote GitHub raw (original behavior)
  try {
    const res = await fetch("https://raw.githubusercontent.com/iceccarelli/bahn-project-manager/refs/heads/main/client/public/data.json");
    const data = await res.json();
    const projects = data.projects || data;
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    return projects;
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

      const ALL_DEPARTMENTS = [
        "EEA", "ITK", "BS", "GA", "Energie", "HFT", "HKLS", "TBQ",
        "UM", "BIM", "LST", "Vermessung", "Baubetriebstechnologie", "Baubetriebsplanung",
      ];

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
        reviews: ALL_DEPARTMENTS.map((dept) => ({
          department: dept,
          status: null,
          prueferName: null,
          pruefDatum: null,
        })),
      };

      projects.push(newProject);
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
      recordAudit("Projekt erstellt", `Projekt ${newProject.projektnummer} (${newProject.station}) angelegt.`);

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
    const oldVal = (project as any)[input.field];
    (project as any)[input.field] = input.value;
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    recordAudit("Projekt aktualisiert", `Feld ${input.field} von ${oldVal} auf ${input.value} geändert.`);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY_PROJECTS, newValue: JSON.stringify(projects) }));
    return project;
  },

    async delete(id: number): Promise<void> {
      const projects = await this.list();
      const filtered = projects.filter((p) => p.id !== id);
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(filtered));
      recordAudit("Projekt gelöscht", `Projekt ID ${id} entfernt.`);

      window.dispatchEvent(new StorageEvent("storage", {
        key: STORAGE_KEY_PROJECTS,
        newValue: JSON.stringify(filtered),
      }));
    },

    async searchSuggestions(term: string): Promise<string[]> {
      const projects = await this.list();
      if (!term || term.length < 2) return [];
      const lower = term.toLowerCase();
      const suggestions = new Set<string>();

      for (const p of projects) {
        if (String(p.station ?? "").toLowerCase().includes(lower)) suggestions.add(String(p.station));
        if (String(p.projektnummer ?? "").toLowerCase().includes(lower)) suggestions.add(String(p.projektnummer));
        if (String(p.projektleiter ?? "").toLowerCase().includes(lower)) suggestions.add(String(p.projektleiter));
        if (String(p.bahnhofsmanagement ?? "").toLowerCase().includes(lower)) suggestions.add(String(p.bahnhofsmanagement));
        if (String(p.projektstand ?? "").toLowerCase().includes(lower)) suggestions.add(String(p.projektstand));
        for (const r of p.reviews || []) {
          if (String(r.prueferName ?? "").toLowerCase().includes(lower)) suggestions.add(String(r.prueferName));
          if (String(r.department ?? "").toLowerCase().includes(lower)) suggestions.add(String(r.department));
        }
        if (suggestions.size >= 10) break;
      }

      return Array.from(suggestions).slice(0, 10);
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
    const oldVal = (existingReview as any)[input.field];
    project.reviews[reviewIndex] = {
      ...existingReview,
      [input.field]: input.value,
    };
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    recordAudit("Prüfung aktualisiert", `${input.department}: ${input.field} von ${oldVal} auf ${input.value} gesetzt.`);
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
