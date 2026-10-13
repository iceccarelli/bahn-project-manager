/**
 * The one place the two fixture sets meet: the register's edge-case projects and the Prüfbericht edge-case reports that name
 * them. Only the link is exercised with this pair — the importers have their own fixtures and never see each other.
 */
import { edgeCaseReportSheets as reportSheets } from "./itk/edge-fixtures";
import { FRAMEWORK } from "./register/fixtures";

export { edgeCaseRegisterSheet, EDGE_CASE_REGISTER } from "./register/fixtures";
export const edgeCaseReportSheets = () => reportSheets(FRAMEWORK);
