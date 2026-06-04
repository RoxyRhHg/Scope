import {
  applyStopDoingFilters,
  checkCircleOfCompetence,
  checkStopDoing,
  computeConsensusStrength,
  computeMaoValuation,
  consensusScoreAdjustment,
  detectBusinessFlaws,
  prosperityLabel,
} from "./philosophyEngine.js";

const DEFAULT_LIMITS = {
  minListingYears: 3,
  minLiquidityScore: 45,
  minCoreScoreForRanking: 55,
  minCoreScoreForFocus: 78,
  maxRiskFlagsForFocus: 1,
};

const DEFAULT_BREAKDOWNS = {
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
    const value = metrics[key] ?? 0;
    return sum + value * weight;
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
    core: settings.weights?.core ?? 0.62,
    auxiliary: settings.weights?.auxiliary ?? 0.18,
    capitalFit: settings.weights?.capitalFit ?? 0.12,
    consensus: settings.weights?.consensus ?? 0.08,
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

/**
 * 解析生意模式质量分。兼容旧字段名 businessQuality。
 */
function resolveBusinessModelScore(metrics) {
  return metrics.businessModelQuality ?? metrics.businessQuality ?? 0;
}

function buildDerivedRiskFlags(stock, scores) {
  const flags = [...(stock.riskFlags ?? [])];

  if (stock.metrics?.valuation < 52) {
    flags.push("估值偏高");
  }

  if (stock.metrics?.cashFlow < 55) {
    flags.push("现金流偏弱");
  }

  if (stock.metrics?.balanceSheet < 55) {
    flags.push("负债承压");
  }

  if (stock.metrics?.stability < 52) {
    flags.push("经营波动偏大");
  }

  if (scores.capitalFit < 45) {
    flags.push("资金适配一般");
  }

  if ((stock.metrics?.conceptHeat ?? 0) > 85) {
    flags.push("概念过热");
  }

  // 检测商业模式硬伤
  const flaws = detectBusinessFlaws(stock);
  for (const flaw of flaws) {
    flags.push(flaw);
  }

  return Array.from(new Set(flags));
}

function buildConclusion(scores, valuationTier, thresholds, consensusConfidence, stopDoingBlocked) {
  if (stopDoingBlocked) {
    return "明确回避";
  }

  if (scores.core < thresholds.minCoreScoreForRanking) {
    return "暂不推荐";
  }

  if (valuationTier === "明显高估") {
    return "估值偏贵";
  }

  if (valuationTier === "偏高估" && scores.core < thresholds.minCoreScoreForFocus) {
    return "估值偏贵";
  }

  // 低共识时降级
  if (consensusConfidence === "极低" || consensusConfidence === "低") {
    return "继续研究";
  }

  if (scores.core >= thresholds.minCoreScoreForFocus && scores.capitalFit >= 60 && consensusConfidence !== "低") {
    return "重点关注";
  }

  if (scores.core >= 72 && scores.core < thresholds.minCoreScoreForFocus) {
    return "值得观察";
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

  // 不为清单二次过滤（在已有过滤之后）
  const { passed: sdPassed, excluded: sdExcluded } = applyStopDoingFilters(eligible);

  return {
    eligible: sdPassed,
    excluded: [
      ...excluded,
      ...sdExcluded.map((e) => ({
        stock: e.stock,
        reason: e.label,
        ruleId: e.ruleId,
      })),
    ],
  };
}

export function computeStockScores(stock, settings = {}) {
  const thresholds = getThresholds(settings);
  const breakdowns = getBreakdowns(settings);
  const topWeights = getTopWeights(settings);

  // 构建核心评分用的 metrics 映射（兼容新旧字段名）
  const coreMetrics = {
    businessModelQuality: resolveBusinessModelScore(stock.metrics ?? {}),
    managementQuality: stock.metrics?.managementQuality ?? 0,
    valuation: stock.metrics?.valuation ?? 0,
    profitability: stock.metrics?.profitability ?? 0,
    cashFlow: stock.metrics?.cashFlow ?? 0,
    balanceSheet: stock.metrics?.balanceSheet ?? 0,
    stability: stock.metrics?.stability ?? 0,
  };

  const affordability = computeAffordabilityScore(stock, settings);
  const capitalMetrics = {
    affordability,
    liquidity: stock.metrics?.liquidity ?? stock.liquidityScore ?? 0,
    concentrationFit: stock.metrics?.concentrationFit ?? 0,
    volatilityFit: stock.metrics?.volatilityFit ?? 0,
  };

  const scores = {
    core: round(scoreFromWeightedMetrics(coreMetrics, breakdowns.coreBreakdown)),
    auxiliary: round(scoreFromWeightedMetrics(stock.metrics ?? {}, breakdowns.auxiliaryBreakdown)),
    capitalFit: round(scoreFromWeightedMetrics(capitalMetrics, breakdowns.capitalBreakdown)),
  };

  // 共识计算
  const consensusResult = computeConsensusStrength({ ...stock, scores });
  const consensusAdjustment = consensusScoreAdjustment(consensusResult.consensus);

  // 概念过热降权
  const conceptHeat = stock.metrics?.conceptHeat ?? 0;
  const auxiliaryDampener = conceptHeat > 85 ? 0.5 : 1.0;

  const total =
    scores.core * topWeights.core +
    scores.auxiliary * topWeights.auxiliary * auxiliaryDampener +
    scores.capitalFit * topWeights.capitalFit +
    consensusAdjustment * topWeights.consensus;

  // 毛估估估值
  const maoValuation = computeMaoValuation(stock);

  // 不为清单检查
  const stopDoing = checkStopDoing(stock);

  // 风险标记
  const riskFlags = buildDerivedRiskFlags(stock, scores);

  // 结论
  const conclusion = buildConclusion(scores, maoValuation.valuationTier, thresholds, consensusResult.confidence, stopDoing.blocked);

  return {
    ...stock,
    scores: {
      ...scores,
      total: round(total),
      consensusAdjustment: round(consensusAdjustment),
    },
    affordabilityScore: affordability,
    lotCost: getLotCost(stock),
    valuationCard: maoValuation, // 保持向后兼容，同时包含新字段
    maoValuation,
    riskFlags,
    conclusion,
    consensus: consensusResult,
    stopDoingBlocked: stopDoing.blocked,
    stopDoingReasons: stopDoing.reasons,
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
  const userCircle = settings.competenceCircle ?? [];

  return rankedStocks
    .filter((stock) => stock.scores.core >= thresholds.minCoreScoreForFocus)
    .filter((stock) => stock.riskFlags.length <= thresholds.maxRiskFlagsForFocus)
    .filter((stock) => {
      const tier = stock.valuationCard?.valuationTier ?? stock.maoValuation?.valuationTier;
      return tier !== "明显高估" && tier !== "偏高估";
    })
    // 硬过滤：价格必须在买入区间内
    .filter((stock) => {
      const mv = stock.maoValuation;
      if (!mv || !mv.buyZoneHigh) return false;
      return stock.price <= mv.buyZoneHigh;
    })
    // 硬过滤：安全边际至少 10%
    .filter((stock) => {
      const mv = stock.maoValuation;
      if (!mv || mv.marginOfSafety == null) return false;
      return mv.marginOfSafety >= 10;
    })
    // 硬过滤：估值档位必须是低估或合理偏低
    .filter((stock) => {
      const tier = stock.valuationCard?.valuationTier ?? stock.maoValuation?.valuationTier;
      return tier === "低估" || tier === "合理偏低";
    })
    .filter((stock) => stock.scores.capitalFit >= 60)
    .filter((stock) => {
      const consensus = stock.consensus?.consensus;
      return consensus !== "very-low" && consensus !== "low";
    })
    .filter((stock) => {
      if (userCircle.length === 0) return true;
      return userCircle.includes(stock.industry);
    })
    .slice(0, limit);
}

export function buildIndustryTop(rankedStocks, industry, limit = 20) {
  return rankedStocks.filter((stock) => stock.industry === industry).slice(0, limit);
}

export function buildConceptTop(rankedStocks, concept, limit = 10) {
  if (!concept || concept === "全部概念") return [];

  // 在该概念内取核心分最高的，排除明确不能碰的（估值过高/不为清单/回避）
  const EXCLUDED = new Set(["估值偏贵", "明确回避", "暂不推荐"]);

  return rankedStocks
    .filter((stock) => (stock.concepts ?? []).includes(concept))
    .filter((stock) => !EXCLUDED.has(stock.conclusion ?? ""))
    .filter((stock) => !stock.stopDoingBlocked)
    .filter((stock) => {
      const tier = stock.maoValuation?.valuationTier ?? "";
      return tier !== "明显高估" && tier !== "偏高估";
    })
    .slice(0, limit);
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
      prosperityLabel: prosperityLabel(item.averageCore),
    }))
    .sort((left, right) => right.averageTotal - left.averageTotal);
}

export function getAvailableIndustries(rankedStocks) {
  const industries = new Set();
  for (const stock of rankedStocks) {
    industries.add(stock.industry);
  }
  return Array.from(industries).sort((a, b) => a.localeCompare(b, "zh-CN"));
}
