import assert from "node:assert/strict";

import {
  applyStopDoingFilters,
  checkCircleOfCompetence,
  checkStopDoing,
  classifyBusinessComplexity,
  computeConsensusStrength,
  computeMaoValuation,
  consensusScoreAdjustment,
  detectBusinessFlaws,
  prosperityLabel,
} from "../src/core/philosophyEngine.js";
import { test } from "./harness.js";

// ─── 不为清单过滤 ───────────────────────────────────────────

test("applyStopDoingFilters passes stocks without stop-doing flags", () => {
  const stocks = [
    { code: "600001", name: "正常公司", metrics: {} },
    { code: "600002", name: "另一家正常公司", metrics: {} },
  ];

  const result = applyStopDoingFilters(stocks);
  assert.equal(result.passed.length, 2);
  assert.equal(result.excluded.length, 0);
});

test("applyStopDoingFilters excludes stocks with management integrity flags", () => {
  const stocks = [
    { code: "600001", name: "正常公司", managementFlags: [] },
    {
      code: "600002",
      name: "造假公司",
      managementFlags: ["财务造假"],
    },
  ];

  const result = applyStopDoingFilters(stocks);
  assert.equal(result.passed.length, 1);
  assert.equal(result.passed[0].code, "600001");
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0].label, "管理层诚信污点");
});

test("applyStopDoingFilters excludes stocks with excessive leverage", () => {
  const stocks = [
    {
      code: "600001",
      name: "高杠杆公司",
      financials: { interestDebtRatio: 0.85 },
    },
    {
      code: "600002",
      name: "低杠杆公司",
      financials: { interestDebtRatio: 0.3 },
    },
  ];

  const result = applyStopDoingFilters(stocks);
  assert.equal(result.passed.length, 1);
  assert.equal(result.excluded[0].label, "有息负债率过高");
});

test("applyStopDoingFilters excludes stocks with business model flaws", () => {
  const stocks = [
    {
      code: "600001",
      name: "有硬伤的公司",
      businessFlaws: ["无定价权"],
    },
    { code: "600002", name: "正常公司", businessFlaws: [] },
  ];

  const result = applyStopDoingFilters(stocks);
  assert.equal(result.passed.length, 1);
  assert.equal(result.excluded[0].label, "生意模式硬伤");
});

test("applyStopDoingFilters excludes stocks with non-standard audit opinions", () => {
  const stocks = [
    { code: "600001", name: "审计问题公司", auditOpinion: "保留意见" },
    { code: "600002", name: "正常公司", auditOpinion: "标准无保留意见" },
  ];

  const result = applyStopDoingFilters(stocks);
  assert.equal(result.passed.length, 1);
  assert.equal(result.excluded[0].label, "审计非标意见");
});

test("checkStopDoing returns blocked=true and lists reasons", () => {
  const stock = {
    managementFlags: ["财务造假"],
    financials: { interestDebtRatio: 0.85 },
  };

  const result = checkStopDoing(stock);
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes("管理层诚信污点"));
  assert.ok(result.reasons.includes("有息负债率过高"));
});

// ─── 能力圈检查 ─────────────────────────────────────────────

test("classifyBusinessComplexity maps industries", () => {
  assert.equal(classifyBusinessComplexity({ industry: "食品饮料" }), "简单");
  assert.equal(classifyBusinessComplexity({ industry: "银行" }), "中等");
  assert.equal(classifyBusinessComplexity({ industry: "医药生物" }), "复杂");
  assert.equal(classifyBusinessComplexity({ industry: "计算机" }), "复杂");
  assert.equal(classifyBusinessComplexity({ industry: "未知行业" }), "中等");
});

test("checkCircleOfCompetence returns inCircle=true when circle is empty", () => {
  const result = checkCircleOfCompetence({ industry: "医药生物" }, []);
  assert.equal(result.inCircle, true);
});

test("checkCircleOfCompetence returns inCircle=false for industries outside circle", () => {
  const result = checkCircleOfCompetence({ industry: "计算机" }, ["食品饮料", "银行"]);
  assert.equal(result.inCircle, false);
  assert.ok(result.note.includes("不在您的能力圈范围内"));
});

test("checkCircleOfCompetence returns inCircle=true for industries inside circle", () => {
  const result = checkCircleOfCompetence({ industry: "食品饮料" }, ["食品饮料", "银行"]);
  assert.equal(result.inCircle, true);
  assert.equal(result.note, null);
});

// ─── 多视角共识计算 ────────────────────────────────────────

test("computeConsensusStrength returns high consensus for strong stocks", () => {
  const stock = {
    metrics: {
      businessModelQuality: 88,
      managementQuality: 82,
      valuation: 80,
      profitability: 78,
      cashFlow: 80,
      balanceSheet: 78,
      stability: 76,
      conceptHeat: 30,
      industryProsperity: 50,
    },
    technicalSummary: "偏多",
    scores: { core: 82 },
  };

  const result = computeConsensusStrength(stock);
  assert.ok(["high", "medium-high"].includes(result.consensus));
  assert.ok(["高", "中高"].includes(result.confidence));
});

test("computeConsensusStrength detects overheated stocks with weak fundamentals", () => {
  const stock = {
    metrics: {
      businessModelQuality: 42,
      managementQuality: 44,
      valuation: 38,
      profitability: 40,
      cashFlow: 42,
      balanceSheet: 44,
      stability: 40,
      conceptHeat: 88,
      industryProsperity: 82,
    },
    technicalSummary: "偏多",
    scores: { core: 42 },
  };

  const result = computeConsensusStrength(stock);
  assert.equal(result.note, "热度驱动力大于基本面——警惕追高风险");
});

test("computeConsensusStrength detects overlooked quality stocks", () => {
  const stock = {
    metrics: {
      businessModelQuality: 84,
      managementQuality: 80,
      valuation: 78,
      profitability: 76,
      cashFlow: 78,
      balanceSheet: 76,
      stability: 74,
      conceptHeat: 18,
      industryProsperity: 35,
    },
    technicalSummary: "震荡",
    scores: { core: 78 },
  };

  const result = computeConsensusStrength(stock);
  assert.equal(result.note, "市场冷落的好公司——可能被低估");
});

// ─── 共识调整分 ─────────────────────────────────────────────

test("consensusScoreAdjustment returns correct adjustments", () => {
  assert.equal(consensusScoreAdjustment("high"), 3);
  assert.equal(consensusScoreAdjustment("medium-high"), 1);
  assert.equal(consensusScoreAdjustment("medium"), 0);
  assert.equal(consensusScoreAdjustment("low"), -2);
  assert.equal(consensusScoreAdjustment("very-low"), -5);
});

// ─── 毛估估估值区间 ─────────────────────────────────────────

test("computeMaoValuation returns five-tier valuation", () => {
  const stock = {
    price: 25.0,
    metrics: { valuation: 80 },
    raw: { pe: 15 },
  };

  const result = computeMaoValuation(stock);
  assert.equal(result.valuationTier, "低估");
  assert.ok(result.intrinsicValue > 0);
  assert.ok(result.conservativeValue < result.intrinsicValue);
  assert.ok(result.optimisticValue > result.intrinsicValue);
  assert.ok(result.buyZoneLow < result.buyZoneHigh);
  assert.equal(typeof result.marginOfSafety, "number");
  assert.equal(typeof result.earningsYield, "number");
  assert.ok(result.opportunityNote.includes("盈利收益率"));
});

test("computeMaoValuation gives '明显高估' for very low valuation scores", () => {
  const stock = {
    price: 100.0,
    metrics: { valuation: 30 },
  };

  const result = computeMaoValuation(stock);
  assert.equal(result.valuationTier, "明显高估");
});

test("computeMaoValuation tiers are correct", () => {
  const tiers = [
    { score: 82, expected: "低估" },
    { score: 72, expected: "合理偏低" },
    { score: 63, expected: "合理" },
    { score: 52, expected: "偏高估" },
    { score: 38, expected: "明显高估" },
  ];

  for (const { score, expected } of tiers) {
    const result = computeMaoValuation({ price: 50, metrics: { valuation: score } });
    assert.equal(result.valuationTier, expected, `valuationScore=${score} should be ${expected}`);
  }
});

// ─── 行业景气度标签 ─────────────────────────────────────────

test("prosperityLabel returns correct labels", () => {
  assert.equal(prosperityLabel(82), "景气上升");
  assert.equal(prosperityLabel(68), "平稳运行");
  assert.equal(prosperityLabel(50), "景气下行");
});

// ─── 商业模式硬伤检测 ───────────────────────────────────────

test("detectBusinessFlaws returns flaws for weak business models", () => {
  const flaws = detectBusinessFlaws({
    metrics: { businessModelQuality: 35, valuation: 30 },
  });
  assert.ok(flaws.includes("无定价权"));
  assert.ok(flaws.includes("商业模式不可持续"));
});

test("detectBusinessFlaws returns empty for strong business models", () => {
  const flaws = detectBusinessFlaws({
    metrics: { businessModelQuality: 75, valuation: 72 },
  });
  assert.equal(flaws.length, 0);
});
