import {
  applyRiskFilters,
  buildIndustryTop,
  pickFocusStocks,
  rankStocks,
  summarizeIndustries,
} from "./ranking.js";

export function createDefaultSettings() {
  return {
    availableCapital: 12000,
    autoRefreshMinutes: 60,
    selectedIndustry: "全部行业",
    selectedConcept: "全部概念",
    weights: {
      core: 0.68,
      auxiliary: 0.17,
      capitalFit: 0.15,
      coreBreakdown: {
        businessQuality: 0.24,
        profitability: 0.18,
        cashFlow: 0.18,
        balanceSheet: 0.16,
        valuation: 0.16,
        stability: 0.08,
      },
      auxiliaryBreakdown: {
        industryProsperity: 0.5,
        conceptHeat: 0.2,
        catalyst: 0.3,
      },
      capitalBreakdown: {
        affordability: 0.34,
        liquidity: 0.26,
        concentrationFit: 0.24,
        volatilityFit: 0.16,
      },
    },
    thresholds: {
      minListingYears: 3,
      minLiquidityScore: 45,
      minCoreScoreForRanking: 60,
      minCoreScoreForFocus: 72,
      maxRiskFlagsForFocus: 1,
    },
  };
}

export function getAvailableConcepts(stocks) {
  const concepts = new Set();

  for (const stock of stocks) {
    for (const concept of stock.concepts ?? []) {
      concepts.add(concept);
    }
  }

  return ["全部概念", ...Array.from(concepts).sort((left, right) => left.localeCompare(right, "zh-CN"))];
}

function applyFrontFilters(rankedStocks, settings) {
  return rankedStocks.filter((stock) => {
    const industryOkay =
      !settings.selectedIndustry ||
      settings.selectedIndustry === "全部行业" ||
      stock.industry === settings.selectedIndustry;

    const conceptOkay =
      !settings.selectedConcept ||
      settings.selectedConcept === "全部概念" ||
      stock.concepts.includes(settings.selectedConcept);

    return industryOkay && conceptOkay;
  });
}

export function buildDashboardModel(snapshot, settings) {
  const filteredByRisk = applyRiskFilters(snapshot.items, settings);
  const rankedAll = rankStocks(snapshot.items, settings);
  const rankedVisible = applyFrontFilters(rankedAll, settings);
  const industries = summarizeIndustries(rankedAll);
  const selectedIndustry =
    settings.selectedIndustry && settings.selectedIndustry !== "全部行业"
      ? settings.selectedIndustry
      : industries[0]?.industry ?? "全部行业";
  const sectorTop = buildIndustryTop(rankedAll, selectedIndustry, 20);
  const focus = pickFocusStocks(rankedAll, settings);

  return {
    snapshot,
    rankedAll,
    rankedVisible,
    top50: rankedVisible.slice(0, 50),
    industries,
    focus,
    sectorTop,
    selectedIndustry,
    availableConcepts: getAvailableConcepts(snapshot.items),
    eligibleCount: filteredByRisk.eligible.length,
    excludedCount: filteredByRisk.excluded.length,
    excludedPreview: filteredByRisk.excluded.slice(0, 5),
  };
}
