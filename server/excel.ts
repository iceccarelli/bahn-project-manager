/**
 * Excel import/export functionality.
 * Provides endpoints for exporting current data and importing new data from Excel files.
 */
import { Express, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { getDb } from './db';
import { projects, departmentReviews } from '../drizzle/schema';
import { eq, asc } from 'drizzle-orm';

const DEPARTMENTS = [
  "EEA", "ITK", "GA", "Energie", "HFT", "HKLS", "TBQ",
  "UM", "BIM", "LST", "Vermessung", "Baubetriebstechnologie", "Baubetriebsplanung",
] as const;

export function registerExcelRoutes(app: Express) {
  // Export all projects as Excel
  app.get('/api/export/excel', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: 'Database not available' });
        return;
      }

      // Fetch all projects
      const allProjects = await db.select().from(projects).orderBy(asc(projects.id));
      const allReviews = await db.select().from(departmentReviews);

      // Group reviews by project
      const reviewsByProject: Record<number, typeof allReviews> = {};
      for (const review of allReviews) {
        if (!reviewsByProject[review.projectId]) {
          reviewsByProject[review.projectId] = [];
        }
        reviewsByProject[review.projectId].push(review);
      }

      // Build Excel rows
      const rows: any[] = [];
      for (const project of allProjects) {
        const row: any = {
          'Projektnummer': project.projektnummer || '',
          'Bahnhofsmanagement': project.bahnhofsmanagement || '',
          'Station': project.station || '',
          'Bahnhofsnummer': project.bahnhofsnummer || '',
          'Streckennummer': project.streckennummer || '',
          'Projektbeschreibung': project.projektbeschreibung || '',
          'EIGV-Einstufung': project.eigvEinstufung || '',
          'Projektleiter': project.projektleiter || '',
        };

        const projectReviews = reviewsByProject[project.id] || [];
        for (const dept of DEPARTMENTS) {
          const review = projectReviews.find(r => r.department === dept);
          row[`${dept} - Status`] = review?.status || '';
          row[`${dept} - Prüfer`] = review?.prueferName || '';
          row[`${dept} - Datum`] = review?.datum ? new Date(review.datum).toLocaleDateString('de-DE') : '';
        }

        row['Kommentar'] = project.kommentar || '';
        row['Projektlink'] = project.projektLink || '';
        rows.push(row);
      }

      // Create workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      // Set column widths
      ws['!cols'] = [
        { wch: 18 }, // Projektnummer
        { wch: 16 }, // Bahnhofsmanagement
        { wch: 25 }, // Station
        { wch: 12 }, // Bahnhofsnummer
        { wch: 12 }, // Streckennummer
        { wch: 40 }, // Projektbeschreibung
        { wch: 15 }, // EIGV
        { wch: 25 }, // Projektleiter
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Übersicht');

      // Write to buffer
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="Projektübersicht_Export.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('[Excel Export] Error:', error);
      res.status(500).json({ error: 'Export failed' });
    }
  });

  // Import Excel file
  app.post('/api/import/excel', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: 'Database not available' });
        return;
      }

      // Read the raw body as buffer
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const wb = XLSX.read(buffer, { type: 'buffer' });

          // Get the first sheet
          const sheetName = wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(ws) as any[];

          let imported = 0;
          let errors = 0;

          for (const row of data) {
            try {
              // Insert project
              const [result] = await db.insert(projects).values({
                projektnummer: row['Projektnummer'] || null,
                bahnhofsmanagement: row['Bahnhofsmanagement'] || null,
                station: row['Station'] || null,
                bahnhofsnummer: row['Bahnhofsnummer'] || null,
                streckennummer: row['Streckennummer'] || null,
                projektbeschreibung: row['Projektbeschreibung'] || null,
                eigvEinstufung: row['EIGV-Einstufung'] || null,
                projektleiter: row['Projektleiter'] || null,
                kommentar: row['Kommentar'] || null,
                projektLink: row['Projektlink'] || null,
              });

              const projectId = result.insertId;

              // Insert department reviews
              for (const dept of DEPARTMENTS) {
                const status = row[`${dept} - Status`];
                const name = row[`${dept} - Prüfer`];
                const dateStr = row[`${dept} - Datum`];

                if (status || name || dateStr) {
                  let datum = null;
                  if (dateStr) {
                    // Parse German date DD.MM.YYYY
                    const parts = String(dateStr).match(/(\d{2})\.(\d{2})\.(\d{4})/);
                    if (parts) {
                      datum = new Date(`${parts[3]}-${parts[2]}-${parts[1]}`);
                    }
                  }

                  await db.insert(departmentReviews).values({
                    projectId,
                    department: dept,
                    prueferName: name || null,
                    datum,
                    status: status || null,
                  });
                }
              }

              imported++;
            } catch (rowErr) {
              errors++;
              console.error('[Excel Import] Row error:', rowErr);
            }
          }

          res.json({
            success: true,
            imported,
            errors,
            total: data.length,
          });
        } catch (parseErr) {
          console.error('[Excel Import] Parse error:', parseErr);
          res.status(400).json({ error: 'Invalid Excel file' });
        }
      });
    } catch (error) {
      console.error('[Excel Import] Error:', error);
      res.status(500).json({ error: 'Import failed' });
    }
  });
}
