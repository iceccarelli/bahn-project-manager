/**
 * Department subscriptions — the user-facing and administrative side of server/domain/departmentNotifications.ts.
 *
 *   mine        what the caller may follow (eligibility from the CURRENT principal), and the effective state per department.
 *   set         the caller's own explicit decision (an "off" survives sign-ins, imports and re-provisioning: it is a row, not a default).
 *   setForUser  an administrator's decision for another user, audited like the provisioner's grant rows (`entityType user`, `entityId users.id`, field `subscription.<Gewerk>`).
 *
 * Nothing here grants access: eligibility is derived from the grant the token carries, delivery re-checks it.
 */
import { DEPARTMENTS } from "@shared/validation";
import type { DepartmentSubscriptionDTO } from "@shared/notification-contract";
import { eligibleForDepartment, grantFromSnapshot, isSubscribed } from "./departmentNotifications";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { canManageUsers, type Principal } from "./permissions";
import type { ProjectStore } from "./ports";
import type { RequestContext } from "./projectService";

const canonical = (department: string): string => {
  const d = (DEPARTMENTS as readonly string[]).find((x) => x.toUpperCase() === department.toUpperCase());
  if (!d) throw new ValidationError(`Unbekanntes Gewerk: ${department}`, "department");
  return d;
};

export class SubscriptionService {
  constructor(private readonly store: ProjectStore) {}

  async mine(p: Principal): Promise<DepartmentSubscriptionDTO[]> {
    return this.listFor(p.id, p);
  }

  private async listFor(principalId: string, grant: Pick<Principal, "role" | "departments">): Promise<DepartmentSubscriptionDTO[]> {
    const rows = await this.store.subscriptionsOf(principalId);
    const byDept = new Map(rows.map((r) => [r.department.toUpperCase(), r]));
    return DEPARTMENTS.map((department) => {
      const row = byDept.get(department.toUpperCase()) ?? null;
      return {
        department,
        eligible: eligibleForDepartment(grant, department),
        subscribed: eligibleForDepartment(grant, department) && isSubscribed(grant, department, row),
        explicit: row ? { enabled: row.enabled, source: row.source, updatedAt: row.updatedAt } : null,
      };
    });
  }

  async set(p: Principal, input: { department: string; enabled: boolean }): Promise<DepartmentSubscriptionDTO[]> {
    const department = canonical(input.department);
    if (p.role === "viewer") throw new ForbiddenError("Keine Berechtigung");
    // turning ON needs eligibility now; turning OFF is always allowed (it can only narrow)
    if (input.enabled && !eligibleForDepartment(p, department)) throw new ForbiddenError(`Für ${department} liegt keine Freigabe vor`);
    await this.store.transaction((tx) => tx.setSubscription({ userId: p.id, department, enabled: input.enabled, source: "user" }));
    return this.mine(p);
  }

  /** administrator: the subscriptions of another user, judged against THAT user's stored grant */
  async ofUser(p: Principal, principalId: string): Promise<{ user: { principalId: string; name: string | null; email: string | null }; items: DepartmentSubscriptionDTO[] }> {
    if (!canManageUsers(p)) throw new ForbiddenError();
    const u = await this.store.grantOfPrincipal(principalId);
    if (!u) throw new NotFoundError("Benutzer");
    const grant = grantFromSnapshot(u.grantSnapshot) ?? { role: "viewer" as const, workspaces: [], departments: [] };
    return { user: { principalId: u.principalId, name: u.name, email: u.email }, items: await this.listFor(principalId, grant) };
  }

  async setForUser(p: Principal, input: { principalId: string; department: string; enabled: boolean }, ctx: RequestContext): Promise<DepartmentSubscriptionDTO[]> {
    if (!canManageUsers(p)) throw new ForbiddenError();
    const department = canonical(input.department);
    const u = await this.store.grantOfPrincipal(input.principalId);
    if (!u) throw new NotFoundError("Benutzer");
    await this.store.transaction(async (tx) => {
      const prev = await tx.setSubscription({ userId: input.principalId, department, enabled: input.enabled, source: "admin" });
      await tx.appendAudit([{
        userId: /^\d+$/.test(p.id) ? Number(p.id) : null, userName: p.name || p.email || p.id,
        entityType: "user", entityId: u.id, action: prev ? "update" : "create", field: `subscription.${department}`,
        oldValue: prev ? JSON.stringify(prev) : null, newValue: JSON.stringify({ enabled: input.enabled, source: "admin" }),
        eventId: null, aggregateVersion: null, traceId: ctx.traceId, workspace: null, entityLabel: (u.email || u.name || u.principalId).slice(0, 255),
      }]);
    });
    return (await this.ofUser(p, input.principalId)).items;
  }
}
