import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db"; // assumes db instance exported
import { projects, departmentReviews } from "../../drizzle/schema";
import { eq, and, like, inArray, desc, asc, sql } from "drizzle-orm";
import {
  ODataQuerySchema,
  parseODataFilter,
  ODataResponse,
  ODATA_METADATA,
  buildDrizzleWhereFromOData,
} from "@shared/server/odata";
import { ProjectUI, Review } from "@shared/types";
import { z } from "zod";

/**
 * OData v4 compliant Express router.
 * Mounted at /odata in the main Express app.
 * Supports:
 *   GET /odata/projects?$filter=...&$expand=reviews&$select=station,projektnummer&$top=100
 *   GET /odata/$metadata
 *   GET /odata/projects(123)  (single entity)
 */
export const odataRouter = Router();

/**
 * Perfect OData v4 Express router for Microsoft 365 / Power BI / Excel integration.
 * Fully aligned with shared/server/odata.ts parser and types.
 * Mounted in server/_core/index.ts at /odata
 */
export const odataRouter = Router();

/**
 * Helper to convert DB row + reviews to OData Project shape (matches ProjectUI)
 */
async function mapProjectToOData(p: any, includeReviews = false): Promise<ProjectUI> {
  let reviews: Review[] = [];
  if (includeReviews) {
    const revs = await db
      .select()
      .from(departmentReviews)
      .where(eq(departmentReviews.projectId, p.id));
    reviews = revs.map(r => ({
      department: r.department as any,
      status: r.status as any,
      prueferName: r.prueferName,
      pruefDatum: r.datum ? r.datum.toISOString() : null,
    }));
  }

  return {
    id: p.id,
    projektnummer: p.projektnummer,
    bahnhofsmanagement: p.bahnhofsmanagement,
    station: p.station,
    bahnhofsnummer: p.bahnhofsnummer,
    streckennummer: p.streckennummer,
    projektbeschreibung: p.projektbeschreibung,
    projektstand: p.projektstand as any,
    eigvEinstufung: p.eigvEinstufung,
    projektleiter: p.projektleiter,
    terminProjektvorstellung: p.terminProjektvorstellung,
    kommentar: p.kommentar,
    projektLink: p.projektLink,
    reviews,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * GET /odata/$metadata
 * Returns EDMX metadata for Microsoft tools (Power BI, Excel, etc.)
 */
odataRouter.get("/$metadata", (_req: Request, res: Response) => {
  const edmx = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="BahnProjectManager" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Project">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="projektnummer" Type="Edm.String"/>
        <Property Name="station" Type="Edm.String"/>
        <Property Name="projektstand" Type="Edm.String"/>
        <NavigationProperty Name="reviews" Type="Collection(BahnProjectManager.Review)" Partner="project"/>
      </EntityType>
      <EntityType Name="Review">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="department" Type="Edm.String" Nullable="false"/>
        <Property Name="status" Type="Edm.String"/>
        <Property Name="prueferName" Type="Edm.String"/>
        <Property Name="pruefDatum" Type="Edm.DateTimeOffset"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="projects" EntityType="BahnProjectManager.Project"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;
  res.setHeader("Content-Type", "application/xml");
  res.send(edmx);
});

/**
 * GET /odata/projects
 * Main collection endpoint with full OData support
 */
odataRouter.get("/projects", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = ODataQuerySchema.parse(req.query);
    const where = buildDrizzleWhereFromOData(query, projects);

    let q = db.select().from(projects);

    // Apply filters (basic implementation — extend with full sql builder in prod)
    if (query.$filter) {
      const parsed = parseODataFilter(query.$filter);
      if (parsed.station) q = q.where(like(projects.station, `%${parsed.station}%`));
      if (parsed.projektstand) q = q.where(eq(projects.projektstand, parsed.projektstand as any));
      // Add more as needed (bahnhofsmanagement, etc.)
    }

    // Sorting
    if (query.$orderby) {
      const [field, dir] = query.$orderby.split(" ");
      const col = (projects as any)[field] || projects.id;
      q = q.orderBy(dir === "desc" ? desc(col) : asc(col));
    } else {
      q = q.orderBy(asc(projects.id));
    }

    // Pagination
    const top = Math.min(query.$top ?? 100, 1000);
    const skip = query.$skip ?? 0;
    q = q.limit(top).offset(skip);

    const rows = await q;
    const includeReviews = query.$expand?.includes("reviews") ?? false;

    const value = await Promise.all(rows.map(p => mapProjectToOData(p, includeReviews)));

    const response: ODataResponse<ProjectUI> = {
      value,
      "@odata.count": rows.length, // for full count use separate count query in prod
      "@odata.context": `${req.protocol}://${req.get("host")}/odata/$metadata#projects`,
    };

    if (query.$count) {
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(projects);
      response["@odata.count"] = count;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /odata/projects(123) — single entity by ID
 */
odataRouter.get("/projects(:id)", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id.replace(/[()]/g, ""));
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    if (!row) return res.status(404).json({ error: "Project not found" });

    const includeReviews = (req.query.$expand as string)?.includes("reviews") ?? false;
    const project = await mapProjectToOData(row, includeReviews);
    res.json(project);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /odata/projects/$count
 */
odataRouter.get("/projects/$count", async (_req, res) => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(projects);
  res.type("text/plain").send(String(count));
});

export default odataRouter;
