/**
 * Demo credentials. Kept in their own module and loaded ONLY by a dynamic import when demo login is
 * explicitly allowed, so the code-split server bundle keeps them out of the main entry chunk
 * (scripts/gate/deploy-gate.mjs asserts the entry chunk contains no demo password).
 */
export const DEMO_USERS = [
  { openId: "demo-admin-001", name: "Admin Demo", email: "admin@bahn.de", role: "admin" as const, password: "admin" },
  { openId: "demo-user-001", name: "Prüfer Demo", email: "pruefer@bahn.de", role: "user" as const, password: "user" },
];
