/**
 * 哲学层引擎：将段永平投资哲学落地为可量化的过滤、检查和计算函数。
 *
 * 职责：
 * - 不为清单硬过滤
 * - 能力圈边界检查
 * - 多视角共识强度计算
 * - 毛估估估值区间计算
 * - 商业模式复杂度分类
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// ─── 不为清单（Stop-Doing List）──────────────────────────────

const STOP_DOING_RULES = [
  {
    id: "management-integrity",
    label: "管理层诚信污点",
    check: (stock) => {
      const flags = stock.managementFlags ?? [];
      return flags.some((f) => ["财务造假", "公开谴责", "证监会处罚", "失信被执行人"].includes(f));
    },
  },
  {
    id: "business-model-flaw",
    label: "生意模式硬伤",
    check: (stock) => {
      const flaws = stock.businessFlaws ?? [];
      return flaws.some((f) => ["无定价权", "单一客户依赖", "技术迭代风险极高", "商业模式不可持续"].includes(f));
    },
  },
  {
    id: "excessive-leverage",
    label: "有息负债率过高",
    check: (stock) => {
      const ratio = stock.financials?.interestDebtRatio ?? stock.metrics?.interestDebtRatio ?? 0;
      return ratio > 0.7;
    },
  },
  {
    id: "audit-opinion",
    label: "审计非标意见",
    check: (stock) => {
      if (!stock.auditOpinion) return false;
      return stock.auditOpinion !== "标准无保留意见";
    },
  },
  {
    id: "chronic-losses",
    label: "连续多年亏损",
    check: (stock) => (stock.recentLossYears ?? 0) >= 3,
  },
];

/**
 * 应用不为清单硬过滤。
 * 返回 { passed: Stock[], excluded: [{stock, ruleId, label}] }
 */
export function applyStopDoingFilters(stocks) {
  const passed = [];
  const excluded = [];

  for (const stock of stocks) {
    let hit = null;

    for (const rule of STOP_DOING_RULES) {
      if (rule.check(stock)) {
        hit = rule;
        break;
      }
    }

    if (hit) {
      excluded.push({ stock, ruleId: hit.id, label: hit.label });
    } else {
      passed.push(stock);
    }
  }

  return { passed, excluded };
}

/**
 * 检查单只股票是否触发不为清单。
 * 返回 { blocked: boolean, reasons: string[] }
 */
export function checkStopDoing(stock) {
  const reasons = [];

  for (const rule of STOP_DOING_RULES) {
    if (rule.check(stock)) {
      reasons.push(rule.label);
    }
  }

  return { blocked: reasons.length > 0, reasons };
}

// ─── 能力圈（Circle of Competence）──────────────────────────

const BUSINESS_COMPLEXITY_MAP = {
  银行: "中等",
  保险: "复杂",
  证券: "复杂",
  医药生物: "复杂",
  电子: "中等",
  计算机: "复杂",
  通信设备: "中等",
  食品饮料: "简单",
  家用电器: "简单",
  电力: "简单",
  煤炭: "简单",
  公用事业: "简单",
  交通运输: "简单",
  机械设备: "中等",
};

/**
 * 判断一家公司的商业模式复杂度。
 */
export function classifyBusinessComplexity(stock) {
  return BUSINESS_COMPLEXITY_MAP[stock.industry] ?? "中等";
}

/**
 * 能力圈检查。
 * circle 为用户设置的能力圈行业列表，空数组 = 全部在圈内（不限制）。
 * 返回 { inCircle, complexity, note }
 */
export function checkCircleOfCompetence(stock, circle = []) {
  const complexity = classifyBusinessComplexity(stock);

  if (!circle || circle.length === 0) {
    return {
      inCircle: true,
      complexity,
      note: complexity === "复杂" ? "该行业商业模式复杂，建议深入研究后再做决策" : null,
    };
  }

  const inCircle = circle.includes(stock.industry);

  return {
    inCircle,
    complexity,
    note: inCircle
      ? null
      : `该行业不在您的能力圈范围内，建议谨慎对待`,
  };
}

// ─── 多视角共识强度 ────────────────────────────────────────

/**
 * 四维视角方向判定。
 * 每个视角返回 1（看多）、0（中性）、-1（看空）。
 */
function assessFundamentalDirection(stock) {
  const metrics = stock.metrics ?? {};
  const coreAvg =
    (metrics.businessModelQuality ?? metrics.businessQuality ?? 0) * 0.32 +
    (metrics.managementQuality ?? 0) * 0.22 +
    (metrics.valuation ?? 0) * 0.18 +
    (metrics.profitability ?? 0) * 0.10 +
    (metrics.cashFlow ?? 0) * 0.08 +
    (metrics.balanceSheet ?? 0) * 0.06 +
    (metrics.stability ?? 0) * 0.04;

  if (coreAvg >= 72) return 1;
  if (coreAvg < 55) return -1;
  return 0;
}

function assessValuationDirection(stock) {
  const v = stock.metrics?.valuation ?? 50;
  if (v >= 72) return 1; // 低估
  if (v < 52) return -1; // 高估
  return 0;
}

function assessSentimentDirection(stock) {
  const heat = stock.metrics?.conceptHeat ?? 50;
  const prosperity = stock.metrics?.industryProsperity ?? 50;
  const avg = (heat + prosperity) / 2;
  if (avg > 75) return -1; // 过热——反向信号
  if (avg < 35) return 1; // 冷清——可能是机会
  return 0;
}

function assessTechnicalDirection(stock) {
  // 用现有技术指标的代理：conceptHeat 高 + catalyst 高 ≈ 短期动能强
  // 资金适配中的 volatilityFit 低 + concentrationFit 低 ≈ 技术面弱
  const tech = stock.technicalSummary;
  if (!tech) return 0;

  if (tech === "偏多" || tech === "多头") return 1;
  if (tech === "偏空" || tech === "空头") return -1;
  return 0;
}

/**
 * 计算多视角共识强度。
 * 返回 { consensus, confidence, directions, note }
 *
 * consensus: "high" | "medium-high" | "medium" | "low" | "very-low"
 * confidence: 对应的中文置信度
 */
export function computeConsensusStrength(stock) {
  const fundamental = assessFundamentalDirection(stock);
  const valuation = assessValuationDirection(stock);
  const sentiment = assessSentimentDirection(stock);
  const technical = assessTechnicalDirection(stock);

  const directions = [fundamental, valuation, sentiment, technical];
  const bullish = directions.filter((d) => d === 1).length;
  const bearish = directions.filter((d) => d === -1).length;
  const neutral = directions.filter((d) => d === 0).length;

  let consensus;
  let confidence;
  let note = null;

  if (bullish === 4 || bearish === 4) {
    consensus = "high";
    confidence = "高";
  } else if ((bullish === 3 && neutral === 1) || (bearish === 3 && neutral === 1)) {
    consensus = "medium-high";
    confidence = "中高";
  } else if ((bullish === 3 && bearish === 1) || (bearish === 3 && bullish === 1)) {
    consensus = "low";
    confidence = "低";
    note = "多空分歧明显，建议深入研究后再决策";
  } else if (bullish === 2 && bearish === 2) {
    consensus = "very-low";
    confidence = "极低";
    note = "四维视角严重分歧，强烈建议谨慎对待";
  } else {
    consensus = "medium";
    confidence = "中等";
  }

  // 特殊场景检测（优先级高于通用共识说明）
  const coreScore = stock.scores?.core ?? 0;
  const heatScore = stock.metrics?.conceptHeat ?? 50;

  if (coreScore < 55 && heatScore >= 80) {
    note = "热度驱动力大于基本面——警惕追高风险";
  } else if (coreScore >= 75 && heatScore <= 25) {
    note = "市场冷落的好公司——可能被低估";
  }

  return {
    consensus,
    confidence,
    directions: {
      fundamental: fundamental === 1 ? "看多" : fundamental === -1 ? "看空" : "中性",
      valuation: valuation === 1 ? "低估" : valuation === -1 ? "高估" : "合理",
      sentiment: sentiment === 1 ? "冷清" : sentiment === -1 ? "过热" : "正常",
      technical: technical === 1 ? "偏多" : technical === -1 ? "偏空" : "震荡",
    },
    note,
  };
}

/**
 * 共识调整分：将共识强度转换为评分调整。
 * 高共识 +3 分，中高共识 +1 分，低共识 -2 分，极低共识 -5 分。
 */
export function consensusScoreAdjustment(consensus) {
  switch (consensus) {
    case "high":
      return 3;
    case "medium-high":
      return 1;
    case "medium":
      return 0;
    case "low":
      return -2;
    case "very-low":
      return -5;
    default:
      return 0;
  }
}

// ─── 毛估估估值区间 ────────────────────────────────────────

/**
 * 毛估估估值区间计算。
 * 替代原有的 buildValuationCard，输出更丰富的五档估值体系。
 */
export function computeMaoValuation(stock) {
  const price = stock.price ?? 0;
  const valuationScore = stock.metrics?.valuation ?? 50;

  // 内在价值中枢
  const uplift = 1 + (valuationScore - 50) / 80;
  const intrinsic = round(price * clamp(uplift, 0.78, 1.52));
  const conservative = round(intrinsic * 0.88);
  const optimistic = round(intrinsic * 1.12);
  const buyLow = round(conservative * 0.72);
  const buyHigh = round(conservative * 0.85);
  const marginOfSafety = round(((intrinsic - price) / Math.max(intrinsic, 1)) * 100);

  // 五档结论
  let valuationTier;
  if (valuationScore >= 78) {
    valuationTier = "低估";
  } else if (valuationScore >= 68) {
    valuationTier = "合理偏低";
  } else if (valuationScore >= 58) {
    valuationTier = "合理";
  } else if (valuationScore >= 48) {
    valuationTier = "偏高估";
  } else {
    valuationTier = "明显高估";
  }

  // 盈利收益率 vs 无风险利率（约3%）
  const pe = stock.raw?.pe ?? 0;
  const earningsYield = pe > 0 ? round((1 / pe) * 100) : null;
  const opportunityNote =
    earningsYield !== null
      ? `盈利收益率 ${earningsYield}% vs 无风险利率 ~3%${earningsYield > 5 ? "（有吸引力）" : earningsYield < 3 ? "（低于无风险利率）" : ""}`
      : null;

  return {
    valuationTier,
    intrinsicValue: intrinsic,
    conservativeValue: conservative,
    optimisticValue: optimistic,
    buyZoneLow: buyLow,
    buyZoneHigh: buyHigh,
    marginOfSafety,
    earningsYield,
    opportunityNote,
  };
}

// ─── 行业景气度标签 ─────────────────────────────────────────

/**
 * 将行业景气度数值转为文字标签。
 */
export function prosperityLabel(score) {
  if (score >= 78) return "景气上升";
  if (score >= 62) return "平稳运行";
  return "景气下行";
}

// ─── 商业模式硬伤检测 ───────────────────────────────────────

/**
 * 基于已有指标检测商业模式潜在硬伤。
 * 在真实财报数据接入前，用代理指标近似判断。
 */
export function detectBusinessFlaws(stock) {
  const flaws = [];
  const metrics = stock.metrics ?? {};

  // 毛利率极低可能意味着无定价权（代理判断）
  if (metrics.businessModelQuality !== undefined && metrics.businessModelQuality < 40) {
    flaws.push("无定价权");
  }

  // 估值极低可能意味着市场认为商业模式不可持续
  if (metrics.valuation !== undefined && metrics.valuation < 35) {
    flaws.push("商业模式不可持续");
  }

  return flaws;
}
