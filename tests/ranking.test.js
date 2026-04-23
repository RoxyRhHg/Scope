import assert from "node:assert/strict";

import {
  applyRiskFilters,
  buildIndustryTop,
  computeStockScores,
  pickFocusStocks,
  rankStocks,
} from "../src/core/ranking.js";
import {
  buildIndustryLookup,
  buildRealSnapshot,
  normalizeConceptLookup,
  normalizeSpotRow,
} from "../src/core/realDataAdapter.js";
import { test } from "./harness.js";

const settings = {
  availableCapital: 12000,
  autoRefreshMinutes: 60,
  thresholds: {
    minListingYears: 3,
    minLiquidityScore: 45,
    minCoreScoreForRanking: 60,
    minCoreScoreForFocus: 72,
    maxRiskFlagsForFocus: 1,
  },
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
};

function makeStock(overrides = {}) {
  return {
    code: "600000",
    name: "测试股份",
    market: "SH",
    industry: "银行",
    concepts: ["高股息"],
    isST: false,
    isSuspended: false,
    listingYears: 8,
    recentProfitYears: 5,
    hasCompleteFinancials: true,
    liquidityScore: 78,
    price: 12.8,
    lotCost: 1280,
    dividendYield: 5.6,
    metrics: {
      businessQuality: 78,
      profitability: 76,
      cashFlow: 80,
      balanceSheet: 82,
      valuation: 74,
      stability: 77,
      industryProsperity: 66,
      conceptHeat: 30,
      catalyst: 58,
      liquidity: 78,
      concentrationFit: 76,
      volatilityFit: 72,
    },
    riskFlags: [],
    ...overrides,
  };
}

test("applyRiskFilters excludes ST, young listings, incomplete financials, and illiquid names", () => {
  const input = [
    makeStock({ code: "600001", name: "稳定银行" }),
    makeStock({ code: "600002", name: "风险ST", isST: true }),
    makeStock({ code: "600003", name: "新股", listingYears: 1 }),
    makeStock({ code: "600004", name: "缺财报", hasCompleteFinancials: false }),
    makeStock({ code: "600005", name: "流动性差", liquidityScore: 20 }),
  ];

  const result = applyRiskFilters(input, settings);

  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].name, "稳定银行");
  assert.equal(result.excluded.length, 4);
  assert.deepEqual(
    result.excluded.map((item) => item.reason),
    ["ST风险", "上市时间过短", "财务数据缺失", "流动性不足"],
  );
});

test("rankStocks keeps high-heat stocks out when core score is below threshold", () => {
  const undervaluedLeader = makeStock({
    code: "600010",
    name: "价值龙头",
    metrics: {
      businessQuality: 88,
      profitability: 85,
      cashFlow: 84,
      balanceSheet: 83,
      valuation: 80,
      stability: 82,
      industryProsperity: 62,
      conceptHeat: 22,
      catalyst: 55,
      liquidity: 80,
      concentrationFit: 78,
      volatilityFit: 75,
    },
  });

  const hotButWeak = makeStock({
    code: "300001",
    name: "热点弹性股",
    industry: "计算机",
    concepts: ["人工智能", "机器人"],
    metrics: {
      businessQuality: 42,
      profitability: 45,
      cashFlow: 46,
      balanceSheet: 50,
      valuation: 44,
      stability: 48,
      industryProsperity: 92,
      conceptHeat: 98,
      catalyst: 95,
      liquidity: 84,
      concentrationFit: 62,
      volatilityFit: 38,
    },
  });

  const ranked = rankStocks([undervaluedLeader, hotButWeak], settings);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].name, "价值龙头");
});

test("pickFocusStocks returns at most two names and only from qualified candidates", () => {
  const ranked = [
    ...Array.from({ length: 12 }, (_, index) =>
      computeStockScores(
        makeStock({
          code: `6001${String(index).padStart(2, "0")}`,
          name: `重仓候选${index + 1}`,
          metrics: {
            businessQuality: 88 - index * 0.4,
            profitability: 84 - index * 0.3,
            cashFlow: 83 - index * 0.3,
            balanceSheet: 85 - index * 0.2,
            valuation: 78 - index * 0.2,
            stability: 81 - index * 0.2,
            industryProsperity: 71,
            conceptHeat: 36,
            catalyst: 67,
            liquidity: 79,
            concentrationFit: 85,
            volatilityFit: 78,
          },
        }),
        settings,
      ),
    ),
    computeStockScores(
      makeStock({
        code: "300555",
        name: "不适合重仓",
        riskFlags: ["波动偏高", "概念依赖"],
        metrics: {
          businessQuality: 79,
          profitability: 74,
          cashFlow: 70,
          balanceSheet: 72,
          valuation: 75,
          stability: 70,
          industryProsperity: 87,
          conceptHeat: 88,
          catalyst: 82,
          liquidity: 83,
          concentrationFit: 53,
          volatilityFit: 30,
        },
      }),
      settings,
    ),
  ];

  const focus = pickFocusStocks(ranked, settings);

  assert.equal(focus.length, 10);
  assert.equal(focus[0].name, "重仓候选1");
  assert.equal(focus.at(-1).name, "重仓候选10");
});

test("buildIndustryTop limits sector recommendations to 20 names", () => {
  const ranked = Array.from({ length: 25 }, (_, index) =>
    computeStockScores(
      makeStock({
        code: `600${100 + index}`,
        name: `银行股${index + 1}`,
        metrics: {
          businessQuality: 82 - index * 0.2,
          profitability: 80 - index * 0.2,
          cashFlow: 81 - index * 0.2,
          balanceSheet: 83 - index * 0.2,
          valuation: 79 - index * 0.2,
          stability: 80 - index * 0.2,
          industryProsperity: 68,
          conceptHeat: 18,
          catalyst: 55,
          liquidity: 75,
          concentrationFit: 80,
          volatilityFit: 79,
        },
      }),
      settings,
    ),
  );

  const top = buildIndustryTop(ranked, "银行");

  assert.equal(top.length, 20);
  assert.equal(top[0].name, "银行股1");
  assert.equal(top.at(-1).name, "银行股20");
});

test("normalizeSpotRow maps raw live data to dashboard stock shape", () => {
  const row = {
    代码: "600519",
    名称: "贵州茅台",
    最新价: 1520.33,
    总市值: 1910000000000,
    流通市值: 1650000000000,
    涨跌幅: 1.23,
    换手率: 0.45,
    市盈率动态: 28.4,
    市净率: 9.2,
    年初至今涨跌幅: 4.1,
  };
  const industryLookup = new Map([["600519", "食品饮料"]]);
  const conceptLookup = new Map([["600519", ["白酒", "高端消费"]]]);

  const stock = normalizeSpotRow(row, industryLookup, conceptLookup);

  assert.equal(stock.code, "600519");
  assert.equal(stock.industry, "食品饮料");
  assert.deepEqual(stock.concepts, ["白酒", "高端消费"]);
  assert.equal(stock.lotCost, 152033);
  assert.equal(stock.metrics.valuation > 0, true);
});

test("buildIndustryLookup and normalizeConceptLookup keep first industry and limit concepts", () => {
  const industries = [
    { board: "食品饮料", stocks: [{ code: "600519" }, { code: "000858" }] },
    { board: "白酒Ⅱ", stocks: [{ code: "600519" }] },
  ];
  const concepts = [
    { concept: "白酒", stocks: [{ code: "600519" }, { code: "000858" }] },
    { concept: "高股息", stocks: [{ code: "600519" }] },
    { concept: "沪股通", stocks: [{ code: "600519" }] },
  ];

  const industryLookup = buildIndustryLookup(industries);
  const conceptLookup = normalizeConceptLookup(concepts, 2);

  assert.equal(industryLookup.get("600519"), "食品饮料");
  assert.deepEqual(conceptLookup.get("600519"), ["白酒", "高股息"]);
});

test("buildRealSnapshot returns snapshot metadata and normalized items", () => {
  const raw = {
    generatedAt: "2026-04-23T03:00:00Z",
    spot: [
      {
        代码: "600519",
        名称: "贵州茅台",
        最新价: 1520.33,
        总市值: 1910000000000,
        流通市值: 1650000000000,
        涨跌幅: 1.23,
        换手率: 0.45,
        市盈率动态: 28.4,
        市净率: 9.2,
      },
    ],
    industries: [{ board: "食品饮料", stocks: [{ code: "600519" }], count: 1 }],
    concepts: [{ concept: "白酒", stocks: [{ code: "600519" }] }],
  };

  const snapshot = buildRealSnapshot(raw);

  assert.equal(snapshot.mode, "live");
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].industry, "食品饮料");
  assert.deepEqual(snapshot.items[0].concepts, ["白酒"]);
});
