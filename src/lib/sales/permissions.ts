export type SalesAccessRole =
  | "admin"
  | "developer"
  | "developer_representative"
  | "sales_agent"
  | "conveyancer"
  | "contractor"
  | "resident"
  | "user"
  | string
  | null
  | undefined;

export type SalesStageAction =
  | "view_pipeline"
  | "view_building_sales"
  | "view_developer_commercials"
  | "view_approved_commercial_package"
  | "manage_building_defaults"
  | "manage_commercial_terms"
  | "submit_reservation"
  | "approve_reservation"
  | "fail_reservation"
  | "submit_agent_invoice"
  | "approve_commercial_package"
  | "request_exchange_approval"
  | "approve_exchange"
  | "record_exchange"
  | "record_solicitor_payment"
  | "record_developer_shortfall"
  | "submit_completion_documents"
  | "approve_completion_documents"
  | "record_completion"
  | "view_forecasting";

export type SalesBuildingAccessInput = {
  role: SalesAccessRole;
  buildingId?: string | null;
  accessibleBuildingIds?: readonly string[] | null;
};

const internalSalesRoles = new Set(["admin", "developer"]);
const externalSalesRoles = new Set(["sales_agent", "conveyancer"]);

function normaliseRole(role: SalesAccessRole) {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

export function isSalesInternalRole(role: SalesAccessRole) {
  return internalSalesRoles.has(normaliseRole(role));
}

export function isSalesExternalRole(role: SalesAccessRole) {
  return externalSalesRoles.has(normaliseRole(role));
}

export function canOpenSalesPipeline(role: SalesAccessRole) {
  return isSalesInternalRole(role) || isSalesExternalRole(role);
}

export function canViewSalesBuilding({ role, buildingId, accessibleBuildingIds = [] }: SalesBuildingAccessInput) {
  if (isSalesInternalRole(role)) return true;
  if (!isSalesExternalRole(role) || !buildingId) return false;
  return accessibleBuildingIds?.includes(buildingId) ?? false;
}

export function canViewDeveloperCommercials(role: SalesAccessRole) {
  return isSalesInternalRole(role);
}

export function canViewApprovedCommercialPackage(role: SalesAccessRole) {
  return canOpenSalesPipeline(role);
}

export function canManageBuildingSaleDefaults(role: SalesAccessRole) {
  return isSalesInternalRole(role);
}

export function canManageCommercialTerms(role: SalesAccessRole) {
  return isSalesInternalRole(role);
}

export function canViewSalesForecasting(role: SalesAccessRole) {
  return isSalesInternalRole(role);
}

export function canPerformSalesAction(role: SalesAccessRole, action: SalesStageAction) {
  const normalisedRole = normaliseRole(role);

  if (action === "view_pipeline") return canOpenSalesPipeline(role);
  if (action === "view_building_sales") return canOpenSalesPipeline(role);
  if (action === "view_developer_commercials") return canViewDeveloperCommercials(role);
  if (action === "view_approved_commercial_package") return canViewApprovedCommercialPackage(role);
  if (action === "manage_building_defaults") return canManageBuildingSaleDefaults(role);
  if (action === "manage_commercial_terms") return canManageCommercialTerms(role);
  if (action === "view_forecasting") return canViewSalesForecasting(role);

  if (action === "submit_reservation" || action === "submit_agent_invoice") {
    return isSalesInternalRole(role) || normalisedRole === "sales_agent";
  }

  if (
    action === "request_exchange_approval"
    || action === "record_exchange"
    || action === "record_solicitor_payment"
    || action === "submit_completion_documents"
    || action === "record_completion"
  ) {
    return isSalesInternalRole(role) || normalisedRole === "conveyancer";
  }

  return isSalesInternalRole(role);
}
