import { eq, sql, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import { type InsertUser, users, projects, departmentReviews } from "../drizzle/schema";
import { ENV } from './_core/env';

const makeDb = (pool: Pool) => drizzle({ client: pool });
let _db: ReturnType<typeof makeDb> | null = null;
let _pool: Pool | null = null;

/**
 * One explicit pool per process. Size and queue bound come from the
 * environment so capacity is a deployment decision, not a driver default:
 *   DB_POOL_SIZE   (default 10)   connections held by THIS process
 *   DB_QUEUE_LIMIT (default 200)  waiting acquisitions before failing fast
 * Total connections = instances x DB_POOL_SIZE; keep it under the server's
 * max_connections (see docs/scaling.md).
 */
export function getPool(): Pool | null {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
      queueLimit: Number(process.env.DB_QUEUE_LIMIT ?? 200),
      waitForConnections: true,
      timezone: "Z",
      dateStrings: false,
      charset: "utf8mb4",
    });
  }
  return _pool;
}

let _relayPool: Pool | null = null;

/**
 * Separate, tiny pool for background system work (outbox relay, metrics
 * sampling). If it shared the request pool, a traffic spike would starve the
 * relay and realtime delivery would stop exactly when load is highest.
 */
export function getRelayPool(): Pool | null {
  if (!_relayPool && process.env.DATABASE_URL) {
    _relayPool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      connectionLimit: Number(process.env.RELAY_POOL_SIZE ?? 3),
      queueLimit: 10,
      waitForConnections: true,
      timezone: "Z",
      charset: "utf8mb4",
    });
  }
  return _relayPool;
}

export async function getDb() {
  if (!_db) {
    const pool = getPool();
    if (pool) _db = makeDb(pool);
  }
  return _db;
}

export async function closeDb() {
  const pools = [_pool, _relayPool];
  _pool = null;
  _relayPool = null;
  _db = null;
  await Promise.all(pools.map(p => p?.end()));
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




// ============= DEPARTMENT REVIEW QUERIES =============

// ============= DASHBOARD STATISTICS =============

// ============= AUDIT LOG =============


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
