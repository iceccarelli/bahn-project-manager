import type { Principal } from "./permissions";

export const admin: Principal = { id: "1", name: "Ada Admin", email: "ada@bahn.de", role: "admin", workspaces: "ALL", departments: [] };
export const markus: Principal = { id: "2", name: "Markus", email: "m@bahn.de", role: "editor", workspaces: "ALL", departments: ["ITK"] };
export const lena: Principal = { id: "3", name: "Lena", email: "l@bahn.de", role: "editor", workspaces: "ALL", departments: ["EEA"] };
export const viewer: Principal = { id: "4", name: "Vic", email: "v@bahn.de", role: "viewer", workspaces: "ALL", departments: [] };
export const mitteOnly: Principal = { id: "5", name: "Mia", email: "mia@bahn.de", role: "editor", workspaces: ["Frankfurt"], departments: [] };
export const ctx = (traceId = "trace-test-0001") => ({ traceId });
