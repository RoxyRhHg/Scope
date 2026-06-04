import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildRealSnapshot } from "./core/realDataAdapter.js";
import { createSampleSnapshot } from "./core/sampleData.js";
import { buildTechnicalNarrative, computeTechnicalSnapshot } from "./core/technicalIndicators.js";
import { buildExportPayload } from "./core/obsidianAdapter.js";
import { getAvailableConcepts as getConceptList } from "./core/conceptAdapter.js";
import { getEtfList, getEtfTypes } from "./core/etfAdapter.js";
import { predictLimitup, batchPredict, loadLimitupHistory, getLimitupSummary } from "./core/limitupPredictor.js";
import { computeStockScores, rankStocks } from "./core/ranking.js";
import { buildDashboardModel, createDefaultSettings } from "./core/dashboard.js";
import { fetchFullSnapshot } from "./core/dataFetcher.js";
import { generateBusinessBrief } from "./core/businessBrief.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const cacheDir = path.join(root, ".cache");
const cacheFile = path.join(cacheDir, "live-snapshot.json");
const technicalsCacheFile = path.join(cacheDir, "technicals-cache.json");
const port = Number(process.env.PORT || 4173);
const execFileAsync = promisify(execFile);
const liveRefreshMs = 60 * 60 * 1000;

const liveCache = {
  snapshot: null,
  fetchedAt: 0,
  source: "sample",
};
const technicalCache = new Map();

// 启动时从磁盘加载预取的技术指标缓存
function loadTechnicalsCacheFromDisk() {
  try {
    if (fs.existsSync(technicalsCacheFile)) {
      const raw = fs.readFileSync(technicalsCacheFile, "utf8");
      const data = JSON.parse(raw);
      for (const [code, entry] of Object.entries(data)) {
        // Support both formats: {bars, snapshot, analysis} or raw bars array
        const bars = Array.isArray(entry) ? entry : entry?.bars;
        if (bars && bars.length > 0) {
          const snapshot = entry?.snapshot || computeTechnicalSnapshot(bars);
          technicalCache.set(code, {
            code,
            bars,
            snapshot,
            analysis: entry?.analysis || buildTechnicalNarrative(snapshot),
            fetchedAt: Date.now(),
            source: "disk-cache",
          });
        }
      }
      console.log(`Loaded ${technicalCache.size} technical datasets from disk cache`);
    }
  } catch (error) {
    console.log(`Technical cache load skipped: ${error.message}`);
  }
}
loadTechnicalsCacheFromDisk();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function safePathname(requestUrl) {
  const parsed = new URL(requestUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(parsed.pathname);
  const candidate = pathname === "/" ? "/public/start.html" : pathname;
  const resolved = path.normalize(path.join(root, candidate));

  if (!resolved.startsWith(root)) {
    return null;
  }

  return resolved;
}

function serveFile(filePath, response) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Surrogate-Control": "no-store",
    });
    response.end(content);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.end(JSON.stringify(payload));
}

function loadCacheFromDisk() {
  try {
    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const raw = fs.readFileSync(cacheFile, "utf8");
    if (raw.includes("�")) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function saveCacheToDisk(payload) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(payload), "utf8");
}

async function fetchLiveSnapshot(force = false) {
  const now = Date.now();
  if (!force && liveCache.snapshot && now - liveCache.fetchedAt < liveRefreshMs) {
    return { snapshot: liveCache.snapshot, source: liveCache.source, cached: true };
  }

  try {
    // Try pre-fetched cache first (written by python --cache)
    const preFetchFile = path.join(cacheDir, "prefetch-snapshot.json");
    if (fs.existsSync(preFetchFile)) {
      const preRaw = fs.readFileSync(preFetchFile, "utf8");
      if (preRaw && !preRaw.includes("�")) {
        const preData = JSON.parse(preRaw);
        if (preData.snapshot?.items?.length > 1000) {
          const age = now - (preData.fetchedAt ?? 0);
          if (age < liveRefreshMs) {
            liveCache.snapshot = preData.snapshot;
            liveCache.fetchedAt = preData.fetchedAt ?? now;
            liveCache.source = "live";
            console.log(`Loaded ${preData.snapshot.items.length} stocks from prefetch cache (${Math.round(age/1000)}s old)`);
            saveCacheToDisk({ fetchedAt: preData.fetchedAt ?? now, snapshot: preData.snapshot, source: "live" });
            return { snapshot: preData.snapshot, source: "live", cached: true };
          }
        }
      }
    }

    // Node.js 原生并行抓取（替代 Python subprocess）
    const raw = await fetchFullSnapshot();
    const snapshot = buildRealSnapshot(raw);
    liveCache.snapshot = snapshot;
    liveCache.fetchedAt = now;
    liveCache.source = "live";
    saveCacheToDisk({ fetchedAt: now, snapshot, source: "live" });
    return { snapshot, source: "live", cached: false };
  } catch (error) {
    const diskCache = loadCacheFromDisk();
    if (diskCache?.snapshot) {
      liveCache.snapshot = diskCache.snapshot;
      liveCache.fetchedAt = diskCache.fetchedAt ?? now;
      liveCache.source = diskCache.source ?? "live-cache";
      return {
        snapshot: diskCache.snapshot,
        source: diskCache.source ?? "live-cache",
        cached: true,
        warning: `live fetch failed: ${error.message}`,
      };
    }

    const snapshot = createSampleSnapshot();
    return {
      snapshot,
      source: "sample",
      cached: false,
      warning: `live fetch failed: ${error.message}`,
    };
  }
}

function buildFallbackBars(code) {
  return Array.from({ length: 80 }, (_, index) => {
    const close = 10 + index * 0.18 + Math.sin(index / 6) * 0.4;
    return {
      date: `2026-03-${String((index % 28) + 1).padStart(2, "0")}`,
      open: round(close - 0.12, 2),
      high: round(close + 0.28, 2),
      low: round(close - 0.32, 2),
      close: round(close, 2),
      volume: 120000 + index * 1600,
      code,
    };
  });
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function fetchTechnicalPayload(code, force = false) {
  const cacheKey = String(code);
  const now = Date.now();
  const cached = technicalCache.get(cacheKey);

  if (!force && cached && now - cached.fetchedAt < 15 * 60 * 1000) {
    return { ...cached, cached: true };
  }

  try {
    const { stdout } = await execFileAsync("python", [path.join(root, "scripts", "fetch_stock_history.py"), cacheKey, "250"], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });

    const raw = JSON.parse(stdout.trim());
    const snapshot = computeTechnicalSnapshot(raw.bars);
    const payload = {
      code: cacheKey,
      bars: raw.bars,
      snapshot,
      analysis: buildTechnicalNarrative(snapshot),
      fetchedAt: now,
      source: "live",
    };
    technicalCache.set(cacheKey, payload);
    return { ...payload, cached: false };
  } catch (error) {
    const bars = buildFallbackBars(cacheKey);
    const snapshot = computeTechnicalSnapshot(bars);
    return {
      code: cacheKey,
      bars,
      snapshot,
      analysis: buildTechnicalNarrative(snapshot),
      fetchedAt: now,
      source: "sample",
      cached: false,
      warning: `technical fetch failed: ${error.message}`,
    };
  }
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function stockSummary(s) {
  const mv = s.maoValuation ?? {};
  return {
    code: s.code,
    name: s.name,
    industry: s.industry,
    concepts: (s.concepts ?? []).slice(0, 3),
    price: s.price,
    pe: s.raw?.pe ?? null,
    pb: s.raw?.pb ?? null,
    marketCap: s.raw?.marketCap ?? null,
    scores: s.scores,
    valuationTier: mv.valuationTier ?? null,
    conclusion: s.conclusion,
    // 新增：估值详情
    buyZoneLow: mv.buyZoneLow ?? null,
    buyZoneHigh: mv.buyZoneHigh ?? null,
    optimisticValue: mv.optimisticValue ?? null,
    marginOfSafety: mv.marginOfSafety ?? null,
    businessBrief: generateBusinessBrief(s),
    consensusConfidence: s.consensus?.confidence ?? null,
  };
}

function buildDailySnapshotMarkdown({ focusStocks, rankedStocks, industries, snapshotMeta }) {
  const today = new Date().toISOString().slice(0, 10);
  const top50 = (rankedStocks ?? []).slice(0, 50);
  const focus = focusStocks ?? [];

  const stockRow = (s, i) =>
    `| ${i + 1} | ${s.code} | ${s.name} | ${s.industry ?? ""} | ${(s.concepts ?? []).slice(0, 3).join("、")} | ${s.scores?.total ?? ""} | ${s.scores?.core ?? ""} | ${s.maoValuation?.valuationTier ?? ""} | ${s.conclusion ?? ""} |`;

  return `---
date: ${today}
mode: ${snapshotMeta?.mode ?? "sample"}
generated: ${snapshotMeta?.generatedAt ?? ""}
total_eligible: ${rankedStocks?.length ?? 0}
focus_count: ${focus.length}
tags:
  - 财经/快照
  - Scope导入
---

# Scope 市场快照 ${today}

> [!info] 快照信息
> - **日期**：${today}
> - **模式**：${snapshotMeta?.mode ?? "未知"}
> - **可评分股票**：${rankedStocks?.length ?? 0} 只
> - **重点关注**：${focus.length} 只

## 重点关注

| # | 代码 | 名称 | 行业 | 概念 | 总分 | 核心分 | 估值 | 结论 |
|---|------|------|------|------|------|--------|------|------|
${focus.map((s, i) => stockRow(s, i)).join("\n")}

## 行业概览

| 行业 | 股票数 | 平均总分 | 平均核心分 | 景气度 |
|------|--------|----------|------------|--------|
${(industries ?? []).slice(0, 12).map((ind) =>
    `| ${ind.industry} | ${ind.count} | ${ind.averageTotal} | ${ind.averageCore} | ${ind.prosperityLabel ?? ""} |`
  ).join("\n")}

## Top 50 总榜

| # | 代码 | 名称 | 行业 | 概念 | 总分 | 核心分 | 估值 | 结论 |
|---|------|------|------|------|------|--------|------|------|
${top50.map((s, i) => stockRow(s, i)).join("\n")}

---
*由 Scope 自动生成，${today}*
`;
}

function writeExportFile(vaultPath, fileName, content) {
  const dir = path.resolve(vaultPath);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${fileName}.md`);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

const server = http.createServer((request, response) => {
  const parsedRequest = new URL(request.url ?? "/", "http://127.0.0.1");

  if (parsedRequest.pathname === "/api/dashboard") {
    const force = parsedRequest.searchParams.get("force") === "1";
    fetchLiveSnapshot(force)
      .then(({ snapshot, source, cached, warning }) => {
        // 评分 + 排名
        const model = buildDashboardModel(snapshot, createDefaultSettings());
        const scoredItems = model.rankedAll.map(s => stockSummary(s));
        sendJson(response, 200, {
          source,
          cached,
          warning: warning ?? null,
          snapshot: {
            ...snapshot,
            items: scoredItems,
          },
          industries: model.industries,
          focus: model.focus.map(s => stockSummary(s)),
          top50: (model.top50 ?? []).map(s => stockSummary(s)),
        });
      })
      .catch((error) => {
        sendJson(response, 500, {
          error: error.message,
        });
      });
    return;
  }

  if (parsedRequest.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      hasLiveCache: Boolean(liveCache.snapshot),
      fetchedAt: liveCache.fetchedAt || null,
      source: liveCache.source,
    });
    return;
  }

  if (parsedRequest.pathname === "/api/technicals") {
    const code = parsedRequest.searchParams.get("code");
    const force = parsedRequest.searchParams.get("force") === "1";

    if (!code) {
      sendJson(response, 400, { error: "code is required" });
      return;
    }

    fetchTechnicalPayload(code, force)
      .then((payload) => sendJson(response, 200, payload))
      .catch((error) => sendJson(response, 500, { error: error.message }));
    return;
  }

  if (parsedRequest.pathname === "/api/ensure-fresh" && request.method === "POST") {
    const maxAge = Number(parsedRequest.searchParams.get("maxAge") || 3600000);
    const now = Date.now();
    const age = now - liveCache.fetchedAt;
    const isFresh = liveCache.snapshot && age < maxAge;

    if (!isFresh) {
      fetchLiveSnapshot(true)
        .then(({ snapshot, source }) => {
          sendJson(response, 200, {
            refreshed: true,
            source,
            age: 0,
            stocks: snapshot?.items?.length ?? 0,
            technicalCacheSize: technicalCache.size,
          });
        })
        .catch((error) => {
          sendJson(response, 200, {
            refreshed: false,
            error: error.message,
            age,
            usingCache: Boolean(liveCache.snapshot),
          });
        });
    } else {
      sendJson(response, 200, {
        refreshed: false,
        alreadyFresh: true,
        age,
        source: liveCache.source,
        stocks: liveCache.snapshot?.items?.length ?? 0,
        technicalCacheSize: technicalCache.size,
      });
    }
    return;
  }

  if (parsedRequest.pathname === "/api/prefetch" && request.method === "POST") {
    parseJsonBody(request)
      .then(async (body) => {
        const codes = body.codes ?? [];
        const mode = body.mode ?? "top100";

        // 先拉取快照
        try {
          await fetchLiveSnapshot(true);
        } catch (e) {
          // continue with cached data
        }

        // 确定要预取技术指标的股票列表
        let targetCodes = codes;
        if (targetCodes.length === 0) {
          const items = liveCache.snapshot?.items ?? [];
          if (mode === "all") {
            targetCodes = items.map((s) => s.code);
          } else {
            targetCodes = items.slice(0, 100).map((s) => s.code);
          }
        }

        // 异步拉取技术指标
        let fetched = 0;
        try {
          const { stdout } = await execFileAsync("python", [
            path.join(root, "scripts", "prefetch.py"),
            "--tech-codes", targetCodes.join(","),
          ], { cwd: root, maxBuffer: 50 * 1024 * 1024, timeout: 600000 });
          // 重新加载磁盘缓存
          loadTechnicalsCacheFromDisk();
          fetched = technicalCache.size;
        } catch (error) {
          sendJson(response, 500, { error: `Prefetch failed: ${error.message}` });
          return;
        }

        sendJson(response, 200, {
          ok: true,
          snapshotSource: liveCache.source,
          technicalCached: fetched,
          totalStocks: liveCache.snapshot?.items?.length ?? 0,
        });
      })
      .catch((error) => sendJson(response, 400, { error: error.message }));
    return;
  }

  if (parsedRequest.pathname === "/api/concepts") {
    sendJson(response, 200, { concepts: getConceptList() });
    return;
  }

  if (parsedRequest.pathname === "/api/etf") {
    const typeFilter = parsedRequest.searchParams.get("type") || "全部";
    const etfs = typeFilter === "全部" ? getEtfList() : getEtfList().filter((e) => e.type === typeFilter);
    sendJson(response, 200, { etfs, types: getEtfTypes(), total: getEtfList().length });
    return;
  }

  if (parsedRequest.pathname === "/api/stock-data") {
    const code = parsedRequest.searchParams.get("code");
    if (!code) {
      sendJson(response, 400, { error: "code is required" });
      return;
    }

    // 从缓存中查找股票数据
    const snapshot = liveCache.snapshot?.items ?? [];
    const rawStock = snapshot.find((s) => s.code === code);
    if (!rawStock) {
      sendJson(response, 404, { error: `stock ${code} not found in snapshot` });
      return;
    }

    // 评分（纯本地计算，不调外部API）
    const scored = computeStockScores(rawStock);

    // 技术指标（从缓存取，已有则直接用）
    const technicalKey = String(code);
    const cachedTech = technicalCache.get(technicalKey);
    const technicals = cachedTech
      ? { snapshot: cachedTech.snapshot, analysis: cachedTech.analysis, source: cachedTech.source }
      : null;

    // K线原始数据（最近250个交易日 ≈ 1年）
    const bars = cachedTech?.bars ?? null;

    // 组装完整响应
    sendJson(response, 200, {
      code: scored.code,
      name: scored.name,
      market: scored.market,
      industry: scored.industry,
      concepts: scored.concepts ?? [],
      price: scored.price,
      lotCost: scored.lotCost,
      // 基本面指标
      metrics: {
        pe: scored.raw?.pe ?? null,
        pb: scored.raw?.pb ?? null,
        changePct: scored.raw?.changePct ?? null,
        turnover: scored.raw?.turnover ?? null,
        marketCap: scored.raw?.marketCap ?? null,
        flowMarketCap: scored.raw?.flowMarketCap ?? null,
        dividendYield: scored.dividendYield ?? null,
        roeProxy: scored.financials?.roeProxy ?? null,
        freeCashFlowYieldProxy: scored.financials?.freeCashFlowYieldProxy ?? null,
        listingYears: scored.listingYears ?? null,
        liquidityScore: scored.liquidityScore ?? null,
      },
      // 评分
      scores: scored.scores,
      // 估值
      valuation: scored.maoValuation ?? null,
      // 共识
      consensus: scored.consensus ?? null,
      // 风险
      riskFlags: scored.riskFlags ?? [],
      stopDoingBlocked: scored.stopDoingBlocked ?? false,
      stopDoingReasons: scored.stopDoingReasons ?? [],
      // 结论
      conclusion: scored.conclusion ?? null,
      // 技术指标
      technicals,
      // K线原始数据（最近1年，约250个交易日）
      bars,
      // 元数据
      _meta: {
        snapshotSource: liveCache.source,
        snapshotFetchedAt: liveCache.fetchedAt,
        technicalCached: Boolean(cachedTech),
      },
    });
    return;
  }

  if (parsedRequest.pathname === "/api/market-summary") {
    try {
      const snapshot = liveCache.snapshot ?? createSampleSnapshot();
      const model = buildDashboardModel(snapshot, createDefaultSettings());
      sendJson(response, 200, {
        mode: snapshot.mode,
        generatedAt: snapshot.generatedAt,
        eligibleCount: model.eligibleCount,
        excludedCount: model.excludedCount,
        focus: model.focus.map((s) => stockSummary(s)),
        top50: (model.top50 ?? []).map((s) => stockSummary(s)),
        industries: model.industries ?? [],
        availableConcepts: model.availableConcepts ?? [],
        _meta: { source: liveCache.source, fetchedAt: liveCache.fetchedAt },
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (parsedRequest.pathname === "/api/export/daily-snapshot" && request.method === "POST") {
    parseJsonBody(request)
      .then((body) => {
        const { vaultPath, focusStocks, rankedStocks, industries, snapshotMeta } = body;
        if (!vaultPath) {
          sendJson(response, 400, { error: "vaultPath is required" });
          return;
        }

        const markdown = buildDailySnapshotMarkdown({ focusStocks, rankedStocks, industries, snapshotMeta });
        const today = new Date().toISOString().slice(0, 10);
        const filePath = writeExportFile(vaultPath, `市场快照-${today}`, markdown);
        sendJson(response, 200, { ok: true, filePath });
      })
      .catch((error) => sendJson(response, 400, { error: error.message }));
    return;
  }

  if (parsedRequest.pathname === "/api/export/stock-profile" && request.method === "POST") {
    parseJsonBody(request)
      .then((body) => {
        const { stock, technicals, vaultPath, wikiStockPath } = body;
        if (!stock) {
          sendJson(response, 400, { error: "stock data is required" });
          return;
        }

        const payload = buildExportPayload(stock, technicals ?? null, { wikiStockPath });
        const markdown = payload.masterProfile;

        if (vaultPath) {
          const filePath = writeExportFile(vaultPath, `标的主档案-${payload.safeFileName}`, markdown);
          sendJson(response, 200, { ok: true, filePath, fileName: payload.fileName });
        } else {
          sendJson(response, 200, { ok: true, markdown, fileName: payload.fileName });
        }
      })
      .catch((error) => sendJson(response, 400, { error: error.message }));
    return;
  }

  if (parsedRequest.pathname === "/api/export/daily-review" && request.method === "POST") {
    parseJsonBody(request)
      .then((body) => {
        const { stock, technicals, vaultPath, wikiStockPath } = body;
        if (!stock) {
          sendJson(response, 400, { error: "stock data is required" });
          return;
        }

        const payload = buildExportPayload(stock, technicals ?? null, { wikiStockPath });
        const markdown = payload.dailyReview;

        if (vaultPath) {
          const filePath = writeExportFile(vaultPath, `每日复盘-${payload.safeFileName}-${new Date().toISOString().slice(0, 10)}`, markdown);
          sendJson(response, 200, { ok: true, filePath, fileName: payload.fileName });
        } else {
          sendJson(response, 200, { ok: true, markdown, fileName: payload.fileName });
        }
      })
      .catch((error) => sendJson(response, 400, { error: error.message }));
    return;
  }

  // ── 涨停预测分析 ──

  if (parsedRequest.pathname === "/api/limitup-history") {
    const history = loadLimitupHistory();
    if (!history) {
      sendJson(response, 200, { ok: false, message: "涨停历史数据未采集。请运行: python scripts/fetch_limitup_history.py" });
      return;
    }
    sendJson(response, 200, { ok: true, summary: getLimitupSummary(history) });
    return;
  }

  if (parsedRequest.pathname === "/api/limitup-predict") {
    const maxPrice = Number(parsedRequest.searchParams.get("maxPrice") || 70);
    const minScore = Number(parsedRequest.searchParams.get("minScore") || 45);
    const limit = Number(parsedRequest.searchParams.get("limit") || 30);
    const priorityOnly = parsedRequest.searchParams.get("priorityOnly") === "1";

    const history = loadLimitupHistory();
    const snapshot = liveCache.snapshot?.items ?? [];

    if (!snapshot.length) {
      sendJson(response, 200, { ok: false, message: "市场快照为空，请先刷新数据" });
      return;
    }

    const predictions = batchPredict(snapshot, technicalCache, history, {
      maxPrice,
      minScore,
      limit,
      priorityOnly,
      excludeStar: true,
    });

    sendJson(response, 200, {
      ok: true,
      count: predictions.length,
      filters: { maxPrice, minScore, limit, priorityOnly },
      hasHistory: Boolean(history),
      predictions,
    });
    return;
  }

  if (parsedRequest.pathname === "/api/limitup-predict-stock") {
    const code = parsedRequest.searchParams.get("code");
    if (!code) {
      sendJson(response, 400, { error: "code is required" });
      return;
    }

    const snapshot = liveCache.snapshot?.items ?? [];
    const stock = snapshot.find(s => s.code === code);
    if (!stock) {
      sendJson(response, 404, { error: `stock ${code} not found` });
      return;
    }

    const history = loadLimitupHistory();
    const tech = technicalCache.get(code);
    const scored = computeStockScores(stock);
    const prediction = predictLimitup(scored, tech?.snapshot ?? null, tech?.bars ?? null, history);

    sendJson(response, 200, { ok: true, prediction });
    return;
  }

  // ── 一键每日预测：拉快照 + 加载历史 + 预测 + 返回结果 ──
  if (parsedRequest.pathname === "/api/daily-predict") {
    const maxPrice = Number(parsedRequest.searchParams.get("maxPrice") || 70);
    const minScore = Number(parsedRequest.searchParams.get("minScore") || 35);
    const limit = Number(parsedRequest.searchParams.get("limit") || 30);
    const priorityOnly = parsedRequest.searchParams.get("priorityOnly") === "1";
    const force = parsedRequest.searchParams.get("force") === "1";

    (async () => {
      try {
        // Step 1: 确保快照新鲜
        const { snapshot, source, cached } = await fetchLiveSnapshot(force);
        const items = snapshot?.items ?? [];

        // Step 2: 加载涨停历史
        const history = loadLimitupHistory();

        // Step 3: 运行预测
        const predictions = batchPredict(items, technicalCache, history, {
          maxPrice, minScore, limit, priorityOnly, excludeStar: true,
        });

        // Step 4: 对每只股票补充 Scope 评分（生意模式/估值/安全边际）
        const stocks = predictions.filter(p => p.type === "stock");
        const etfs = predictions.filter(p => p.type === "etf" || p.type === "lof");

        const enrichedStocks = stocks.map(s => {
          const rawStock = items.find(i => i.code === s.code);
          let scopeData = null;
          if (rawStock) {
            try {
              const scored = computeStockScores(rawStock);
              const mv = scored.maoValuation || {};
              const core = scored.scores?.core ?? 0;
              const total = scored.scores?.total ?? 0;
              const margin = mv.marginOfSafety ?? null;
              const tier = mv.valuationTier ?? null;
              const intrinsic = mv.intrinsicValue ?? null;
              const conservative = mv.conservativeValue ?? null;
              const buyZone = mv.buyZone ?? null;

              // 理想买入价 = 保守估值 × 0.85 (15%安全边际)
              const idealBuy = conservative ? round(conservative * 0.85) : null;
              // 止损价 = 当前价 × 0.92 (8%止损)
              const stopLoss = round(s.price * 0.92);
              // 目标价 = 保守估值 × 1.1
              const targetPrice = conservative ? round(conservative * 1.1) : null;

              scopeData = {
                coreScore: core,
                totalScore: total,
                businessModel: scored.metrics?.businessModelQuality ?? scored.metrics?.businessQuality ?? null,
                management: scored.metrics?.managementQuality ?? null,
                valuation: scored.metrics?.valuation ?? null,
                conclusion: scored.conclusion ?? null,
                valuationTier: tier,
                safetyMargin: margin !== null && margin !== undefined ? round(margin) : null,
                intrinsicValue: intrinsic,
                conservativeValue: conservative,
                buyZone,
                stopDoingBlocked: scored.stopDoingBlocked ?? false,
                riskFlags: scored.riskFlags ?? [],
                // 交易建议
                idealBuyPrice: idealBuy,
                stopLossPrice: stopLoss,
                targetPrice,
                priceVsIdeal: idealBuy ? round((s.price - idealBuy) / idealBuy * 100) : null,
              };
            } catch { /* ignore */ }
          }

          // 综合判断：大涨潜力 + 基本面
          let verdict;
          if (scopeData?.stopDoingBlocked) {
            verdict = "不为清单拦截 - 不买";
          } else if (s.totalScore >= 50 && scopeData?.coreScore >= 78 && scopeData?.safetyMargin >= 10) {
            verdict = "强烈关注 - 基本面优+大涨概率高+有安全边际";
          } else if (s.totalScore >= 45 && scopeData?.coreScore >= 65 && scopeData?.safetyMargin >= 5) {
            verdict = "纳入观察 - 基本面尚可+有大涨信号+有安全边际";
          } else if (s.totalScore >= 40 && scopeData?.coreScore >= 65) {
            verdict = "纳入观察 - 基本面尚可+有大涨信号";
          } else if (s.totalScore >= 40 && scopeData?.valuationTier === "低估") {
            verdict = "价值底仓 - 估值低+有大涨信号";
          } else if (s.totalScore >= 40 && scopeData?.valuationTier === "合理偏低") {
            verdict = "谨慎观望 - 估值合理偏低+有大涨信号";
          } else if (s.totalScore >= 40) {
            verdict = "谨慎观望 - 大涨信号有但基本面待验证";
          } else {
            verdict = "暂不推荐";
          }

          return {
            code: s.code,
            name: s.name,
            price: s.price,
            totalScore: s.totalScore,
            probability: s.probability,
            action: s.action,
            dimensions: s.dimensions,
            signals: s.signals,
            limitupCount: s.limitupCount,
            // 基本面数据
            scope: scopeData,
            // 综合判断
            verdict,
          };
        });

        sendJson(response, 200, {
          ok: true,
          date: new Date().toISOString().slice(0, 10),
          snapshotSource: source,
          snapshotCached: cached,
          snapshotCount: items.length,
          hasHistory: Boolean(history),
          historyDate: history?.generated_at?.slice(0, 10) ?? null,
          filters: { maxPrice, minScore, limit, priorityOnly },
          summary: {
            totalPredictions: enrichedStocks.length + etfs.length,
            stockCount: enrichedStocks.length,
            etfCount: etfs.length,
            strongBuy: enrichedStocks.filter(s => s.verdict?.startsWith("强烈")).length,
            watch: enrichedStocks.filter(s => s.verdict?.startsWith("纳入")).length,
            valueBase: enrichedStocks.filter(s => s.verdict?.startsWith("价值")).length,
          },
          stocks: enrichedStocks,
          etfs: etfs.map(e => ({
            code: e.code,
            name: e.name,
            price: e.price,
            totalScore: e.totalScore,
            probability: e.probability,
            action: e.action,
            dimensions: e.dimensions,
            signals: e.signals,
            limitupCount: e.limitupCount,
            verdict: "ETF/LOF - 无基本面分析",
          })),
        });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error.message });
      }
    })();
    return;
  }

  if (parsedRequest.pathname === "/api/limitup-collect" && request.method === "POST") {
    const daysBack = Number(parsedRequest.searchParams.get("days") || 250);
    const workers = Number(parsedRequest.searchParams.get("workers") || 8);

    sendJson(response, 200, {
      ok: true,
      message: "涨停数据采集已启动（后台运行），完成后结果自动写入 .cache/limitup-history.json",
      command: `python scripts/fetch_limitup_history.py --days ${daysBack} --workers ${workers}`,
    });

    // 后台运行采集脚本
    execFile("python", [
      path.join(root, "scripts", "fetch_limitup_history.py"),
      "--days", String(daysBack),
      "--workers", String(workers),
    ], { cwd: root, maxBuffer: 100 * 1024 * 1024, timeout: 3600000 }, (err, stdout, stderr) => {
      if (err) {
        console.error("Limitup collection error:", err.message);
      } else {
        console.log("Limitup collection completed");
      }
    });
    return;
  }

  const filePath = safePathname(request.url ?? "/");

  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  if (filePath === path.join(root, "favicon.ico")) {
    response.writeHead(204);
    response.end();
    return;
  }

  if (filePath === publicDir && fs.existsSync(path.join(publicDir, "start.html"))) {
    serveFile(path.join(publicDir, "start.html"), response);
    return;
  }

  serveFile(filePath, response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Scope MVP running at http://127.0.0.1:${port}`);
});
