# Bahn Project Manager - TODO

## Database & Schema
- [x] Design and create projects table with all columns from Excel
- [x] Design and create department_reviews table for 14 Fachbereiche
- [x] Design and create bvb_eea table for EEA-Freigaben
- [x] Design and create psv_itk table for ITK-Projektvorstellungen
- [x] Design and create audit_log table for change history
- [x] Seed database with 1,298 records from Excel file

## Backend API
- [x] Projects CRUD procedures (list, get, create, update, delete)
- [x] Department reviews CRUD procedures
- [x] Advanced filtering and search (region, project leader, prüfer, status)
- [x] Dashboard statistics procedure (totals, status distribution, workload)
- [x] BVB-EEA procedures (list, create, update)
- [x] PSV-ITK procedures (list, create, update)
- [x] Excel import procedure
- [x] Excel export procedure
- [x] Audit log procedure

## Frontend - Layout & Navigation
- [x] Professional dark theme with elegant styling
- [x] Sidebar navigation with DashboardLayout
- [x] Responsive design

## Frontend - Dashboard
- [x] Total projects count card
- [x] Status distribution per department (chart/cards)
- [x] Open reviews per region
- [x] Prüfer workload overview

## Frontend - Project Table
- [x] Full data table with all 1,298 entries
- [x] Columns: Projektnummer, Region, Station, Projektbeschreibung, Projektleiter
- [x] 14 department column groups (Name, Datum, Status)
- [x] Inline editing for all fields
- [x] Status dropdown with exact values
- [x] Sorting on all columns
- [x] Pagination
- [x] Column visibility toggles

## Frontend - Filters & Search
- [x] Filter by Region/Bahnhofsmanagement
- [x] Filter by Projektleiter
- [x] Filter by Prüfer
- [x] Filter by Status per department
- [x] Global text search

## Frontend - BVB-EEA View
- [x] Separate page for EEA-Freigaben
- [x] Fields: Freigabeerklärung-Nummer, Kosteneinsparung, Kommentar

## Frontend - PSV-ITK View
- [x] Separate page for ITK-Projektvorstellungen
- [x] Fields: Projektstand, Termin, ITK-Prüfer

## Frontend - Import/Export
- [x] Excel upload for data import
- [x] Excel export of current data

## Frontend - Audit & Comments
- [x] Comment field per project entry
- [x] Project link field
- [x] Audit log view showing change history

## Access Control
- [x] Admin role: full edit access
- [x] User role: limited to assigned departments

## Testing
- [x] Vitest tests for backend procedures (11 tests passing)

## Vercel Deployment
- [ ] Add vercel.json configuration for Vercel deployment
- [ ] Create Vercel serverless API adapter
- [ ] Provide GitHub push + Vercel deployment instructions
- [x] Remove Manus OAuth dependency, replace with demo auth
- [x] Fix all VITE_ env var issues for Vercel
- [x] Create standalone Vercel serverless API
- [x] Ensure frontend builds and runs without errors on Vercel
