import { eq, like, and, or, sql, desc, asc, inArray, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, projects, departmentReviews, bvbEea, psvItk, auditLog } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============= PROJECT QUERIES =============

export async function getProjects(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  region?: string;
  projektleiter?: string;
  department?: string;
  status?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  const db = await getDb();
  if (!db) return { projects: [], total: 0 };

  const { page = 1, pageSize = 50, search, region, projektleiter, sortBy = 'id', sortDir = 'asc' } = params;
  const offset = (page - 1) * pageSize;

  const conditions: any[] = [];

  if (search) {
    conditions.push(
      or(
        like(projects.projektnummer, `%${search}%`),
        like(projects.station, `%${search}%`),
        like(projects.projektbeschreibung, `%${search}%`),
        like(projects.projektleiter, `%${search}%`),
        like(projects.bahnhofsmanagement, `%${search}%`)
      )
    );
  }

  if (region) {
    conditions.push(eq(projects.bahnhofsmanagement, region));
  }

  if (projektleiter) {
    conditions.push(like(projects.projektleiter, `%${projektleiter}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await db
    .select({ total: count() })
    .from(projects)
    .where(whereClause);
  const total = countResult[0]?.total ?? 0;

  // Get paginated projects
  const sortColumn = (projects as any)[sortBy] || projects.id;
  const orderFn = sortDir === 'desc' ? desc : asc;

  const projectList = await db
    .select()
    .from(projects)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  return { projects: projectList, total };
}

export async function getProjectWithReviews(projectId: number) {
  const db = await getDb();
  if (!db) return null;

  const projectResult = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (projectResult.length === 0) return null;

  const reviews = await db
    .select()
    .from(departmentReviews)
    .where(eq(departmentReviews.projectId, projectId));

  return { ...projectResult[0], reviews };
}

export async function getProjectReviews(projectIds: number[]) {
  const db = await getDb();
  if (!db) return [];
  if (projectIds.length === 0) return [];

  return db
    .select()
    .from(departmentReviews)
    .where(inArray(departmentReviews.projectId, projectIds));
}

export async function updateProject(id: number, data: Partial<typeof projects.$inferInsert>) {
  const db = await getDb();
  if (!db) return;

  await db.update(projects).set(data).where(eq(projects.id, id));
}

export async function createProject(data: typeof projects.$inferInsert) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(projects).values(data);
  return result[0].insertId;
}

export async function deleteProject(id: number) {
  const db = await getDb();
  if (!db) return;

  await db.delete(departmentReviews).where(eq(departmentReviews.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
}

// ============= DEPARTMENT REVIEW QUERIES =============

export async function updateDepartmentReview(id: number, data: Partial<typeof departmentReviews.$inferInsert>) {
  const db = await getDb();
  if (!db) return;

  await db.update(departmentReviews).set(data).where(eq(departmentReviews.id, id));
}

export async function createDepartmentReview(data: typeof departmentReviews.$inferInsert) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(departmentReviews).values(data);
  return result[0].insertId;
}

// ============= DASHBOARD STATISTICS =============

export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;

  // Total projects
  const totalResult = await db.select({ total: count() }).from(projects);
  const totalProjects = totalResult[0]?.total ?? 0;

  // Status distribution across all departments
  const statusDist = await db
    .select({
      status: departmentReviews.status,
      count: count(),
    })
    .from(departmentReviews)
    .groupBy(departmentReviews.status);

  // Status per department
  const deptStats = await db
    .select({
      department: departmentReviews.department,
      status: departmentReviews.status,
      count: count(),
    })
    .from(departmentReviews)
    .groupBy(departmentReviews.department, departmentReviews.status);

  // Projects per region
  const regionStats = await db
    .select({
      region: projects.bahnhofsmanagement,
      count: count(),
    })
    .from(projects)
    .groupBy(projects.bahnhofsmanagement);

  // Prüfer workload (top 20)
  const prueferWorkload = await db
    .select({
      name: departmentReviews.prueferName,
      count: count(),
    })
    .from(departmentReviews)
    .where(
      and(
        sql`${departmentReviews.prueferName} IS NOT NULL`,
        sql`${departmentReviews.prueferName} != 'Zuordnung erforderlich'`
      )
    )
    .groupBy(departmentReviews.prueferName)
    .orderBy(desc(count()))
    .limit(20);

  return {
    totalProjects,
    statusDistribution: statusDist,
    departmentStats: deptStats,
    regionStats,
    prueferWorkload,
  };
}

// ============= BVB-EEA QUERIES =============

export async function getBvbEeaList() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(bvbEea).orderBy(desc(bvbEea.id));
}

export async function createBvbEea(data: typeof bvbEea.$inferInsert) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(bvbEea).values(data);
  return result[0].insertId;
}

export async function updateBvbEea(id: number, data: Partial<typeof bvbEea.$inferInsert>) {
  const db = await getDb();
  if (!db) return;

  await db.update(bvbEea).set(data).where(eq(bvbEea.id, id));
}

// ============= PSV-ITK QUERIES =============

export async function getPsvItkList() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(psvItk).orderBy(desc(psvItk.id));
}

export async function createPsvItk(data: typeof psvItk.$inferInsert) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(psvItk).values(data);
  return result[0].insertId;
}

export async function updatePsvItk(id: number, data: Partial<typeof psvItk.$inferInsert>) {
  const db = await getDb();
  if (!db) return;

  await db.update(psvItk).set(data).where(eq(psvItk.id, id));
}

// ============= AUDIT LOG =============

export async function createAuditEntry(data: typeof auditLog.$inferInsert) {
  const db = await getDb();
  if (!db) return;

  await db.insert(auditLog).values(data);
}

export async function getAuditLog(params: { entityType?: string; entityId?: number; limit?: number }) {
  const db = await getDb();
  if (!db) return [];

  const conditions: any[] = [];
  if (params.entityType) conditions.push(eq(auditLog.entityType, params.entityType));
  if (params.entityId) conditions.push(eq(auditLog.entityId, params.entityId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(params.limit ?? 100);
}

// ============= FILTER OPTIONS =============

export async function getFilterOptions() {
  const db = await getDb();
  if (!db) return { regions: [], projektleiter: [], pruefer: [] };

  const regions = await db
    .selectDistinct({ value: projects.bahnhofsmanagement })
    .from(projects)
    .where(sql`${projects.bahnhofsmanagement} IS NOT NULL AND ${projects.bahnhofsmanagement} != ''`)
    .orderBy(asc(projects.bahnhofsmanagement));

  const projektleiterList = await db
    .selectDistinct({ value: projects.projektleiter })
    .from(projects)
    .where(sql`${projects.projektleiter} IS NOT NULL AND ${projects.projektleiter} != ''`)
    .orderBy(asc(projects.projektleiter));

  const prueferList = await db
    .selectDistinct({ value: departmentReviews.prueferName })
    .from(departmentReviews)
    .where(
      sql`${departmentReviews.prueferName} IS NOT NULL AND ${departmentReviews.prueferName} != '' AND ${departmentReviews.prueferName} != 'Zuordnung erforderlich'`
    )
    .orderBy(asc(departmentReviews.prueferName));

  return {
    regions: regions.map(r => r.value).filter(Boolean) as string[],
    projektleiter: projektleiterList.map(p => p.value).filter(Boolean) as string[],
    pruefer: prueferList.map(p => p.value).filter(Boolean) as string[],
  };
}
