const DEFAULT_LIMITS = {
  minListingYears: 3,
  minLiquidityScore: 45,
  minCoreScoreForRanking: 60,
  minCoreScoreForFocus: 72,
  maxRiskFlagsForFocus: 1,
};

const DEFAULT_BREAKDOWNS = {
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
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function normalizeWeights(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  if (!total) {
    const fallback = 1 / entries.length;
    return Object.fromEntries(entries.map(([key]) => [key, fallback]));
  }

  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

function scoreFromWeightedMetrics(metrics, weights) {
  const normalized = normalizeWeights(weights);
  return Object.entries(normalized).reduce((sum, [key, weight]) => {
    return sum + (metrics[key] ?? 0) * weight;
  }, 0);
}

function getThresholds(settings = {}) {
  return { ...DEFAULT_LIMITS, ...(settings.thresholds ?? {}) };
}

function getBreakdowns(settings = {}) {
  return {
    coreBreakdown: {
      ...DEFAULT_BREAKDOWNS.coreBreakdown,
      ...(settings.weights?.coreBreakdown ?? {}),
    },
    auxiliaryBreakdown: {
      ...DEFAULT_BREAKDOWNS.auxiliaryBreakdown,
      ...(settings.weights?.auxiliaryBreakdown ?? {}),
    },
    capitalBreakdown: {
      ...DEFAULT_BREAKDOWNS.capitalBreakdown,
      ...(settings.weights?.capitalBreakdown ?? {}),
    },
  };
}

function getTopWeights(settings = {}) {
  const raw = {
    core: settings.weights?.core ?? 0.68,
    auxiliary: settings.weights?.auxiliary ?? 0.17,
    capitalFit: settings.weights?.capitalFit ?? 0.15,
  };

  return normalizeWeights(raw);
}

function getLotCost(stock) {
  if (Number.isFinite(stock.lotCost)) {
    return stock.lotCost;
  }

  return round((stock.price ?? 0) * 100);
}

function computeAffordabilityScore(stock, settings = {}) {
  const availableCapital = Math.max(settings.availableCapital ?? 10000, 1000);
  const lotCost = Math.max(getLotCost(stock), 1);

  if (lotCost > availableCapital) {
    return 12;
  }

  const ratio = lotCost / availableCapital;
  const ideal = 0.22;
  const distance = Math.abs(ratio - ideal);
  const score = 100 - (distance / ideal) * 70;

  return clamp(round(score), 25, 98);
}

function buildDerivedRiskFlags(stock, scores) {
  const flags = [...(stock.riskFlags ?? [])];

  if (stock.metrics?.valuation < 50) {
    flags.push("估值偏高");
  }

  if (stock.metrics?.cashFlow < 58) {
    flags.push("现金流偏弱");
  }

  if (stock.metrics?.balanceSheet < 58) {
    flags.push("负债承压");
  }

  if (stock.metrics?.stability < 56) {
    flags.push("经营波动偏大");
  }

  if (scores.capitalFit < 45) {
    flags.push("小资金适配一般");
  }

  return Array.from(new Set(flags));
}

function buildValuationCard(stock) {
  const valuationScore = stock.metrics?.valuation ?? 50;
  const price = stock.price ?? 0;
  const uplift = 1 + (valuationScore - 50) / 80;
  const intrinsic = round(price * clamp(uplift, 0.82, 1.48));
  const conservative = round(intrinsic * 0.92);
  const optimistic = round(intrinsic * 1.1);
  const buyLow = round(conservative * 0.72);
  const buyHigh = round(conservative * 0.85);
  const marginOfSafety = round(((intrinsic - price) / Math.max(intrinsic, 1)) * 100);

  let status = "合理";
  if (valuationScore >= 78) {
    status = "低估";
  } else if (valuationScore < 58) {
    status = "偏高估";
  }

  return {
    status,
    conservativeValue: conservative,
    optimisticValue: optimistic,
    buyRangeLow: buyLow,
    buyRangeHigh: buyHigh,
    marginOfSafety,
  };
}

function buildConclusion(scores, valuationCard, thresholds) {
  if (scores.core < thresholds.minCoreScoreForRanking) {
    return "暂不推荐";
  }

  if (valuationCard.status === "偏高估" && scores.core >= thresholds.minCoreScoreForFocus) {
    return "估值偏贵";
  }

  if (scores.core >= thresholds.minCoreScoreForFocus && scores.capitalFit >= 60) {
    return "重点关注";
  }

  return "值得观察";
}

export function applyRiskFilters(stocks, settings = {}) {
  const thresholds = getThresholds(settings);
  const eligible = [];
  const excluded = [];

  for (const stock of stocks) {
    let reason = null;

    if (stock.isST) {
      reason = "ST风险";
    } else if (stock.isSuspended) {
      reason = "停牌状态";
    } else if ((stock.listingYears ?? 0) < thresholds.minListingYears) {
      reason = "上市时间过短";
    } else if ((stock.recentProfitYears ?? 0) <= 0) {
      reason = "长期亏损";
    } else if (!stock.hasCompleteFinancials) {
      reason = "财务数据缺失";
    } else if ((stock.liquidityScore ?? 0) < thresholds.minLiquidityScore) {
      reason = "流动性不足";
    }

    if (reason) {
      excluded.push({ stock, reason });
    } else {
      eligible.push(stock);
    }
  }

  return { eligible, excluded };
}

export function computeStockScores(stock, settings = {}) {
  const thresholds = getThresholds(settings);
  const breakdowns = getBreakdowns(settings);
  const topWeights = getTopWeights(settings);

  const affordability = computeAffordabilityScore(stock, settings);
  const capitalMetrics = {
    affordability,
    liquidity: stock.metrics?.liquidity ?? stock.liquidityScore ?? 0,
    concentrationFit: stock.metrics?.concentrationFit ?? 0,
    volatilityFit: stock.metrics?.volatilityFit ?? 0,
  };

  const scores = {
    core: round(scoreFromWeightedMetrics(stock.metrics ?? {}, breakdowns.coreBreakdown)),
    auxiliary: round(scoreFromWeightedMetrics(stock.metrics ?? {}, breakdowns.auxiliaryBreakdown)),
    capitalFit: round(scoreFromWeightedMetrics(capitalMetrics, breakdowns.capitalBreakdown)),
  };

  const total =
    scores.core * topWeights.core +
    scores.auxiliary * topWeights.auxiliary +
    scores.capitalFit * topWeights.capitalFit;

  const valuationCard = buildValuationCard(stock);
  const riskFlags = buildDerivedRiskFlags(stock, scores);
  const conclusion = buildConclusion(scores, valuationCard, thresholds);

  return {
    ...stock,
    scores: {
      ...scores,
      total: round(total),
    },
    affordabilityScore: affordability,
    lotCost: getLotCost(stock),
    valuationCard,
    riskFlags,
    conclusion,
  };
}

export function rankStocks(stocks, settings = {}) {
  const thresholds = getThresholds(settings);
  const { eligible } = applyRiskFilters(stocks, settings);

  return eligible
    .map((stock) => computeStockScores(stock, settings))
    .filter((stock) => stock.scores.core >= thresholds.minCoreScoreForRanking)
    .sort((left, right) => right.scores.total - left.scores.total);
}

export function pickFocusStocks(rankedStocks, settings = {}, limit = 10) {
  const thresholds = getThresholds(settings);

  return rankedStocks
    .filter((stock) => stock.scores.core >= thresholds.minCoreScoreForFocus)
    .filter((stock) => stock.riskFlags.length <= thresholds.maxRiskFlagsForFocus)
    .filter((stock) => stock.valuationCard.status !== "偏高估")
    .filter((stock) => stock.scores.capitalFit >= 60)
    .slice(0, limit);
}

export function buildIndustryTop(rankedStocks, industry, limit = 20) {
  return rankedStocks.filter((stock) => stock.industry === industry).slice(0, limit);
}

export function summarizeIndustries(rankedStocks) {
  const byIndustry = new Map();

  for (const stock of rankedStocks) {
    const current = byIndustry.get(stock.industry) ?? {
      industry: stock.industry,
      count: 0,
      averageTotal: 0,
      averageCore: 0,
      averageAuxiliary: 0,
    };

    current.count += 1;
    current.averageTotal += stock.scores.total;
    current.averageCore += stock.scores.core;
    current.averageAuxiliary += stock.scores.auxiliary;
    byIndustry.set(stock.industry, current);
  }

  return Array.from(byIndustry.values())
    .map((item) => ({
      ...item,
      averageTotal: round(item.averageTotal / item.count),
      averageCore: round(item.averageCore / item.count),
      averageAuxiliary: round(item.averageAuxiliary / item.count),
    }))
    .sort((left, right) => right.averageTotal - left.averageTotal);
}
