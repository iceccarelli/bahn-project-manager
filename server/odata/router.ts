import { Router, Request, Response, NextFunction } from "express";
import { getDb } from "../db";
import { projects, departmentReviews } from "../../drizzle/schema";
import { eq, like, desc, asc, sql } from "drizzle-orm";
import {
  ODataQuerySchema,
  parseODataFilter,
} from "@shared/server/odata";
import type { ODataResponse } from "@shared/server/odata";
import type { ProjectUI, Review } from "@shared/types";

export const odataRouter: import("express").Router = Router();

/**
 * Helper to convert DB row + reviews to OData Project shape (matches ProjectUI)
 */
async function mapProjectToOData(p: any, includeReviews = false): Promise<ProjectUI> {
  let reviews: Review[] = [];
  if (includeReviews) {
    const db = await getDb();
    if (db) {
      const revs = await db
        .select()
        .from(departmentReviews)
        .where(eq(departmentReviews.projectId, p.id));
      reviews = revs.map((r: any) => ({
        department: r.department,
        status: r.status,
        prueferName: r.prueferName,
        pruefDatum: r.datum ? r.datum.toISOString() : null,
      })) as Review[];
    }
  }

  return {
    id: p.id,
    projektnummer: p.projektnummer,
    bahnhofsmanagement: p.bahnhofsmanagement,
    station: p.station,
    bahnhofsnummer: p.bahnhofsnummer,
    streckennummer: p.streckennummer,
    projektbeschreibung: p.projektbeschreibung,
    projektstand: p.projektstand,
    eigvEinstufung: p.eigvEinstufung,
    projektleiter: p.projektleiter,
    terminProjektvorstellung: p.terminProjektvorstellung,
    kommentar: p.kommentar,
    projektLink: p.projektLink,
    syncVersion: p.syncVersion ?? 1,
    reviews,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * GET /odata/$metadata
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
 * GET /odata/projects — main collection endpoint
 */
odataRouter.get("/projects", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const query = ODataQuerySchema.parse(req.query);

    // Use 'any' for the query builder chain to avoid Drizzle's complex generic reassignment issues
    let q: any = db.select().from(projects);

    if (query.$filter) {
      const parsed = parseODataFilter(query.$filter);
      const station = parsed["station"] ?? parsed["station_contains"];
      const projektstand = parsed["projektstand"];
      if (station) q = q.where(like(projects.station, `%${String(station)}%`));
      if (projektstand) q = q.where(eq(projects.projektstand, String(projektstand)));
    }

    if (query.$orderby) {
      const parts = query.$orderby.split(" ");
      const field = parts[0] ?? "id";
      const dir = parts[1];
      const col = (projects as any)[field] || projects.id;
      q = dir === "desc" ? q.orderBy(desc(col)) : q.orderBy(asc(col));
    } else {
      q = q.orderBy(asc(projects.id));
    }

    const top = Math.min(query.$top ?? 100, 1000);
    const skip = query.$skip ?? 0;
    q = q.limit(top).offset(skip);

    const rows: any[] = await q;
    const includeReviews = query.$expand?.includes("reviews") ?? false;
    const value = await Promise.all(rows.map((p: any) => mapProjectToOData(p, includeReviews)));

    const response: ODataResponse<ProjectUI> = {
      value,
      "@odata.count": rows.length,
      "@odata.context": `${req.protocol}://${req.get("host")}/odata/$metadata#projects`,
    };

    if (query.$count) {
      const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(projects);
      if (countRow) response["@odata.count"] = countRow.count;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /odata/projects(:id) — single entity by ID
 */
odataRouter.get("/projects\\(:id\\)", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const rawId = req.params["id"] ?? "";
    const id = parseInt(rawId.replace(/[()]/g, ""));
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const includeReviews = (req.query["$expand"] as string)?.includes("reviews") ?? false;
    const project = await mapProjectToOData(row, includeReviews);
    res.json(project);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /odata/projects/$count
 */
odataRouter.get("/projects/\\$count", async (_req: Request, res: Response) => {
  const db = await getDb();
  if (!db) {
    res.type("text/plain").send("0");
    return;
  }
  const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(projects);
  res.type("text/plain").send(String(countRow?.count ?? 0));
});

export default odataRouter;
