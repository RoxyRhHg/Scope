import assert from "node:assert/strict";

import { getEtfList, getEtfsByType, getEtfTypes, classifyEtf } from "../src/core/etfAdapter.js";
import { test } from "./harness.js";

test("getEtfList returns all ETFs", () => {
  const etfs = getEtfList();
  assert.ok(etfs.length > 30);
  assert.equal(typeof etfs[0].code, "string");
  assert.equal(typeof etfs[0].name, "string");
  assert.equal(typeof etfs[0].type, "string");
});

test("getEtfsByType filters correctly", () => {
  const wide = getEtfsByType("宽基ETF");
  assert.ok(wide.length > 0);
  for (const e of wide) {
    assert.equal(e.type, "宽基ETF");
  }
});

test("getEtfsByType with '全部' returns all", () => {
  const all = getEtfsByType("全部");
  assert.equal(all.length, getEtfList().length);
});

test("getEtfTypes returns all types", () => {
  const types = getEtfTypes();
  assert.ok(types.includes("全部"));
  assert.ok(types.includes("行业ETF"));
  assert.ok(types.includes("宽基ETF"));
});

test("classifyEtf identifies common ETFs", () => {
  assert.equal(classifyEtf("半导体ETF"), "行业ETF");
  assert.equal(classifyEtf("沪深300ETF"), "宽基ETF");
  assert.equal(classifyEtf("纳斯达克100ETF"), "跨境ETF");
  assert.equal(classifyEtf("国债ETF"), "债券ETF");
  assert.equal(classifyEtf("黄金ETF"), "商品ETF");
});

test("classifyEtf returns '其他' for unknown names", () => {
  assert.equal(classifyEtf("某未知ETF"), "其他");
});
