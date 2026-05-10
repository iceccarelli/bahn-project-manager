/**
 * Excel import/export functionality.
 * Provides endpoints for exporting current data and importing new data from Excel files.
 * Updated for deployment: 
 * - Includes all 14 departments (with BS) for full consistency with shared/types.ts and UI
 * - Supports BOTH export format ("XXX - Status", "XXX - Prüfer", "XXX - Datum") AND legacy Übersichtsliste.xlsm format (e.g. "BS", "Name3", "Datum3", "EEA", "Name", "Datum" etc.)
 * - Improved date parsing (supports DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, 1 or 2 digit days/months)
 * - Better error resilience and logging
 * - Freeze panes + extended column widths for better usability in Excel
 * - Fully integrates with the project schema, tRPC/Express routes, and GitHub repo structure
 * - Ready for production use with the provided Übersichtsliste.xlsm and round-tripping exports
 */
import { Express, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { getDb } from './db';
import { projects, departmentReviews } from '../drizzle/schema';
import { eq, asc } from 'drizzle-orm';

// Use the canonical department list from shared types for perfect consistency across frontend, backend, DB and Excel.
// (Matches exactly the list in attachments/types.ts and client code)
const DEPARTMENTS = [
  "EEA",
  "ITK",
  "GA",
  "Energie",
  "HFT",
  "HKLS",
  "TBQ",
  "BS",                    
  "UM",
  "BIM",
  "LST",
  "Vermessung",
  "Baubetriebstechnologie",
  "Baubetriebsplanung",
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

      // Set column widths (extended for all dynamic dept columns + usability)
      const baseCols = [
        { wch: 18 }, // Projektnummer
        { wch: 16 }, // Bahnhofsmanagement
        { wch: 25 }, // Station
        { wch: 12 }, // Bahnhofsnummer
        { wch: 12 }, // Streckennummer
        { wch: 45 }, // Projektbeschreibung
        { wch: 16 }, // EIGV-Einstufung
        { wch: 25 }, // Projektleiter
      ];
      // 3 columns per department (Status, Prüfer, Datum) + Kommentar + Projektlink
      const deptCols = DEPARTMENTS.flatMap((_, idx) => [
        { wch: 18 }, // Status (wider)
        { wch: 14 }, // Prüfer
        { wch: 12 }, // Datum
      ]);
      ws['!cols'] = [...baseCols, ...deptCols, { wch: 30 }, { wch: 50 }]; // Kommentar, Projektlink

      // Freeze the header row for better UX when opening in Excel
      ws['!freeze'] = { x: 0, y: 1 };

      XLSX.utils.book_append_sheet(wb, ws, 'Übersicht');

      // Optional: Add a second sheet with status legend and department info (nice for users)
      const legendData = [
        { Info: 'This file was exported from Bahn Project Manager' },
        { Info: 'Departments (Fachbereiche): ' + DEPARTMENTS.join(', ') },
        { Info: 'Valid Status values: ' + [
          "nicht erforderlich", "offen", "Projektkonfig.", "in Bearbeitung",
          "Nachforderung", "prüffähig", "Prüfung erfolgt", "Zustimmung erteilt",
          "Niederschrift erstellt", "abgelehnt", "zurückgestellt", "gestoppt"
        ].join(', ') },
        { Info: 'Date format: DD.MM.YYYY (German)' },
        { Info: 'To re-import: Use POST /api/import/excel with this file (or legacy Übersichtsliste format)' },
      ];
      const legendWs = XLSX.utils.json_to_sheet(legendData);
      legendWs['!cols'] = [{ wch: 120 }];
      XLSX.utils.book_append_sheet(wb, legendWs, 'Info & Legend');

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

      // Read the raw body as buffer (supports direct binary upload from frontend)
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          if (buffer.length === 0) {
            res.status(400).json({ error: 'Empty file uploaded' });
            return;
          }

          const wb = XLSX.read(buffer, { type: 'buffer' });

          // Get the first sheet
          const sheetName = wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(ws) as any[];

          if (data.length === 0) {
            res.json({ success: true, imported: 0, errors: 0, total: 0, message: 'No data rows found' });
            return;
          }

          // === NEW: Detect format and provide unified getter for review data ===
          // This makes the importer work seamlessly with:
          // 1. Files exported by this endpoint (uses "EEA - Status", "EEA - Prüfer", "EEA - Datum" ...)
          // 2. The original Übersichtsliste.xlsm / legacy format (uses "EEA","Name","Datum", "ITK","Name2","Datum2", "BS","Name3","Datum3", ...)
          const isLegacyFormat = data.length > 0 && (
            'EEA' in data[0] || 'Name' in data[0] || 'BS' in data[0] || 'Name3' in data[0]
          );

          const getReviewData = (row: any, dept: string) => {
            if (!isLegacyFormat) {
              // Standard / exported format
              return {
                status: row[`${dept} - Status`],
                name: row[`${dept} - Prüfer`],
                dateStr: row[`${dept} - Datum`],
              };
            } else {
              // Legacy Übersichtsliste format (column names from the real Excel file)
              const legacyMap: Record<string, { statusCol: string; prueferCol: string; datumCol: string }> = {
                "EEA": { statusCol: "EEA", prueferCol: "Name", datumCol: "Datum" },
                "ITK": { statusCol: "ITK", prueferCol: "Name2", datumCol: "Datum2" },
                "GA": { statusCol: "GA", prueferCol: "Name4", datumCol: "Datum4" },
                "Energie": { statusCol: "Energie", prueferCol: "Name5", datumCol: "Datum5" },
                "HFT": { statusCol: "HFT", prueferCol: "Name6", datumCol: "Datum6" },
                "HKLS": { statusCol: "HKLS", prueferCol: "Name7", datumCol: "Datum7" },
                "TBQ": { statusCol: "TBQ", prueferCol: "Name8", datumCol: "Datum8" },
                "BS": { statusCol: "BS", prueferCol: "Name3", datumCol: "Datum3" },
                "UM": { statusCol: "UM", prueferCol: "Name9", datumCol: "Datum9" },
                "BIM": { statusCol: "BIM", prueferCol: "Name10", datumCol: "Datum10" },
                "LST": { statusCol: "LST", prueferCol: "Name11", datumCol: "Datum11" },
                "Vermessung": { statusCol: "Vermessung", prueferCol: "Name12", datumCol: "Datum12" },
                "Baubetriebstechnologie": { statusCol: "Baubetriebstechnnologie", prueferCol: "Name13", datumCol: "Datum13" }, // matches Excel typo
                "Baubetriebsplanung": { statusCol: "Baubetriebsplanung", prueferCol: "Name14", datumCol: "Datum14" },
              };
              const map = legacyMap[dept];
              if (!map) {
                return { status: undefined, name: undefined, dateStr: undefined };
              }
              return {
                status: row[map.statusCol],
                name: row[map.prueferCol],
                dateStr: row[map.datumCol],
              };
            }
          };
          // === END NEW FORMAT SUPPORT ===

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

              // Insert department reviews (now supports both formats)
              for (const dept of DEPARTMENTS) {
                const { status, name, dateStr } = getReviewData(row, dept);

                if (status || name || dateStr) {
                  let datum = null;
                  if (dateStr) {
                    // Improved German/European date parsing (DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY)
                    const cleaned = String(dateStr).trim();
                    const parts = cleaned.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
                    if (parts) {
                      const day = parts[1].padStart(2, '0');
                      const month = parts[2].padStart(2, '0');
                      const year = parts[3];
                      const parsed = new Date(`${year}-${month}-${day}`);
                      if (!isNaN(parsed.getTime())) {
                        datum = parsed;
                      }
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
              console.error('[Excel Import] Row error for row:', row, rowErr);
            }
          }

          res.json({
            success: true,
            imported,
            errors,
            total: data.length,
            formatDetected: isLegacyFormat ? 'legacy-übersichtsliste' : 'standard-export',
          });
        } catch (parseErr) {
          console.error('[Excel Import] Parse error:', parseErr);
          res.status(400).json({ error: 'Invalid Excel file. Make sure it is a valid .xlsx or .xls file.' });
        }
      });

      // Add error handler for the request stream
      req.on('error', (err) => {
        console.error('[Excel Import] Request stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Upload stream error' });
        }
      });
    } catch (error) {
      console.error('[Excel Import] Error:', error);
      res.status(500).json({ error: 'Import failed' });
    }
  });
}
