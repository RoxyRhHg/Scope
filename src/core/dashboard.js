import {
  applyRiskFilters,
  buildConceptTop,
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
    competenceCircle: [],
    weights: {
      core: 0.62,
      auxiliary: 0.18,
      capitalFit: 0.12,
      consensus: 0.08,
      coreBreakdown: {
        businessModelQuality: 0.32,
        managementQuality: 0.22,
        valuation: 0.18,
        profitability: 0.10,
        cashFlow: 0.08,
        balanceSheet: 0.06,
        stability: 0.04,
      },
      auxiliaryBreakdown: {
        industryProsperity: 0.4,
        conceptHeat: 0.25,
        catalyst: 0.35,
      },
      capitalBreakdown: {
        affordability: 0.4,
        liquidity: 0.25,
        concentrationFit: 0.2,
        volatilityFit: 0.15,
      },
    },
    thresholds: {
      minListingYears: 3,
      minLiquidityScore: 45,
      minCoreScoreForRanking: 55,
      minCoreScoreForFocus: 78,
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

  // 确保核心概念始终在列表中
  const coreConcepts = ["AI", "半导体", "光通信", "芯片", "数据", "算力", "存储", "能源", "银行", "具身智能", "ARVR"];
  for (const c of coreConcepts) {
    concepts.add(c);
  }

  return ["全部概念", ...Array.from(concepts).sort((left, right) => left.localeCompare(right, "zh-CN"))];
}

function normalizeSelectedIndustry(selectedIndustry, industries) {
  if (!selectedIndustry || selectedIndustry === "全部行业") {
    return "全部行业";
  }

  return industries.some((item) => item.industry === selectedIndustry) ? selectedIndustry : "全部行业";
}

function normalizeSelectedConcept(selectedConcept, availableConcepts) {
  if (!selectedConcept || selectedConcept === "全部概念") {
    return "全部概念";
  }

  return availableConcepts.includes(selectedConcept) ? selectedConcept : "全部概念";
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
  const industries = summarizeIndustries(rankedAll);
  const availableConcepts = getAvailableConcepts(snapshot.items);
  const normalizedSettings = {
    ...settings,
    selectedIndustry: normalizeSelectedIndustry(settings.selectedIndustry, industries),
    selectedConcept: normalizeSelectedConcept(settings.selectedConcept, availableConcepts),
  };
  const rankedVisible = applyFrontFilters(rankedAll, normalizedSettings);
  const selectedIndustry =
    normalizedSettings.selectedIndustry && normalizedSettings.selectedIndustry !== "全部行业"
      ? normalizedSettings.selectedIndustry
      : industries[0]?.industry ?? "全部行业";
  const sectorTop = buildIndustryTop(rankedAll, selectedIndustry, 20);
  const conceptTop = buildConceptTop(rankedAll, normalizedSettings.selectedConcept, 10);
  const focus = pickFocusStocks(rankedAll, settings);

  return {
    snapshot,
    rankedAll,
    rankedVisible,
    top50: rankedVisible.slice(0, 50),
    industries,
    focus,
    sectorTop,
    conceptTop,
    selectedIndustry,
    selectedConcept: normalizedSettings.selectedConcept,
    availableConcepts,
    normalizedSettings,
    eligibleCount: filteredByRisk.eligible.length,
    excludedCount: filteredByRisk.excluded.length,
    excludedPreview: filteredByRisk.excluded.slice(0, 5),
  };
}
