import type { RentalPortfolioStatus, UnitSaleStatus } from "../data/production.ts";

export type UnitAllocationMutation =
  | {
    action: "set_sales_availability";
    unitIds: string[];
    target: Extract<UnitSaleStatus, "not_released" | "not_for_sale" | "for_sale">;
  }
  | {
    action: "set_rental_portfolio";
    unitIds: string[];
    target: Extract<RentalPortfolioStatus, "active" | "exited">;
  };

export class UnitAllocationMutationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function parseUnitAllocationMutation(value: unknown): UnitAllocationMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UnitAllocationMutationError("Invalid unit allocation request.");
  }
  const record = value as Record<string, unknown>;
  const unitIds = Array.isArray(record.unitIds)
    ? record.unitIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (unitIds.length === 0 || unitIds.length !== (record.unitIds as unknown[])?.length) {
    throw new UnitAllocationMutationError("Choose at least one valid unit.");
  }
  if (new Set(unitIds).size !== unitIds.length) {
    throw new UnitAllocationMutationError("The unit selection contains duplicates.");
  }

  if (record.action === "set_sales_availability") {
    if (!["not_released", "not_for_sale", "for_sale"].includes(record.target as string)) {
      throw new UnitAllocationMutationError("Choose a valid administrative sales availability.");
    }
    return {
      action: record.action,
      unitIds,
      target: record.target as "not_released" | "not_for_sale" | "for_sale",
    };
  }
  if (record.action === "set_rental_portfolio") {
    if (!["active", "exited"].includes(record.target as string)) {
      throw new UnitAllocationMutationError("Choose a valid rental-portfolio action.");
    }
    return { action: record.action, unitIds, target: record.target as "active" | "exited" };
  }
  throw new UnitAllocationMutationError("Choose a supported unit allocation action.");
}
