import assert from "node:assert/strict";

import {
  buildMasterProfileData,
  buildDailyReviewData,
  buildExportPayload,
  renderMasterProfileMarkdown,
  renderDailyReviewMarkdown,
} from "../src/core/obsidianAdapter.js";
import { test } from "./harness.js";

// ─── 辅助：构造模拟 stock 对象 ────────────────────────────────

function makeStock(overrides = {}) {
  return {
    code: "600519",
    name: "贵州茅台",
    market: "SH",
    industry: "食品饮料",
    concepts: ["白酒", "消费"],
    price: 1680.50,
    lotCost: 168050,
    dividendYield: 1.8,
    description: "高端白酒龙头，品牌护城河极深",
    metrics: {
      businessModelQuality: 92,
      managementQuality: 78,
      valuation: 62,
      profitability: 88,
      cashFlow: 85,
      balanceSheet: 90,
      stability: 82,
      conceptHeat: 55,
      industryProsperity: 68,
      catalyst: 50,
      liquidity: 80,
      concentrationFit: 70,
      volatilityFit: 55,
      interestDebtRatio: 0.05,
    },
    financials: {
      roeProxy: 28,
      freeCashFlowYieldProxy: 3.5,
    },
    raw: { pe: 32, pb: 9.8, changePct: 1.2, turnover: 0.8, marketCap: 21000, flowMarketCap: 19500 },
    scores: {
      core: 84,
      auxiliary: 62,
      capitalFit: 68,
      total: 78,
      consensusAdjustment: 1,
    },
    valuationCard: {
      valuationTier: "合理偏低",
      intrinsicValue: 1850.00,
      conservativeValue: 1628.00,
      optimisticValue: 2072.00,
      buyZoneLow: 1172.16,
      buyZoneHigh: 1383.80,
      marginOfSafety: 9.2,
      earningsYield: 3.13,
      opportunityNote: "盈利收益率 3.13% vs 无风险利率 ~3%（基本持平）",
    },
    maoValuation: {
      valuationTier: "合理偏低",
      intrinsicValue: 1850.00,
      conservativeValue: 1628.00,
      optimisticValue: 2072.00,
      buyZoneLow: 1172.16,
      buyZoneHigh: 1383.80,
      marginOfSafety: 9.2,
      earningsYield: 3.13,
      opportunityNote: "盈利收益率 3.13% vs 无风险利率 ~3%（基本持平）",
    },
    conclusion: "重点关注",
    consensus: {
      consensus: "medium-high",
      confidence: "中高",
      directions: { fundamental: "看多", valuation: "合理", sentiment: "正常", technical: "偏多" },
      note: null,
    },
    riskFlags: [],
    stopDoingBlocked: false,
    stopDoingReasons: [],
    ...overrides,
  };
}

function makeTechnicals(overrides = {}) {
  return {
    snapshot: {
      macd: { diff: "12.50", dea: "8.30", histogram: "4.20" },
      boll: { upper: "1750.00", middle: "1680.00", lower: "1610.00", position: "中轨上方" },
      kdj: { k: "65", d: "58", j: "79" },
      volume: { ratio: 1.2, trend: "温和放量" },
      weekly60: { ma60: "1550.00", slope: "向上", position: "above" },
      trend: { bias: "bullish" },
    },
    analysis: ["MACD 金叉信号", "站稳周线 60 均线", "成交量温和放大"],
    ...overrides,
  };
}

// ─── 数据映射测试 ─────────────────────────────────────────────

test("buildMasterProfileData populates basic stock info", () => {
  const stock = makeStock();
  const data = buildMasterProfileData(stock);

  assert.equal(data.name, "贵州茅台");
  assert.equal(data.code, "600519");
  assert.equal(data.industry, "食品饮料");
  assert.equal(data.type, "个股");
});

test("buildMasterProfileData maps conclusion to position and stage", () => {
  const stock = makeStock({ conclusion: "重点关注" });
  const data = buildMasterProfileData(stock);
  assert.equal(data.currentPosition, "核心");
  assert.equal(data.currentStage, "持有");
});

test("buildMasterProfileData maps conclusion to stage for observed stocks", () => {
  const stock = makeStock({ conclusion: "值得观察" });
  const data = buildMasterProfileData(stock);
  assert.equal(data.currentPosition, "卫星");
  assert.equal(data.currentStage, "候选");
});

test("buildMasterProfileData maps valuation status from maoValuation", () => {
  const stock = makeStock();
  const data = buildMasterProfileData(stock);
  assert.equal(data.valuationStatus, "合理偏低");
});

test("buildMasterProfileData maps safety margin", () => {
  const strong = makeStock();
  strong.maoValuation = { ...strong.maoValuation, marginOfSafety: 25 };
  const data1 = buildMasterProfileData(strong);
  assert.equal(data1.safetyMargin, "强");

  const weak = makeStock();
  weak.maoValuation = { ...weak.maoValuation, marginOfSafety: 2 };
  const data2 = buildMasterProfileData(weak);
  assert.equal(data2.safetyMargin, "弱");
});

test("buildMasterProfileData maps risk flags", () => {
  const stock = makeStock({ riskFlags: ["估值偏高", "现金流偏弱"] });
  const data = buildMasterProfileData(stock);
  assert.equal(data.risks.length, 2);
  assert.equal(data.risks[0].flag, "估值偏高");
});

test("buildMasterProfileData maps stop-doing reasons", () => {
  const stock = makeStock({
    stopDoingBlocked: true,
    stopDoingReasons: ["管理层诚信污点"],
  });
  const data = buildMasterProfileData(stock);
  assert.equal(data.stopDoingBlocked, true);
  assert.equal(data.stopDoingReasons[0], "管理层诚信污点");
  assert.equal(data.failureConditions[0], "不为清单触发：管理层诚信污点");
});

test("buildMasterProfileData with technicals maps technical status", () => {
  const stock = makeStock();
  const technicals = makeTechnicals();
  const data = buildMasterProfileData(stock, technicals);
  assert.equal(data.technicalStatus, "强势");
});

test("buildMasterProfileData without technicals defaults technical status", () => {
  const stock = makeStock();
  const data = buildMasterProfileData(stock, null);
  assert.equal(data.technicalStatus, "震荡");
});

test("buildMasterProfileData infers asset mode from industry", () => {
  const light = makeStock({ industry: "食品饮料" });
  assert.equal(buildMasterProfileData(light).assetMode, "高周转");

  const heavy = makeStock({ industry: "银行" });
  assert.equal(buildMasterProfileData(heavy).assetMode, "重资产");
});

test("buildMasterProfileData generates wiki link", () => {
  const stock = makeStock();
  const data = buildMasterProfileData(stock);
  assert.equal(data.wikiStock, "[[财经/选股/贵州茅台]]");
});

test("buildMasterProfileData generates buy zone range", () => {
  const stock = makeStock();
  const data = buildMasterProfileData(stock);
  assert.ok(data.suggestedBuyZone.includes("1172.16"));
  assert.ok(data.suggestedBuyZone.includes("1383.80"));
});

test("buildDailyReviewData populates basic fields", () => {
  const stock = makeStock();
  const data = buildDailyReviewData(stock);

  assert.equal(data.stock, "[[财经/选股/贵州茅台]]");
  assert.ok(data.date.length === 10);
  assert.equal(data.stance, "持有");
});

// ─── Markdown 生成测试 ────────────────────────────────────────

test("renderMasterProfileMarkdown contains all section headers", () => {
  const stock = makeStock();
  const data = buildMasterProfileData(stock);
  const md = renderMasterProfileMarkdown(data);

  assert.ok(md.includes("## 标的基础信息"));
  assert.ok(md.includes("## 长期投资逻辑"));
  assert.ok(md.includes("## 企业与商业模式"));
  assert.ok(md.includes("## 财务与商业模式框架"));
  assert.ok(md.includes("## 估值框架"));
  assert.ok(md.includes("## 风险与失效条件"));
  assert.ok(md.includes("## 跟踪清单"));
  assert.ok(md.includes("## 执行附录"));
  assert.ok(md.includes("## 关联笔记"));
  assert.ok(md.includes("## 更新记录"));
});

test("renderMasterProfileMarkdown contains stock data", () => {
  const stock = makeStock();
  const data = buildMasterProfileData(stock);
  const md = renderMasterProfileMarkdown(data);

  assert.ok(md.includes("贵州茅台"));
  assert.ok(md.includes("600519"));
  assert.ok(md.includes("食品饮料"));
  assert.ok(md.includes("高端白酒龙头"));
});

test("renderMasterProfileMarkdown has correct frontmatter", () => {
  const stock = makeStock();
  const data = buildMasterProfileData(stock);
  const md = renderMasterProfileMarkdown(data);

  assert.ok(md.includes("tags:"));
  assert.ok(md.includes("财经/选股"));
  assert.ok(md.includes("Scope导入"));
  assert.ok(md.includes("template_type: stock_profile"));
});

test("renderDailyReviewMarkdown contains all section headers", () => {
  const stock = makeStock();
  const data = buildDailyReviewData(stock);
  const md = renderDailyReviewMarkdown(data);

  assert.ok(md.includes("## 今日核心变化"));
  assert.ok(md.includes("## 基本面今天有无变化"));
  assert.ok(md.includes("## 估值今天有无变化"));
  assert.ok(md.includes("## 技术面状态"));
  assert.ok(md.includes("## 关键价位变化"));
  assert.ok(md.includes("## 今天适合做什么"));
  assert.ok(md.includes("## 偏差与反思"));
});

test("renderDailyReviewMarkdown has correct frontmatter", () => {
  const stock = makeStock();
  const data = buildDailyReviewData(stock);
  const md = renderDailyReviewMarkdown(data);

  assert.ok(md.includes("template_type: stock_daily_review"));
  assert.ok(md.includes("stance: 持有"));
});

// ─── buildExportPayload 测试 ──────────────────────────────────

test("buildExportPayload returns both markdown types", () => {
  const stock = makeStock();
  const payload = buildExportPayload(stock);

  assert.ok(typeof payload.masterProfile === "string");
  assert.ok(typeof payload.dailyReview === "string");
  assert.ok(payload.masterProfile.length > 500);
  assert.ok(payload.dailyReview.length > 300);
  assert.equal(payload.fileName, "贵州茅台");
});

test("buildExportPayload safeFileName replaces special chars", () => {
  const stock = makeStock({ name: "ST*测试/股" });
  const payload = buildExportPayload(stock);
  assert.equal(payload.safeFileName, "ST_测试_股");
});

// ─── 边界条件测试 ─────────────────────────────────────────────

test("buildMasterProfileData handles minimal stock without crashing", () => {
  const minimal = {
    code: "000001",
    name: "最小测试",
    industry: "银行",
    price: 10.0,
    metrics: {},
    scores: { core: 50, total: 45 },
    riskFlags: [],
    stopDoingReasons: [],
  };
  const data = buildMasterProfileData(minimal);
  assert.equal(data.name, "最小测试");
  assert.equal(data.fundamentalConclusion, "放弃");
});

test("buildMasterProfileData handles missing financials gracefully", () => {
  const stock = makeStock();
  delete stock.financials;
  const data = buildMasterProfileData(stock);
  assert.equal(data.financials.roe, "");
  assert.equal(data.financials.freeCashFlow, "");
});

test("buildMasterProfileData handles missing maoValuation gracefully", () => {
  const stock = makeStock();
  delete stock.maoValuation;
  delete stock.valuationCard;
  const data = buildMasterProfileData(stock);
  assert.equal(data.valuationStatus, "合理");
  assert.equal(data.suggestedBuyZone, "");
});

test("buildExportPayload works without technicals", () => {
  const stock = makeStock();
  const payload = buildExportPayload(stock, null);
  assert.ok(payload.masterProfile.length > 300);
  assert.ok(payload.dailyReview.length > 200);
});
