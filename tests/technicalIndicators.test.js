import assert from "node:assert/strict";

import {
  buildTechnicalNarrative,
  computeTechnicalSnapshot,
} from "../src/core/technicalIndicators.js";
import { test } from "./harness.js";

function makeBars(direction = "up", count = 60) {
  return Array.from({ length: count }, (_, index) => {
    const base = direction === "up" ? 10 + index * 0.28 : 28 - index * 0.28;
    const drift = direction === "up" ? 0.18 : -0.18;
    const close = Number((base + drift).toFixed(2));
    const open = Number((close - (direction === "up" ? 0.12 : -0.12)).toFixed(2));
    const high = Number((Math.max(open, close) + 0.24).toFixed(2));
    const low = Number((Math.min(open, close) - 0.24).toFixed(2));
    const volumeBase = direction === "up" ? 100000 + index * 2400 : 180000 - index * 1800;

    return {
      date: `2026-02-${String((index % 28) + 1).padStart(2, "0")}`,
      open,
      high,
      low,
      close,
      volume: Math.max(10000, Math.round(volumeBase)),
    };
  });
}

test("computeTechnicalSnapshot returns major indicator sections for an upward trend", () => {
  const snapshot = computeTechnicalSnapshot(makeBars("up", 320));

  assert.equal(typeof snapshot.macd.diff, "number");
  assert.equal(typeof snapshot.boll.upper, "number");
  assert.equal(typeof snapshot.kdj.k, "number");
  assert.equal(typeof snapshot.volume.ratio, "number");
  assert.equal(typeof snapshot.weekly60.close, "number");
  assert.equal(typeof snapshot.weekly60.ma60, "number");
  assert.equal(snapshot.trend.bias, "bullish");
});

test("computeTechnicalSnapshot detects weaker technical state for a downtrend", () => {
  const snapshot = computeTechnicalSnapshot(makeBars("down", 320));

  assert.equal(snapshot.trend.bias, "bearish");
  assert.equal(snapshot.macd.diff < snapshot.macd.dea || snapshot.macd.histogram <= 0, true);
  assert.equal(snapshot.kdj.k <= 50 || snapshot.kdj.j <= 50, true);
  assert.equal(snapshot.weekly60.position === "below" || snapshot.weekly60.slope === "down", true);
});

test("buildTechnicalNarrative creates readable analysis for the detail card", () => {
  const snapshot = computeTechnicalSnapshot(makeBars("up", 320));
  const lines = buildTechnicalNarrative(snapshot);

  assert.equal(Array.isArray(lines), true);
  assert.equal(lines.length >= 4, true);
  assert.equal(lines.some((line) => line.includes("MACD")), true);
  assert.equal(lines.some((line) => line.includes("BOLL")), true);
  assert.equal(lines.some((line) => line.includes("KDJ")), true);
  assert.equal(lines.some((line) => line.includes("成交量")), true);
  assert.equal(lines.some((line) => line.includes("60周K")), true);
});
