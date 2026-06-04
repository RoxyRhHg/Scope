import assert from "node:assert/strict";

import { assignConcepts, getAvailableConcepts, batchAssignConcepts } from "../src/core/conceptAdapter.js";
import { test } from "./harness.js";

test("getAvailableConcepts returns 11 core concepts", () => {
  const concepts = getAvailableConcepts();
  assert.equal(concepts.length, 11);
  assert.ok(concepts.includes("AI"));
  assert.ok(concepts.includes("半导体"));
  assert.ok(concepts.includes("银行"));
});

test("assignConcepts returns hardcoded concepts for known stocks", () => {
  const concepts = assignConcepts({ code: "002230", name: "科大讯飞", industry: "软件服务" });
  assert.ok(concepts.includes("AI"));
  assert.ok(concepts.includes("数据"));
});

test("assignConcepts matches by industry keyword", () => {
  const concepts = assignConcepts({ code: "000001", name: "测试股", industry: "半导体与集成电路" });
  assert.ok(concepts.includes("半导体") || concepts.includes("芯片"));
});

test("assignConcepts matches by name keyword", () => {
  const concepts = assignConcepts({ code: "000001", name: "智能科技", industry: "其他" });
  assert.ok(concepts.includes("AI") || concepts.includes("具身智能"));
});

test("assignConcepts respects maxConcepts limit", () => {
  const concepts = assignConcepts({ code: "002415", name: "海康威视", industry: "计算机通信电子" }, 2);
  assert.ok(concepts.length <= 2);
});

test("assignConcepts handles empty data gracefully", () => {
  const concepts = assignConcepts({ code: "", name: "", industry: "" });
  assert.equal(Array.isArray(concepts), true);
});

test("batchAssignConcepts returns a Map", () => {
  const stocks = [
    { code: "002230", name: "科大讯飞", industry: "软件服务" },
    { code: "601398", name: "工商银行", industry: "银行" },
  ];
  const map = batchAssignConcepts(stocks);
  assert.equal(map instanceof Map, true);
  assert.equal(map.size, 2);
  assert.ok(map.get("002230").includes("AI"));
  assert.ok(map.get("601398").includes("银行"));
});
