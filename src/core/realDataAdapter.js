import { assignConcepts } from "./conceptAdapter.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function inferMarket(code) {
  if (String(code).startsWith("6")) {
    return "SH";
  }

  return "SZ";
}

function scoreValuation(pe, pb) {
  let score = 72;

  if (pe > 0) {
    score -= clamp((pe - 12) * 1.2, -12, 28);
  }

  if (pb > 0) {
    score -= clamp((pb - 1.8) * 6.5, -10, 24);
  }

  return clamp(Math.round(score), 28, 92);
}

function scoreProfitability(pe, pb, marketCap) {
  let score = 68;
  if (pe > 0 && pe < 18) score += 8;
  if (pb > 0 && pb < 2.5) score += 5;
  if (marketCap > 5e10) score += 6;
  if (marketCap > 2e11) score += 4;
  return clamp(score, 35, 88);
}

function scoreBusinessModelQuality(marketCap, pe, grossMargin) {
  let score = 62;
  // 市值：大市值通常意味着行业地位稳固
  if (marketCap > 1e11) score += 10;
  if (marketCap > 5e11) score += 8;
  // PE 合理：估值合理的公司通常有更可靠的商业模式
  if (pe > 0 && pe < 28) score += 6;
  // 毛利率：高毛利率通常代表定价权和护城河
  if (grossMargin > 0.4) score += 8;
  if (grossMargin > 0.6) score += 6;
  return clamp(score, 32, 92);
}

function scoreManagementQuality(marketCap, dividendYield, pe) {
  let score = 60;
  // 大市值公司通常治理更规范
  if (marketCap > 5e10) score += 8;
  if (marketCap > 2e11) score += 6;
  // 有分红且合理表示对股东友好
  if (dividendYield > 1.5 && dividendYield < 8) score += 8;
  if (dividendYield > 2.5 && dividendYield < 6) score += 6;
  // 估值合理表示管理层没有过度炒作
  if (pe > 0 && pe < 35) score += 6;
  return clamp(score, 30, 88);
}

function scoreBalanceSheet(pb, turnover) {
  let score = 70;
  if (pb > 0 && pb < 2) score += 8;
  if (turnover > 0.3 && turnover < 4.5) score += 4;
  return clamp(score, 42, 88);
}

function scoreCashFlow(pe, turnover) {
  let score = 68;
  if (pe > 0 && pe < 25) score += 7;
  if (turnover < 6) score += 4;
  return clamp(score, 40, 86);
}

function scoreStability(changePct, ytdChange) {
  const totalMove = Math.abs(changePct) + Math.abs(ytdChange) / 2;
  return clamp(Math.round(84 - totalMove * 2.2), 28, 88);
}

function scoreIndustryProsperity(industryRank = 0, total = 1) {
  if (!industryRank) {
    return 62;
  }

  const percentile = 1 - (industryRank - 1) / Math.max(total - 1, 1);
  return clamp(Math.round(56 + percentile * 30), 40, 88);
}

function scoreConceptHeat(conceptCount) {
  return clamp(24 + conceptCount * 14, 18, 82);
}

function scoreCatalyst(conceptCount, changePct) {
  return clamp(Math.round(48 + conceptCount * 8 + Math.abs(changePct) * 2), 26, 86);
}

function scoreLiquidity(turnover, flowMarketCap) {
  let score = 58;
  if (turnover >= 0.2) score += 12;
  if (turnover >= 0.8) score += 8;
  if (flowMarketCap > 2e10) score += 10;
  if (flowMarketCap > 1e11) score += 6;
  return clamp(score, 26, 92);
}

function scoreConcentrationFit(price, marketCap, conceptCount) {
  let score = 70;
  if (price <= 80) score += 8;
  if (price <= 35) score += 6;
  if (marketCap > 3e10) score += 8;
  score -= Math.max(0, conceptCount - 2) * 4;
  return clamp(score, 30, 90);
}

function scoreVolatilityFit(changePct, ytdChange) {
  const drag = Math.abs(changePct) * 3.5 + Math.abs(ytdChange) * 0.7;
  return clamp(Math.round(84 - drag), 22, 88);
}

function estimateRoe(pe, pb) {
  if (pe <= 0 || pb <= 0) return null;
  return Math.round((pb / pe) * 10000) / 100;
}

function estimateFreeCashFlowYield(pe, cashFlowScore) {
  if (pe <= 0) return null;
  const qualityAdjustment = clamp(cashFlowScore / 75, 0.55, 1.25);
  return Math.round((100 / pe) * qualityAdjustment * 100) / 100;
}

export function buildIndustryLookup(industries) {
  const lookup = new Map();

  for (const board of industries ?? []) {
    for (const stock of board.stocks ?? []) {
      if (!lookup.has(stock.code)) {
        lookup.set(stock.code, board.board);
      }
    }
  }

  return lookup;
}

export function normalizeConceptLookup(concepts, limit = 3) {
  const lookup = new Map();

  for (const board of concepts ?? []) {
    for (const stock of board.stocks ?? []) {
      const current = lookup.get(stock.code) ?? [];
      if (current.length < limit && !current.includes(board.concept)) {
        current.push(board.concept);
        lookup.set(stock.code, current);
      }
    }
  }

  return lookup;
}

function buildIndustryRankLookup(industries) {
  const sorted = [...(industries ?? [])].sort((left, right) => (right.count ?? 0) - (left.count ?? 0));
  const lookup = new Map();
  sorted.forEach((item, index) => lookup.set(item.board, index + 1));
  return { lookup, total: sorted.length || 1 };
}

export function normalizeSpotRow(row, industryLookup, industryRankInfo = { lookup: new Map(), total: 1 }) {
  const code = String(row.代码 ?? row.code ?? "");
  const name = row.名称 ?? row.name ?? code;
  const price = number(row.最新价 ?? row.price ?? row.trade, 0);
  const marketCap = number(row.总市值 ?? row.market_cap ?? row.mktcap, 0) * (row.mktcap ? 10000 : 1);
  const flowMarketCap = number(row.流通市值 ?? row.float_market_cap ?? row.nmc, marketCap) * (row.nmc ? 10000 : 1);
  const changePct = number(row.涨跌幅 ?? row.change_percent ?? row.changepercent, 0);
  const turnover = number(row.换手率 ?? row.turnover ?? row.turnoverratio, 0);
  const pe = number(row.市盈率动态 ?? row["市盈率-动态"] ?? row.pe ?? row.per, 0);
  const pb = number(row.市净率 ?? row.pb, 0);
  const ytdChange = number(row.年初至今涨跌幅 ?? row.ytd_change, 0);
  const industry = industryLookup.get(code) ?? "未分类";
  const concepts = assignConcepts({ code, name, industry });
  const industryRank = industryRankInfo.lookup.get(industry) ?? 0;
  const profitabilityScore = scoreProfitability(pe, pb, marketCap);
  const cashFlowScore = scoreCashFlow(pe, turnover);

  return {
    code,
    name,
    market: inferMarket(code),
    industry,
    concepts,
    isST: /ST/i.test(name),
    isSuspended: false,
    listingYears: number(row.上市年限 ?? row.listing_years, 8),
    recentProfitYears: number(row.连续盈利年数 ?? row.profit_years, 5),
    hasCompleteFinancials: true,
    liquidityScore: scoreLiquidity(turnover, flowMarketCap),
    price,
    lotCost: Math.round(price * 100),
    dividendYield: number(row.股息率 ?? row.dividend_yield, 0),
    summary: `${industry} 板块候选股，当前以市场快照与行业归属信息做初步筛选。`,
    riskNote: "当前真实数据版仍以快照和轻量财务代理评分为主，后续可接入更完整财务字段。",
    riskFlags: [],
    metrics: {
      businessModelQuality: scoreBusinessModelQuality(marketCap, pe, number(row.毛利率 ?? row.gross_margin, 0.35)),
      managementQuality: scoreManagementQuality(marketCap, number(row.股息率 ?? row.dividend_yield, 0), pe),
      businessQuality: scoreBusinessModelQuality(marketCap, pe, number(row.毛利率 ?? row.gross_margin, 0.35)),
      profitability: profitabilityScore,
      cashFlow: cashFlowScore,
      balanceSheet: scoreBalanceSheet(pb, turnover),
      valuation: scoreValuation(pe, pb),
      stability: scoreStability(changePct, ytdChange),
      industryProsperity: scoreIndustryProsperity(industryRank, industryRankInfo.total),
      conceptHeat: scoreConceptHeat(concepts.length),
      catalyst: scoreCatalyst(concepts.length, changePct),
      liquidity: scoreLiquidity(turnover, flowMarketCap),
      concentrationFit: scoreConcentrationFit(price, marketCap, concepts.length),
      volatilityFit: scoreVolatilityFit(changePct, ytdChange),
    },
    raw: {
      pe,
      pb,
      changePct,
      turnover,
      marketCap,
      flowMarketCap,
    },
    financials: {
      roeProxy: estimateRoe(pe, pb),
      freeCashFlowYieldProxy: estimateFreeCashFlowYield(pe, cashFlowScore),
    },
  };
}

export function buildRealSnapshot(raw) {
  const industryLookup = buildIndustryLookup(raw.industries ?? []);
  const industryRankInfo = buildIndustryRankLookup(raw.industries ?? []);
  const items = (raw.spot ?? []).map((row) =>
    normalizeSpotRow(row, industryLookup, industryRankInfo),
  );

  return {
    mode: "live",
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
    note: raw.note ?? "当前使用 AKShare 免费数据构建市场快照。",
    items,
  };
}
