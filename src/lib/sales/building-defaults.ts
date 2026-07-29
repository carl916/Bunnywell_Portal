import type { DepositStructure } from "./deal-structure";
import { parseGbpInput } from "./currency";

export type BuildingSaleDefaultsInput = {
  buildingId: string;
  buildCost: string;
  agentFeePercent: number | null;
  reservationFee: string;
  reservationFeeHolder: string;
  depositStructure: DepositStructure;
};

export function buildBuildingSaleDefaultsPayload(input: BuildingSaleDefaultsInput) {
  return {
    building_id: input.buildingId,
    build_cost: parseGbpInput(input.buildCost),
    default_agent_fee_percent: input.agentFeePercent,
    reservation_fee: parseGbpInput(input.reservationFee),
    reservation_fee_holder_default: input.reservationFeeHolder,
    exchange_deposit_percent: input.depositStructure.exchangeDepositPercent,
    second_deposit_enabled: input.depositStructure.secondDepositEnabled,
    second_deposit_percent: input.depositStructure.secondDepositEnabled ? input.depositStructure.secondDepositPercent : null,
    second_deposit_months_after_exchange: input.depositStructure.secondDepositEnabled ? input.depositStructure.secondDepositMonthsAfterExchange : null,
    default_vat_rate: 20,
    default_sales_solicitor_fee: 882,
  };
}
