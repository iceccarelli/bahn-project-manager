import type * as XLSXNS from "xlsx";
import type { SheetInput } from "./workbook-cells";

/**
 * Workbook → the cell grids `importWorkbookSheets` reads. The `xlsx` module is
 * passed in so this file stays free of the (large) library: the browser loads it
 * on the click that picks a file, the CLI and the tests import it directly.
 *
 * `raw: true` and no `cellDates`: dates arrive as Excel serial numbers and are
 * converted by the importer with plain UTC arithmetic. Letting the library build
 * `Date` objects would put the reader's time zone into a date that has none.
 */
export function sheetsFromWorkbook(XLSX: typeof XLSXNS, workbook: XLSXNS.WorkBook): SheetInput[] {
  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const rows = ws ? (XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }) as unknown[][]) : [];
    return { name, rows };
  });
}
