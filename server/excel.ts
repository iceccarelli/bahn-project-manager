/**
 * Excel EXPORT (read-only), scoped to the caller's workspaces.
 *
 * Export is the only Excel surface. The former import route wrote straight into the tables outside the domain
 * pipeline and was removed (see the note in registerExcelRoutes).
 */
import type { Express, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { getDb } from './db';
import { projects, departmentReviews } from '../drizzle/schema';
import { asc, inArray } from 'drizzle-orm';
import type { Principal } from './domain/permissions';
import { workspaceRestriction } from './domain/permissions';

// Canonical department list - EXACT order from the uploaded Übersichtsliste.xlsm header row
// This ensures perfect visual and logical harmony across UI, export, import and database
const DEPARTMENTS = [
  "EEA",
  "ITK",
  "BS",                    
  "GA",
  "Energie",
  "HFT",
  "HKLS",
  "TBQ",
  "UM",
  "BIM",
  "LST",
  "Vermessung",
  "Baubetriebstechnologie",
  "Baubetriebsplanung",
] as const;

export function registerExcelRoutes(app: Express) {
  // Export all projects as Excel (modern format - recommended for new workflows)
  app.get('/api/export/excel', async (_req: Request, res: Response) => {
    const principal = res.locals.principal as Principal | undefined;
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const restriction = workspaceRestriction(principal); // null = every workspace, [] = none
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: 'Database not available' });
        return;
      }

      const scoped = restriction === null ? undefined : inArray(projects.bahnhofsmanagement, [...restriction]);
      const allProjects = restriction !== null && restriction.length === 0 ? [] : await db.select().from(projects).where(scoped).orderBy(asc(projects.id));
      const ids = allProjects.map(p => p.id);
      const allReviews = ids.length === 0 ? [] : await db.select().from(departmentReviews).where(inArray(departmentReviews.projectId, ids));

      const reviewsByProject: Record<number, typeof allReviews> = {};
      for (const review of allReviews) {
        if (!reviewsByProject[review.projectId]) reviewsByProject[review.projectId] = [];
        reviewsByProject[review.projectId]?.push(review);
      }

      const rows: any[] = [];
      for (const project of allProjects) {
        const row: any = {
          'Projektnummer': project.projektnummer || '',
          'Bahnhofsmanagement': project.bahnhofsmanagement || '',
          'Station': project.station || '',
          'Bahnhofsnummer': project.bahnhofsnummer || '',
          'Streckennummer': project.streckennummer || '',
          'Projektbeschreibung': project.projektbeschreibung || '',
          'Projektstand': project.projektstand || '',
          'Projektleiter': project.projektleiter || '',
          'Termin Projektvorstellung': project.terminProjektvorstellung 
            ? new Date(project.terminProjektvorstellung).toLocaleDateString('de-DE') 
            : '',
        };

        const projectReviews = reviewsByProject[project.id] || [];
        for (const dept of DEPARTMENTS) {
          const review = projectReviews.find(r => r.department === dept);
          row[`${dept} - Status`] = review?.status || '';
          row[`${dept} - Prüfer`] = review?.prueferName || '';
          row[`${dept} - Datum`] = review?.datum ? new Date(review.datum).toLocaleDateString('de-DE') : '';
        }

        row.Kommentar = project.kommentar || '';
        row.Projektlink = project.projektLink || '';
        rows.push(row);
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      const baseCols = [
        { wch: 18 }, { wch: 16 }, { wch: 25 }, { wch: 12 }, { wch: 12 },
        { wch: 45 }, { wch: 16 }, { wch: 25 }, { wch: 18 }
      ];
      const deptCols = DEPARTMENTS.flatMap(() => [
        { wch: 18 }, { wch: 14 }, { wch: 12 }
      ]);
      ws['!cols'] = [...baseCols, ...deptCols, { wch: 30 }, { wch: 50 }];
      ws['!freeze'] = { x: 0, y: 1 };

      XLSX.utils.book_append_sheet(wb, ws, 'Übersicht');

      const legendData = [
        { Info: 'This file was exported from Bahn Project Manager' },
        { Info: `Departments (Fachbereiche) in exact Excel column order: ${DEPARTMENTS.join(', ')}` },
        { Info: `Valid Status values: ${[
          "nicht erforderlich", "offen", "Projektkonfig.", "in Bearbeitung",
          "Nachforderung", "prüffähig", "Prüfung erfolgt", "Zustimmung erteilt",
          "Niederschrift erstellt", "abgelehnt", "zurückgestellt", "gestoppt"
        ].join(', ')}` },
        { Info: 'Date format: DD.MM.YYYY (German)' },
        { Info: 'Export is scoped to the caller workspaces.' },
      ];
      const legendWs = XLSX.utils.json_to_sheet(legendData);
      legendWs['!cols'] = [{ wch: 120 }];
      XLSX.utils.book_append_sheet(wb, legendWs, 'Info & Legend');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="Projektübersicht_Export.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('[Excel Export] Error:', error);
      res.status(500).json({ error: 'Export failed' });
    }
  });

  // There is deliberately NO import route. The former POST /api/import/excel wrote projects and reviews directly:
  // no transaction, no optimistic version, no audit, no domain event/outbox, no read-model or geo maintenance, no
  // workspace normalization. Bulk loading goes through ProjectService (one transaction per chunk) or a migration.

}
