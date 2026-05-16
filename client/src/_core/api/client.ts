/**
 * client.ts — API Client & Mock Backend
 * 
 * Handles data fetching, persistence, and simulated server procedures.
 * Integrated with your provided data.json URL for initial source of truth.
 */

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
  projektleiter?: string;
  kommentar?: string;
  projektLink?: string;
}

const STORAGE_KEY_PROJECTS = "bahn_projects";
const STORAGE_KEY_AUDIT = "bahn_audit_log";
const DATA_JSON_URL = "https://raw.githubusercontent.com/iceccarelli/bahn-project-manager/refs/heads/main/client/public/data.json";

async function initializeStorage() {
  const stored = localStorage.getItem(STORAGE_KEY_PROJECTS);
  if (stored) return JSON.parse(stored);

  try {
    const res = await fetch(DATA_JSON_URL);
    const data = await res.json();
    const projects = data.projects || data; // Handle both {projects:[]} and []
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    return projects;
  } catch (err) {
    console.error("Failed to initialize storage from remote JSON:", err);
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
}

export const apiClient = {
  projects: {
    async list(): Promise<Project[]> {
      return await initializeStorage();
    },

    async get(id: number): Promise<Project | null> {
      const projects = await this.list();
      return projects.find((p) => p.id === id) || null;
    },

    async create(input: ProjectCreateInput): Promise<Project> {
      const projects = await this.list();
      const maxId = projects.length > 0 ? Math.max(...projects.map((p) => p.id)) : 0;

      const ALL_DEPARTMENTS = [
        "EEA", "ITK", "GA", "Energie", "HFT", "HKLS", "TBQ", "BS",
        "UM", "BIM", "LST", "Vermessung", "Baubetriebstechnologie", "Baubetriebsplanung",
      ];

      const newProject: Project = {
        id: maxId + 1,
        projektnummer: input.projektnummer || null,
        bahnhofsmanagement: input.bahnhofsmanagement || null,
        station: input.station || null,
        projektbeschreibung: input.projektbeschreibung || null,
        projektleiter: input.projektleiter || null,
        kommentar: input.kommentar || null,
        projektLink: input.projektLink || null,
        reviews: ALL_DEPARTMENTS.map((dept) => ({
          department: dept,
          status: null,
          prueferName: null,
          pruefDatum: null,
          kommentar: null,
        })),
      };

      projects.unshift(newProject);
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

      const oldVal = (projects[index] as any)[input.field];
      (projects[index] as any)[input.field] = input.value;

      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
      recordAudit("Projekt aktualisiert", `Feld '${input.field}' von '${oldVal}' auf '${input.value}' geändert.`);

      window.dispatchEvent(new StorageEvent("storage", {
        key: STORAGE_KEY_PROJECTS,
        newValue: JSON.stringify(projects),
      }));

      return projects[index];
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
  },

  reviews: {
    async update(input: ReviewUpdateInput): Promise<Project> {
      const projects = await apiClient.projects.list();
      const index = projects.findIndex((p) => p.id === input.projectId);
      if (index === -1) throw new Error("Project not found");

      const reviewIndex = projects[index].reviews.findIndex((r) => r.department === input.department);
      if (reviewIndex === -1) throw new Error("Review not found");

      const oldVal = (projects[index].reviews[reviewIndex] as any)[input.field];
      projects[index].reviews[reviewIndex] = {
        ...projects[index].reviews[reviewIndex],
        [input.field]: input.value,
      };

      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
      recordAudit("Prüfung aktualisiert", `${input.department}: ${input.field} von '${oldVal}' auf '${input.value}' gesetzt.`);

      window.dispatchEvent(new StorageEvent("storage", {
        key: STORAGE_KEY_PROJECTS,
        newValue: JSON.stringify(projects),
      }));

      return projects[index];
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
  },
};
