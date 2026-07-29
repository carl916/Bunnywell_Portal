"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { AppRole, Building, Unit } from "@/lib/data/production";
import { GbpInput } from "@/components/portal/sales/GbpInput";
import { formatGbp, formatGbpDeduction, parseGbpInput } from "@/lib/sales/currency";
import { canViewSalesForecasting } from "@/lib/sales/permissions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Profile = {
  id: string;
  role: AppRole;
};

type ForecastScenario = {
  id: string;
  building_id: string;
  name: string;
  description: string | null;
  sell_unit_count: number;
  retain_unit_count: number;
  rent_unit_count: number;
  refinance_unit_count: number;
  average_sale_value: number | null;
  average_rent_per_unit: number;
  ltv_percent: number;
  monthly_interest_rate: number;
  completion_month: number;
  refinance_month: number;
  opening_debt: number;
  development_cost: number;
  investor_repayment: number;
  results: ForecastResults | null;
  updated_at: string;
};

type SaleAttempt = {
  id: string;
  unit_id: string;
  is_active: boolean;
};

type SaleTerms = {
  sale_attempt_id: string;
  is_current: boolean;
  list_price_at_offer: number | null;
  contract_price: number | null;
};

type ForecastResults = {
  unitCount: number;
  averageSaleValue: number;
  saleRevenue: number;
  refinanceProceeds: number;
  retainedValue: number;
  annualRent: number;
  interestCost: number;
  debtRepaid: number;
  cashAfterDebt: number;
  developerProfit: number;
};

function money(value: number | string | null | undefined) {
  return formatGbp(value);
}

function normaliseNumberInput(value: string) {
  const numeric = Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function inputValue(value: number | null | undefined) {
  return value === null || value === undefined ? "" : value.toString();
}

function calculateScenario(input: {
  unitCount: number;
  averageSaleValue: number;
  sellUnits: number;
  retainUnits: number;
  rentUnits: number;
  refinanceUnits: number;
  averageRent: number;
  ltvPercent: number;
  monthlyInterestRate: number;
  completionMonth: number;
  refinanceMonth: number;
  openingDebt: number;
  developmentCost: number;
  investorRepayment: number;
}): ForecastResults {
  const averageSaleValue = input.averageSaleValue;
  const saleRevenue = input.sellUnits * averageSaleValue;
  const refinanceProceeds = input.refinanceUnits * averageSaleValue * (input.ltvPercent / 100);
  const retainedValue = input.retainUnits * averageSaleValue;
  const annualRent = input.rentUnits * input.averageRent * 12;
  const interestMonths = Math.max(input.completionMonth, input.refinanceMonth, 0);
  const interestCost = input.openingDebt * (input.monthlyInterestRate / 100) * interestMonths;
  const cashBeforeDebt = saleRevenue + refinanceProceeds;
  const debtRepaid = Math.min(input.openingDebt, cashBeforeDebt);
  const cashAfterDebt = cashBeforeDebt - debtRepaid - interestCost - input.investorRepayment;
  const developerProfit = saleRevenue + refinanceProceeds + retainedValue - input.developmentCost - interestCost - input.investorRepayment;

  return {
    unitCount: input.unitCount,
    averageSaleValue,
    saleRevenue,
    refinanceProceeds,
    retainedValue,
    annualRent,
    interestCost,
    debtRepaid,
    cashAfterDebt,
    developerProfit,
  };
}

export function SalesForecastingModule({
  user,
  profile,
  buildings,
  units,
  onNotice,
  initialBuildingId,
  hideBuildingSelector = false,
}: {
  user: User;
  profile: Profile | null;
  buildings: Building[];
  units: Unit[];
  onNotice: (notice: string) => void;
  initialBuildingId?: string;
  hideBuildingSelector?: boolean;
}) {
  const role = profile?.role ?? "user";
  const canViewForecasting = canViewSalesForecasting(role);
  const [buildingId, setBuildingId] = useState(initialBuildingId ?? buildings[0]?.id ?? "");
  const [attempts, setAttempts] = useState<SaleAttempt[]>([]);
  const [terms, setTerms] = useState<SaleTerms[]>([]);
  const [scenarios, setScenarios] = useState<ForecastScenario[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState("Base forecast");
  const [description, setDescription] = useState("");
  const [sellUnits, setSellUnits] = useState("");
  const [retainUnits, setRetainUnits] = useState("");
  const [rentUnits, setRentUnits] = useState("");
  const [refinanceUnits, setRefinanceUnits] = useState("");
  const [averageSaleValue, setAverageSaleValue] = useState("");
  const [averageRent, setAverageRent] = useState("");
  const [ltvPercent, setLtvPercent] = useState("70");
  const [monthlyInterestRate, setMonthlyInterestRate] = useState("0");
  const [completionMonth, setCompletionMonth] = useState("1");
  const [refinanceMonth, setRefinanceMonth] = useState("1");
  const [openingDebt, setOpeningDebt] = useState("");
  const [developmentCost, setDevelopmentCost] = useState("");
  const [investorRepayment, setInvestorRepayment] = useState("");

  const selectedBuilding = buildings.find((building) => building.id === buildingId);
  const buildingUnits = useMemo(() => units.filter((unit) => unit.building_id === buildingId), [buildingId, units]);
  const currentUnitValues = useMemo(() => {
    const attemptByUnit = new Map(attempts.filter((attempt) => attempt.is_active).map((attempt) => [attempt.unit_id, attempt.id]));
    const termByAttempt = new Map(terms.filter((term) => term.is_current).map((term) => [term.sale_attempt_id, term]));
    return buildingUnits.map((unit) => {
      const term = termByAttempt.get(attemptByUnit.get(unit.id) ?? "");
      return term?.contract_price ?? term?.list_price_at_offer ?? null;
    }).filter((value): value is number => value !== null && Number.isFinite(value));
  }, [attempts, buildingUnits, terms]);
  const derivedAverageValue = currentUnitValues.length > 0
    ? currentUnitValues.reduce((total, value) => total + value, 0) / currentUnitValues.length
    : 0;
  const fallbackAverageValue = parseGbpInput(averageSaleValue) ?? derivedAverageValue;
  const totalScenarioUnits = normaliseNumberInput(sellUnits) + normaliseNumberInput(retainUnits) + normaliseNumberInput(rentUnits) + normaliseNumberInput(refinanceUnits);
  const currentScenario = calculateScenario({
    unitCount: buildingUnits.length,
    averageSaleValue: fallbackAverageValue,
    sellUnits: normaliseNumberInput(sellUnits),
    retainUnits: normaliseNumberInput(retainUnits),
    rentUnits: normaliseNumberInput(rentUnits),
    refinanceUnits: normaliseNumberInput(refinanceUnits),
    averageRent: parseGbpInput(averageRent) ?? 0,
    ltvPercent: normaliseNumberInput(ltvPercent),
    monthlyInterestRate: normaliseNumberInput(monthlyInterestRate),
    completionMonth: normaliseNumberInput(completionMonth),
    refinanceMonth: normaliseNumberInput(refinanceMonth),
    openingDebt: parseGbpInput(openingDebt) ?? 0,
    developmentCost: parseGbpInput(developmentCost) ?? 0,
    investorRepayment: parseGbpInput(investorRepayment) ?? 0,
  });

  useEffect(() => {
    if (!buildingId && buildings[0]) setBuildingId(buildings[0].id);
    if (buildingId && !buildings.some((building) => building.id === buildingId)) setBuildingId(buildings[0]?.id ?? "");
  }, [buildingId, buildings]);

  useEffect(() => {
    if (initialBuildingId && initialBuildingId !== buildingId && buildings.some((building) => building.id === initialBuildingId)) {
      setBuildingId(initialBuildingId);
    }
  }, [buildingId, buildings, initialBuildingId]);

  async function loadForecastingData() {
    if (!buildingId || !canViewForecasting) return;
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const unitIds = buildingUnits.map((unit) => unit.id);
      const { data: scenarioRows, error: scenariosError } = await supabase
        .from("sales_forecast_scenarios")
        .select("*")
        .eq("building_id", buildingId)
        .order("updated_at", { ascending: false });
      if (scenariosError) throw scenariosError;
      setScenarios((scenarioRows ?? []) as ForecastScenario[]);

      if (unitIds.length === 0) {
        setAttempts([]);
        setTerms([]);
        return;
      }

      const { data: attemptRows, error: attemptsError } = await supabase
        .from("unit_sale_attempts")
        .select("id,unit_id,is_active")
        .in("unit_id", unitIds);
      if (attemptsError) throw attemptsError;
      setAttempts((attemptRows ?? []) as SaleAttempt[]);

      const attemptIds = (attemptRows ?? []).map((attempt) => attempt.id as string);
      if (attemptIds.length === 0) {
        setTerms([]);
        return;
      }

      const { data: termRows, error: termsError } = await supabase
        .from("unit_sale_terms")
        .select("sale_attempt_id,is_current,list_price_at_offer,contract_price")
        .in("sale_attempt_id", attemptIds);
      if (termsError) throw termsError;
      setTerms((termRows ?? []) as SaleTerms[]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load forecast data.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadForecastingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId, buildingUnits.length, canViewForecasting]);

  useEffect(() => {
    if (!sellUnits && buildingUnits.length > 0) setSellUnits(buildingUnits.filter((unit) => unit.sale_status !== "completed" && unit.sale_status !== "handed_over").length.toString());
    if (!averageSaleValue && derivedAverageValue > 0) setAverageSaleValue(Math.round(derivedAverageValue).toString());
  }, [averageSaleValue, buildingUnits, derivedAverageValue, sellUnits]);

  async function saveScenario() {
    if (!buildingId) return;
    if (!name.trim()) {
      onNotice("Name the forecast scenario before saving.");
      return;
    }
    if (totalScenarioUnits > buildingUnits.length) {
      onNotice("Scenario unit counts exceed the number of units in the selected building.");
      return;
    }

    setIsSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from("sales_forecast_scenarios").insert({
        building_id: buildingId,
        name: name.trim(),
        description: description.trim() || null,
        sell_unit_count: normaliseNumberInput(sellUnits),
        retain_unit_count: normaliseNumberInput(retainUnits),
        rent_unit_count: normaliseNumberInput(rentUnits),
        refinance_unit_count: normaliseNumberInput(refinanceUnits),
        average_sale_value: averageSaleValue ? parseGbpInput(averageSaleValue) : null,
        average_rent_per_unit: parseGbpInput(averageRent) ?? 0,
        ltv_percent: normaliseNumberInput(ltvPercent),
        monthly_interest_rate: normaliseNumberInput(monthlyInterestRate),
        completion_month: normaliseNumberInput(completionMonth),
        refinance_month: normaliseNumberInput(refinanceMonth),
        opening_debt: parseGbpInput(openingDebt) ?? 0,
        development_cost: parseGbpInput(developmentCost) ?? 0,
        investor_repayment: parseGbpInput(investorRepayment) ?? 0,
        results: currentScenario,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      });
      if (error) throw error;
      onNotice("Forecast scenario saved.");
      await loadForecastingData();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Forecast scenario could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  function loadScenario(scenario: ForecastScenario) {
    setName(scenario.name);
    setDescription(scenario.description ?? "");
    setSellUnits(scenario.sell_unit_count.toString());
    setRetainUnits(scenario.retain_unit_count.toString());
    setRentUnits(scenario.rent_unit_count.toString());
    setRefinanceUnits(scenario.refinance_unit_count.toString());
    setAverageSaleValue(inputValue(scenario.average_sale_value));
    setAverageRent(scenario.average_rent_per_unit.toString());
    setLtvPercent(scenario.ltv_percent.toString());
    setMonthlyInterestRate(scenario.monthly_interest_rate.toString());
    setCompletionMonth(scenario.completion_month.toString());
    setRefinanceMonth(scenario.refinance_month.toString());
    setOpeningDebt(scenario.opening_debt.toString());
    setDevelopmentCost(scenario.development_cost.toString());
    setInvestorRepayment(scenario.investor_repayment.toString());
  }

  if (!canViewForecasting) return null;

  return (
    <section className="panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#D6A23A]">Developer forecasting</p>
          <h2 className="mt-1 text-xl font-bold text-[#0F3D2E]">Scenario forecasting</h2>
          <p className="text-sm text-[#617169]">Compare sell, retain, rent and refinance assumptions using the selected building’s sales data.</p>
        </div>
        {!hideBuildingSelector && (
          <label className="field-label lg:w-[320px]">
            Building
            <select className="field" value={buildingId} onChange={(event) => setBuildingId(event.target.value)}>
              {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
          <h3 className="font-bold text-[#0F3D2E]">Scenario inputs</h3>
          <p className="mt-1 text-sm text-[#617169]">
            {selectedBuilding?.name ?? "Selected building"} has {buildingUnits.length} units. {currentUnitValues.length} currently have sale term values.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="field-label md:col-span-2">Scenario name<input className="field" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field-label md:col-span-2">Description<textarea className="field min-h-20" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <label className="field-label">Sell units<input className="field" inputMode="numeric" value={sellUnits} onChange={(event) => setSellUnits(event.target.value)} /></label>
            <label className="field-label">Retain units<input className="field" inputMode="numeric" value={retainUnits} onChange={(event) => setRetainUnits(event.target.value)} /></label>
            <label className="field-label">Rent units<input className="field" inputMode="numeric" value={rentUnits} onChange={(event) => setRentUnits(event.target.value)} /></label>
            <label className="field-label">Refinance units<input className="field" inputMode="numeric" value={refinanceUnits} onChange={(event) => setRefinanceUnits(event.target.value)} /></label>
            <label className="field-label">Average unit value<GbpInput value={averageSaleValue} onChange={setAverageSaleValue} aria-label="Average unit value" /></label>
            <label className="field-label">Average rent per unit<GbpInput value={averageRent} onChange={setAverageRent} aria-label="Average rent per unit" /></label>
            <label className="field-label">Refinance LTV %<input className="field" inputMode="decimal" value={ltvPercent} onChange={(event) => setLtvPercent(event.target.value)} /></label>
            <label className="field-label">Monthly interest %<input className="field" inputMode="decimal" value={monthlyInterestRate} onChange={(event) => setMonthlyInterestRate(event.target.value)} /></label>
            <label className="field-label">Completion month<input className="field" inputMode="numeric" value={completionMonth} onChange={(event) => setCompletionMonth(event.target.value)} /></label>
            <label className="field-label">Refinance month<input className="field" inputMode="numeric" value={refinanceMonth} onChange={(event) => setRefinanceMonth(event.target.value)} /></label>
            <label className="field-label">Opening debt<GbpInput value={openingDebt} onChange={setOpeningDebt} aria-label="Opening debt" /></label>
            <label className="field-label">Development cost<GbpInput value={developmentCost} onChange={setDevelopmentCost} aria-label="Development cost" /></label>
            <label className="field-label md:col-span-2">Investor repayment<GbpInput value={investorRepayment} onChange={setInvestorRepayment} aria-label="Investor repayment" /></label>
          </div>
          {totalScenarioUnits > buildingUnits.length && <p className="mt-3 rounded-md border border-[#f2c38b] bg-[#fff8ed] p-3 text-sm text-[#7a4a12]">Scenario uses {totalScenarioUnits} units, but this building has {buildingUnits.length} units.</p>}
          <div className="mt-4 flex justify-end">
            <button className="primary" onClick={() => void saveScenario()} disabled={isSaving || isLoading || totalScenarioUnits > buildingUnits.length}>Save scenario</button>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
            <h3 className="font-bold text-[#0F3D2E]">Live forecast</h3>
            <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
              <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Sale proceeds</span><strong className="numeric-value">{money(currentScenario.saleRevenue)}</strong></div>
              <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Refinance proceeds</span><strong className="numeric-value">{money(currentScenario.refinanceProceeds)}</strong></div>
              <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Retained value</span><strong className="numeric-value">{money(currentScenario.retainedValue)}</strong></div>
              <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Annual rent</span><strong className="numeric-value">{money(currentScenario.annualRent)}</strong></div>
              <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Interest cost</span><strong className="numeric-value">{formatGbpDeduction(currentScenario.interestCost)}</strong></div>
              <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Debt repaid</span><strong className="numeric-value">{formatGbpDeduction(currentScenario.debtRepaid)}</strong></div>
              <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Cash after debt</span><strong className="numeric-value text-[#0F3D2E]">{money(currentScenario.cashAfterDebt)}</strong></div>
              <div className="flex justify-between gap-4"><span>Developer profit</span><strong className="numeric-value text-[#0F3D2E]">{money(currentScenario.developerProfit)}</strong></div>
            </div>
            <p className="mt-3 text-xs text-[#617169]">Initial estimate: per-unit allocation and tax/accounting treatment can be refined in later forecasting slices.</p>
          </div>

          <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
            <h3 className="font-bold text-[#0F3D2E]">Saved scenario comparison</h3>
            {scenarios.length === 0 ? (
              <p className="mt-3 text-sm text-[#617169]">No saved scenarios yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-[#617169]">
                    <tr>
                      <th className="border-b border-[#d9ded6] py-2 pr-4">Scenario</th>
                      <th className="border-b border-[#d9ded6] py-2 pr-4 text-right">Cash after debt</th>
                      <th className="border-b border-[#d9ded6] py-2 pr-4 text-right">Developer profit</th>
                      <th className="border-b border-[#d9ded6] py-2 pr-4 text-right">Annual rent</th>
                      <th className="border-b border-[#d9ded6] py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map((scenario) => {
                      const results = scenario.results ?? calculateScenario({
                        unitCount: buildingUnits.length,
                        averageSaleValue: scenario.average_sale_value ?? fallbackAverageValue,
                        sellUnits: scenario.sell_unit_count,
                        retainUnits: scenario.retain_unit_count,
                        rentUnits: scenario.rent_unit_count,
                        refinanceUnits: scenario.refinance_unit_count,
                        averageRent: scenario.average_rent_per_unit,
                        ltvPercent: scenario.ltv_percent,
                        monthlyInterestRate: scenario.monthly_interest_rate,
                        completionMonth: scenario.completion_month,
                        refinanceMonth: scenario.refinance_month,
                        openingDebt: scenario.opening_debt,
                        developmentCost: scenario.development_cost,
                        investorRepayment: scenario.investor_repayment,
                      });
                      return (
                        <tr key={scenario.id}>
                          <td className="border-b border-[#eef0eb] py-2 pr-4 font-semibold text-[#0F3D2E]">{scenario.name}</td>
                          <td className="numeric-value border-b border-[#eef0eb] py-2 pr-4 text-right">{money(results.cashAfterDebt)}</td>
                          <td className="numeric-value border-b border-[#eef0eb] py-2 pr-4 text-right">{money(results.developerProfit)}</td>
                          <td className="numeric-value border-b border-[#eef0eb] py-2 pr-4 text-right">{money(results.annualRent)}</td>
                          <td className="border-b border-[#eef0eb] py-2 text-right"><button className="secondary" onClick={() => loadScenario(scenario)}>Load</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
