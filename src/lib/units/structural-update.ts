export const SALE_STATUS_WORKFLOW_ONLY_ERROR = "Sale status can only be changed through the sales workflow.";

const structuralUnitRequestFields = [
  "unit_number",
  "floor",
  "size_sqm",
  "parking_bays",
  "unit_type_id",
] as const;

type StructuralUnitRequestField = (typeof structuralUnitRequestFields)[number];

export type StructuralUnitUpdateRequest = {
  unit_number: string;
  floor: string;
  size_sqm: number;
  parking_bays: number[];
  unit_type_id: string;
};

export type StructuralUnitUpdatePayload = StructuralUnitUpdateRequest & {
  unit_type: string;
};

export type StructurallyUpdatedUnit = StructuralUnitUpdatePayload & {
  id: string;
  building_id: string;
  sale_status: string;
};

export type StructuralUnitRepository = {
  findUnitTypeName: (unitTypeId: string) => Promise<string | null>;
  updateUnit: (unitId: string, payload: StructuralUnitUpdatePayload) => Promise<StructurallyUpdatedUnit | null>;
};

export class StructuralUnitUpdateError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "StructuralUnitUpdateError";
    this.status = status;
  }
}

function requiredText(record: Record<string, unknown>, field: StructuralUnitRequestField, label: string) {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new StructuralUnitUpdateError(`${label} is required.`);
  }
  return value.trim();
}

export function parseStructuralUnitUpdate(input: unknown): StructuralUnitUpdateRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new StructuralUnitUpdateError("Enter valid unit details.");
  }

  const record = input as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "sale_status")) {
    throw new StructuralUnitUpdateError(SALE_STATUS_WORKFLOW_ONLY_ERROR);
  }

  const allowedFields = new Set<string>(structuralUnitRequestFields);
  const unsupportedFields = Object.keys(record).filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) {
    throw new StructuralUnitUpdateError(`Unsupported unit field${unsupportedFields.length === 1 ? "" : "s"}: ${unsupportedFields.join(", ")}.`);
  }

  const sizeSqm = record.size_sqm;
  if (typeof sizeSqm !== "number" || !Number.isFinite(sizeSqm) || sizeSqm < 0) {
    throw new StructuralUnitUpdateError("Enter a valid unit size.");
  }

  const parkingBays = record.parking_bays;
  if (!Array.isArray(parkingBays) || parkingBays.some((bay) => typeof bay !== "number" || !Number.isInteger(bay) || bay <= 0)) {
    throw new StructuralUnitUpdateError("Enter valid parking bay numbers.");
  }

  return {
    unit_number: requiredText(record, "unit_number", "Unit number"),
    floor: requiredText(record, "floor", "Floor"),
    size_sqm: sizeSqm,
    parking_bays: parkingBays,
    unit_type_id: requiredText(record, "unit_type_id", "Unit type"),
  };
}

export async function updateUnitStructure(
  repository: StructuralUnitRepository,
  unitId: string,
  input: unknown,
) {
  if (!unitId.trim()) throw new StructuralUnitUpdateError("Unit is required.");

  const structuralFields = parseStructuralUnitUpdate(input);
  const unitTypeName = await repository.findUnitTypeName(structuralFields.unit_type_id);
  if (!unitTypeName) throw new StructuralUnitUpdateError("Choose a valid unit type.");

  const updatedUnit = await repository.updateUnit(unitId, {
    unit_number: structuralFields.unit_number,
    floor: structuralFields.floor,
    size_sqm: structuralFields.size_sqm,
    parking_bays: structuralFields.parking_bays,
    unit_type_id: structuralFields.unit_type_id,
    unit_type: unitTypeName,
  });

  if (!updatedUnit) throw new StructuralUnitUpdateError("Unit not found.", 404);
  return updatedUnit;
}
