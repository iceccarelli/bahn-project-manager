import type { Project, Review, Stats, Filters } from "@/hooks/useDataQuery";

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

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  user: string;
  action: string;
  projectId: number;
  changes: Record<string, { old: string | null; new: string | null }>;
}

const STORAGE_KEY_PROJECTS = "bahn_projects";
const STORAGE_KEY_AUDIT = "bahn_audit_log";
const STORAGE_KEY_VERSION = "bahn_data_version";
const DATA_JSON_URL = "https://raw.githubusercontent.com/iceccarelli/bahn-project-manager/refs/heads/main/client/public/data.json";

async function initializeStorage( ) {
  if (!localStorage.getItem(STORAGE_KEY_PROJECTS)) {
    try {
      const res = await fetch(DATA_JSON_URL);
      const data = await res.json();
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(data.projects));
      localStorage.setItem(STORAGE_KEY_VERSION, "1");
      return data.projects;
    } catch (err) {
      console.error("Failed to initialize storage from remote JSON:", err);
      return [];
    }
  }
  return JSON.parse(localStorage.getItem(STORAGE_KEY_PROJECTS) || "[]");
}

export const mockApi = {
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
      const ALL_DEPARTMENTS = ["EEA", "ITK", "GA", "Energie", "HFT", "HKLS", "TBQ", "BS", "UM", "BIM", "LST", "Vermessung", "Baubetriebstechnologie", "Baubetriebsplanung"];
      const newProject: Project = {
        id: maxId + 1,
        projektnummer: input.projektnummer || null,
        bahnhofsmanagement: input.bahnhofsmanagement || null,
        station: input.station || null,
        bahnhofsnummer: input.bahnhofsnummer || null,
        streckennummer: input.streckennummer || null,
        projektbeschreibung: input.projektbeschreibung || null,
        projektleiter: input.projektleiter || null,
        kommentar: input.kommentar || null,
        projektLink: input.projektLink || null,
        reviews: ALL_DEPARTMENTS.map((dept) => ({ department: dept, status: null, prueferName: null, pruefDatum: null })),
      };
      projects.push(newProject);
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
      this.recordAudit("CREATE", newProject.id, { "created": { old: null, new: "true" } });
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY_PROJECTS, newValue: JSON.stringify(projects) }));
      return newProject;
    },
    async update(input: ProjectUpdateInput): Promise<Project | null> {
      const projects = await this.list();
      const project = projects.find((p) => p.id === input.id);
      if (!project) return null;
      const oldValue = (project as any)[input.field];
      (project as any)[input.field] = input.value;
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
      this.recordAudit("UPDATE", input.id, { [input.field]: { old: oldValue, new: input.value } });
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY_PROJECTS, newValue: JSON.stringify(projects) }));
      return project;
    },
    async delete(id: number): Promise<boolean> {
      const projects = await this.list();
      const index = projects.findIndex((p) => p.id === id);
      if (index === -1) return false;
      projects.splice(index, 1);
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
      this.recordAudit("DELETE", id, { "deleted": { old: "true", new: null } });
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY_PROJECTS, newValue: JSON.stringify(projects) }));
      return true;
    },
    recordAudit(action: string, projectId: number, changes: Record<string, any>) {
      const audit = localStorage.getItem(STORAGE_KEY_AUDIT);
      const auditLog: AuditLogEntry[] = audit ? JSON.parse(audit) : [];
      auditLog.push({ id: auditLog.length + 1, timestamp: new Date().toISOString(), user: "Demo User", action, projectId, changes });
      localStorage.setItem(STORAGE_KEY_AUDIT, JSON.stringify(auditLog));
    },
  },
  reviews: {
    async update(input: ReviewUpdateInput): Promise<Review | null> {
      const projects = await mockApi.projects.list();
      const project = projects.find((p) => p.id === input.projectId);
      if (!project) return null;
      let review = project.reviews.find((r) => r.department === input.department);
      if (!review) {
        review = { department: input.department, status: null, prueferName: null, pruefDatum: null };
        project.reviews.push(review);
      }
      const oldValue = (review as any)[input.field];
      (review as any)[input.field] = input.value;
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
      mockApi.projects.recordAudit("UPDATE_REVIEW", input.projectId, { [`${input.department}.${input.field}`]: { old: oldValue, new: input.value } });
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY_PROJECTS, newValue: JSON.stringify(projects) }));
      return review;
    },
  },
  dashboard: {
    async getStats(): Promise<Stats> {
      const projects = await mockApi.projects.list();
      const statusDistribution: Record<string, number> = {};
      const regionStats: Record<string, number> = {};
      const prueferWorkload: Record<string, number> = {};
      const departmentStats: Array<{ department: string; status: string; count: number }> = [];
      projects.forEach((project) => {
        project.reviews.forEach((review) => {
          if (review.status) statusDistribution[review.status] = (statusDistribution[review.status] || 0) + 1;
          departmentStats.push({ department: review.department, status: review.status || "Nicht gestartet", count: 1 });
          if (review.prueferName) prueferWorkload[review.prueferName] = (prueferWorkload[review.prueferName] || 0) + 1;
        });
        if (project.bahnhofsmanagement) regionStats[project.bahnhofsmanagement] = (regionStats[project.bahnhofsmanagement] || 0) + 1;
      });
      return { totalProjects: projects.length, statusDistribution: Object.entries(statusDistribution).map(([status, count]) => ({ status, count })), regionStats: Object.entries(regionStats).map(([region, count]) => ({ region, count })), prueferWorkload: Object.entries(prueferWorkload).map(([name, count]) => ({ name, count })), departmentStats };
    },
  },
  audit: {
    async list(): Promise<AuditLogEntry[]> {
      const audit = localStorage.getItem(STORAGE_KEY_AUDIT);
      return audit ? JSON.parse(audit) : [];
    },
  },
};

export const apiClient = mockApi;
