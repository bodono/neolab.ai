import type { CompiledContent } from "@neolab/content-schema";

import { calculateGpuFinanceCosts } from "../compute/gpu-market.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import { projectMarketCycleRevenue } from "../market/market.ts";
import { staffPayrollMarketMultiplier } from "../researchers/talent-market.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type {
  FinanceLedgerCategory,
  FinanceLedgerEntry,
  GameState,
} from "../model/state.ts";
import { cashMillions, type CashMillions, type Tick } from "../model/units.ts";

/** Six- and nine-month warnings before the hard one-year insolvency backstop. */
export const NEGATIVE_CASH_WARNING_WEEKS = [26, 39] as const;
export const NEGATIVE_CASH_BANKRUPTCY_WEEKS = 52;

/**
 * Keep two years of exact cycle settlements for finance inspection and
 * debugging. Cash already carries the cumulative result; retaining every
 * recurring payroll and revenue line forever made long-run save files grow by
 * several megabytes without changing any mechanic or player-facing view.
 */
export const FINANCE_HISTORY_RETENTION_WEEKS = 104;

function roundMoney(value: number): CashMillions {
  return cashMillions(Math.round(value * 1_000_000) / 1_000_000);
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

export interface FinanceRuleLine {
  readonly category: FinanceLedgerCategory;
  readonly sourceId: string;
  /** Signed: positive income, negative expense. */
  readonly amountMillions: CashMillions;
  readonly description: string;
}

/** The single cycle-line generator shared by forecast and settlement. */
export function calculateCycleFinanceLines(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  capabilitySource: "true" | "measured" = "true",
): readonly FinanceRuleLine[] {
  const lab = requireLab(state, labId);
  const balance = content.balance.newGame.finance;
  const modifierScope = {
    labId,
    includeUnscoped: labId === state.run.playerLabId,
  } as const;
  // DELIBERATE: lab.revenue.all is a claim on cash flows, not a change in the
  // business's earning power, so it lands here on the ledger and is invisible to
  // valuation. The mark is priced from segment.lastCycleRevenueMillions, which
  // the market settlement writes earlier in the tick, before this modifier
  // exists -- so a lab carrying a revenue-share funding condition, or the x0.9
  // political penalty in politics.ts, banks less while still being valued on
  // gross revenue.
  //
  // That is the intended reading: an acquirer prices the underlying revenue and
  // treats a partner's cut as a liability against it. It also keeps each penalty
  // to one clean effect -- suppressing the mark as well would shrink the next
  // funding round too, and a penalty that eats itself twice is the defect this
  // codebase keeps finding (see docs/funding-conditions-audit.md).
  //
  // If that is ever revisited, the fix is to apply this at settlement so the
  // stored segment revenue is already net, NOT to add a second deduction here.
  const revenue = resolveModifierValue(
    state,
    "lab.revenue.all",
    projectMarketCycleRevenue(state, content, labId, capabilitySource),
    { ...modifierScope, clampMin: 0 },
  ).final;
  const executiveCost = resolveModifierValue(
    state,
    "lab.finance.executiveCostPerCycle",
    balance.executiveCostPerCycle,
    { ...modifierScope, clampMin: 0 },
  ).final;
  const gpuCosts = calculateGpuFinanceCosts(state, content, labId);
  // Ordinary staff pay rides the AGI-proximity boom with no contract lag:
  // engineers, the general researcher pool, and the executive suite are paid
  // at the live market every cycle, so late-game headcount is a live cost
  // decision rather than a bargain locked in early. Star contracts lag via
  // their annual reviews. Nobody in an AI lab is priced by the calendar.
  const staffMarket = staffPayrollMarketMultiplier(state, state.run.tick);
  const rawCosts: readonly {
    readonly category: FinanceLedgerCategory;
    readonly sourceId: string;
    readonly amount: number;
    readonly description: string;
  }[] = [
    {
      category: "payroll-research",
      sourceId: "staff.general-researchers",
      amount:
        lab.organisation.generalResearchers *
        balance.generalResearcherCostPerCycle *
        staffMarket,
      description: "General researcher payroll",
    },
    ...lab.roster.researcherIds.flatMap((researcherId) => {
      const researcher = state.researchers[researcherId];
      if (
        researcher?.employerLabId !== labId ||
        researcher.contract === undefined ||
        (researcher.status !== "employed" && researcher.status !== "sabbatical")
      ) {
        return [];
      }
      const definition = content.researchers.definitions[researcher.definitionId];
      return [
        {
          category: "payroll-research" as const,
          sourceId: researcherId,
          amount: researcher.contract.salaryPerCycle,
          description: `${definition?.displayName ?? researcherId} salary`,
        },
      ];
    }),
    {
      category: "payroll-engineering",
      sourceId: "staff.engineering-and-ops",
      amount:
        lab.organisation.engineersAndOps *
        balance.engineerAndOpsCostPerCycle *
        staffMarket,
      description: "Engineering and operations payroll",
    },
    ...lab.facilities.instances.map((instance, index) => {
      const definition = content.facilities[instance.definitionId];
      return {
        category: "facility" as const,
        sourceId: instance.id ?? `facility:${instance.definitionId}:${String(index)}`,
        amount:
          definition?.operatingCostMillionsPerCycle ??
          balance.facilityCostPerInstancePerCycle,
        description: `${definition?.displayName ?? instance.definitionId} operations`,
      };
    }),
    {
      category: "executive",
      sourceId: "leadership.executive",
      amount: executiveCost * staffMarket,
      description: "Executive and leadership overhead",
    },
    ...gpuCosts.lines.map((line) => ({
      category: line.category,
      sourceId: line.sourceId,
      amount: line.amountMillionsPerCycle,
      description:
        line.category === "compute-lease"
          ? "GPU lease and cloud contract"
          : "Owned GPU electricity, cooling and operations",
    })),
  ];
  const rawFixedCost = rawCosts.reduce((sum, line) => sum + line.amount, 0);
  const finalFixedCost = resolveModifierValue(state, "lab.costs.fixed", rawFixedCost, {
    ...modifierScope,
    clampMin: 0,
  }).final;
  const fixedCostScale = rawFixedCost === 0 ? 0 : finalFixedCost / rawFixedCost;

  return [
    {
      category: "product-revenue",
      sourceId: "market.public-product",
      amountMillions: roundMoney(revenue),
      description: "Model serving revenue",
    },
    ...rawCosts.map((line): FinanceRuleLine => ({
      category: line.category,
      sourceId: line.sourceId,
      amountMillions: roundMoney(-line.amount * fixedCostScale),
      description: line.description,
    })),
  ];
}

export interface RunwayView {
  readonly isInfinite: boolean;
  readonly weeks: number | null;
  readonly band: "healthy" | "warning" | "critical";
  readonly explanation: string;
}

export function calculateRunway(
  cash: CashMillions,
  projectedNetPerCycle: CashMillions,
): RunwayView {
  if (projectedNetPerCycle >= 0) {
    return {
      isInfinite: true,
      weeks: null,
      band: "healthy",
      explanation: "Projected cashflow is non-negative at the current plan.",
    };
  }
  const weeks = (Math.max(0, cash) / Math.max(0.1, 0 - projectedNetPerCycle)) * 4;
  return {
    isInfinite: false,
    weeks,
    band: weeks < 4 ? "critical" : weeks < 12 ? "warning" : "healthy",
    explanation: `${weeks.toFixed(1)} weeks at the current projected burn.`,
  };
}

export interface FinanceForecast {
  readonly horizonCycles: number;
  readonly openingCashMillions: CashMillions;
  readonly linesPerCycle: readonly FinanceRuleLine[];
  readonly incomeMillionsPerCycle: CashMillions;
  readonly outgoingsMillionsPerCycle: CashMillions;
  readonly netMillionsPerCycle: CashMillions;
  readonly projectedClosingCashMillions: CashMillions;
  readonly runway: RunwayView;
}

export function forecastFinance(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  horizonCycles = 1,
  capabilitySource: "true" | "measured" = "true",
): FinanceForecast {
  if (!Number.isInteger(horizonCycles) || horizonCycles <= 0) {
    throw new RangeError("Finance forecast horizon must be a positive integer");
  }
  const lab = requireLab(state, labId);
  const lines = calculateCycleFinanceLines(state, content, labId, capabilitySource);
  const income = lines.reduce((sum, line) => sum + Math.max(0, line.amountMillions), 0);
  const outgoings = lines.reduce(
    (sum, line) => sum + Math.max(0, 0 - line.amountMillions),
    0,
  );
  const net = income - outgoings;
  return {
    horizonCycles,
    openingCashMillions: lab.finance.cash,
    linesPerCycle: lines,
    incomeMillionsPerCycle: roundMoney(income),
    outgoingsMillionsPerCycle: roundMoney(outgoings),
    netMillionsPerCycle: roundMoney(net),
    projectedClosingCashMillions: roundMoney(lab.finance.cash + net * horizonCycles),
    runway: calculateRunway(lab.finance.cash, cashMillions(net)),
  };
}

export interface CycleSettlement {
  readonly settlementId: string;
  readonly labId: LabId;
  readonly settledAt: Tick;
  readonly openingCashMillions: CashMillions;
  readonly entries: readonly FinanceLedgerEntry[];
  readonly netMillions: CashMillions;
  readonly closingCashMillions: CashMillions;
  readonly runway: RunwayView;
}

export function settleCycle(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  settledAt: Tick,
): CycleSettlement {
  const state = tx.read();
  const lab = requireLab(state, labId);
  const opening = lab.finance.cash;
  const settlementId = `finance:${labId}:cycle:${String(settledAt)}`;
  if (lab.finance.settlements.some((settlement) => settlement.id === settlementId)) {
    throw new Error(`Cycle ${settlementId} has already settled`);
  }
  const forecast = forecastFinance(state, content, labId);
  const entries = forecast.linesPerCycle.map((line, index): FinanceLedgerEntry => ({
    id: `${settlementId}:${String(index).padStart(2, "0")}`,
    settledAt,
    settlementId,
    category: line.category,
    sourceId: line.sourceId,
    amountMillions: line.amountMillions,
    description: line.description,
  }));
  const net = roundMoney(entries.reduce((sum, entry) => sum + entry.amountMillions, 0));
  const closing = roundMoney(opening + net);
  tx.update((draft) => {
    const mutableLab = draft.labs[labId];
    if (mutableLab === undefined)
      throw new Error(`Settlement targets unknown lab ${labId}`);
    mutableLab.finance.cash = closing;
    mutableLab.finance.ledger.push(...structuredClone(entries));
    mutableLab.finance.settlements.push({
      id: settlementId,
      settledAt,
      openingCashMillions: opening,
      closingCashMillions: closing,
    });
    const historyCutoff = settledAt - FINANCE_HISTORY_RETENTION_WEEKS;
    mutableLab.finance.settlements = mutableLab.finance.settlements.filter(
      (settlement) => settlement.settledAt >= historyCutoff,
    );
    const retainedSettlementIds = new Set(
      mutableLab.finance.settlements.map((settlement) => settlement.id),
    );
    mutableLab.finance.ledger = mutableLab.finance.ledger.filter(
      (entry) =>
        entry.settlementId === undefined || retainedSettlementIds.has(entry.settlementId),
    );
  });
  return {
    settlementId,
    labId,
    settledAt,
    openingCashMillions: opening,
    entries,
    netMillions: net,
    closingCashMillions: closing,
    runway: calculateRunway(closing, forecast.netMillionsPerCycle),
  };
}
