import assert from "node:assert/strict";

import { buildDashboardModel, createDefaultSettings } from "../src/core/dashboard.js";
import { test } from "./harness.js";

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

test("buildDashboardModel falls back to all filters when persisted filter values are invalid", () => {
  const settings = createDefaultSettings();
  settings.selectedIndustry = "鍏ㄩ儴琛屼笟";
  settings.selectedConcept = "鍏ㄩ儴姒傚康";

  const snapshot = {
    mode: "live",
    generatedAt: "2026-04-23T00:00:00.000Z",
    note: "测试快照",
    items: [makeStock(), makeStock({ code: "600001", name: "凤凰股份", industry: "食品饮料", concepts: ["白酒"] })],
  };

  const model = buildDashboardModel(snapshot, settings);

  assert.equal(model.top50.length, 2);
  assert.equal(model.selectedIndustry.length > 0, true);
  assert.deepEqual(model.availableConcepts.slice(0, 2), ["全部概念", "白酒"]);
});
