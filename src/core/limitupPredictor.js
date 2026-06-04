/**
 * 涨停预测评分引擎
 *
 * 基于一年历史涨停数据 + 技术指标 + 基本面安全边际，
 * 预测未来10个交易日内涨停/大幅拉升概率。
 *
 * 评分因子（五维）：
 * 1. 技术形态分 (30%) — MACD/BOLL/KDJ/均线/量价
 * 2. 涨停基因分 (25%) — 历史涨停频率/连板能力/近期涨停密度
 * 3. 量价动量分 (20%) — 量比/换手率/突破信号
 * 4. 行业热度分 (15%) — 概念板块轮动/板块涨停密度
 * 5. 安全边际分 (10%) — 估值/核心分/风险标记
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const limitupCachePath = path.join(root, ".cache", "limitup-history.json");

// ── 优先行业关键词 ──
const PRIORITY_INDUSTRIES = [
  "半导体", "芯片", "存储", "光学", "光电子", "显示", "面板",
  "通信设备", "光通信", "CPO", "AI", "人工智能", "算力", "数据",
  "机器人", "具身智能", "智能驾驶", "物理AI",
  "新能源", "电池", "储能", "光伏", "风电", "电力",
  "电子", "消费电子", "传感器", "封测",
];

// 排除行业（用户看不懂）
const EXCLUDE_INDUSTRIES = ["煤炭", "石油", "天然气", "传统能源"];

// 排除科创板
const EXCLUDE_PREFIXES = ["688"];

// ── 工具函数 ──

function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function safeDiv(a, b, fallback = 0) {
  return b > 0 ? a / b : fallback;
}

// ── 1. 技术形态评分 (30%) ──

function scoreTechnicals(technicals, bars) {
  if (!technicals || !bars || bars.length < 35) return { score: 0, signals: [] };

  let score = 50; // 基线
  const signals = [];

  // MACD 金叉/向上
  if (technicals.macd) {
    if (technicals.macd.crossedUp) { score += 15; signals.push("MACD金叉"); }
    else if (technicals.macd.diff > technicals.macd.dea) { score += 8; signals.push("MACD多头"); }
    if (technicals.macd.histogram > 0) { score += 5; }
    if (technicals.macd.crossedDown) { score -= 10; signals.push("MACD死叉"); }
  }

  // BOLL 布林带
  if (technicals.boll) {
    if (technicals.boll.position === "upper-break") { score += 10; signals.push("突破布林上轨"); }
    else if (technicals.boll.position === "upper-half") { score += 5; }
    else if (technicals.boll.position === "lower-break") { score -= 10; signals.push("触及布林下轨"); }
    // 布林收窄 = 酝酿突破
    if (technicals.boll.width < 8) { score += 8; signals.push("布林收窄蓄势"); }
  }

  // KDJ
  if (technicals.kdj) {
    if (technicals.kdj.k > technicals.kdj.d && technicals.kdj.j > 50) { score += 8; }
    if (technicals.kdj.j < 20) { score += 5; signals.push("KDJ超卖"); }
    if (technicals.kdj.j > 90) { score -= 5; signals.push("KDJ超买"); }
  }

  // 均线多头排列
  if (technicals.movingAverages) {
    const { ma5, ma10, ma20, ma60 } = technicals.movingAverages;
    if (ma5 > ma10 && ma10 > ma20 && ma20 > ma60) {
      score += 12; signals.push("均线多头排列");
    } else if (ma5 < ma10 && ma10 < ma20) {
      score -= 8;
    }
    // 站上MA60
    if (technicals.close > ma60) score += 5;
  }

  // 量能
  if (technicals.volume) {
    if (technicals.volume.trend === "expanding") { score += 8; signals.push("放量"); }
    else if (technicals.volume.trend === "shrinking") { score -= 3; }
    // 极端放量可能见顶
    if (technicals.volume.ratio > 4) { score -= 5; signals.push("天量风险"); }
  }

  // 60周线
  if (technicals.weekly60) {
    if (technicals.weekly60.position === "above" && technicals.weekly60.slope === "up") {
      score += 8; signals.push("周线趋势向上");
    }
  }

  // 趋势
  if (technicals.trend?.bias === "bullish") score += 5;
  else if (technicals.trend?.bias === "bearish") score -= 8;

  return { score: clamp(round(score), 0, 100), signals };
}

// ── 2. 涨停基因评分 (25%) ──

function scoreLimitupGene(code, limitupData) {
  let score = 0;
  const signals = [];

  if (!limitupData) return { score: 0, signals: ["无历史数据"] };

  const events = limitupData.events || [];
  const count = limitupData.count || 0;

  // 区分涨停和8%+大涨
  const limitUpEvents = events.filter(e => e.is_limit_up);
  const surgeOnlyEvents = events.filter(e => !e.is_limit_up);
  const limitUpCount = limitUpEvents.length;

  // 大幅拉升频率 (0-30分) — 包含8%+和涨停
  if (count >= 15) { score += 30; signals.push(`年内${count}次大涨/${limitUpCount}涨停(高频)`); }
  else if (count >= 8) { score += 25; signals.push(`年内${count}次大涨/${limitUpCount}涨停`); }
  else if (count >= 4) { score += 18; signals.push(`年内${count}次大涨/${limitUpCount}涨停`); }
  else if (count >= 1) { score += 10; signals.push(`年内${count}次大涨`); }

  // 涨停占比加分 — 涨停越多说明越强
  if (limitUpCount >= 5) { score += 8; signals.push(`${limitUpCount}次涨停(强基因)`); }
  else if (limitUpCount >= 2) { score += 4; }

  // 近期大涨密度（近30天）
  const now = new Date();
  const recent30 = events.filter(e => {
    const d = new Date(e.date);
    return (now - d) < 30 * 86400000;
  });
  if (recent30.length >= 5) { score += 18; signals.push("近30天多次大涨"); }
  else if (recent30.length >= 2) { score += 10; signals.push("近期有大涨"); }
  else if (recent30.length >= 1) { score += 5; }

  // 近期大涨后是否强势
  if (events.length > 0) {
    const latest = events[events.length - 1];
    const daysSince = Math.floor((now - new Date(latest.date)) / 86400000);
    if (daysSince <= 10) { score += 15; signals.push("10天内大涨过"); }
    else if (daysSince <= 20) { score += 8; }
  }

  // 量比特征：涨停前量比越大越活跃
  const avgVr = events.reduce((sum, e) => sum + (e.volume_ratio || 0), 0) / Math.max(events.length, 1);
  if (avgVr > 3) { score += 10; signals.push("涨停基因活跃"); }
  else if (avgVr > 2) { score += 5; }

  return { score: clamp(round(score), 0, 100), signals };
}

// ── 3. 量价动量评分 (20%) ──

function scoreMomentum(stock, bars) {
  let score = 50;
  const signals = [];

  if (!bars || bars.length < 5) return { score: 50, signals: [] };

  const closes = bars.map(b => b.close);
  const volumes = bars.map(b => b.volume);

  // 近5日涨跌幅
  const pct5d = (closes.at(-1) - closes.at(-6)) / Math.max(closes.at(-6), 0.01) * 100;
  if (pct5d > 5 && pct5d < 15) { score += 12; signals.push("5日温和上涨"); }
  else if (pct5d >= 15 && pct5d < 25) { score += 5; signals.push("5日快速上涨(注意追高)"); }
  else if (pct5d >= 25) { score -= 10; signals.push("5日暴涨(回调风险)"); }
  else if (pct5d < -10) { score -= 5; }

  // 近20日涨跌幅
  const pct20d = (closes.at(-1) - closes.at(-21)) / Math.max(closes.at(-21), 0.01) * 100;
  if (pct20d > 10 && pct20d < 30) { score += 8; signals.push("20日趋势向上"); }

  // 量价配合：上涨放量
  const recent5Vol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const prev5Vol = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
  const volRatio = safeDiv(recent5Vol, prev5Vol, 1);
  if (pct5d > 0 && volRatio > 1.3) { score += 10; signals.push("上涨放量"); }
  if (pct5d < 0 && volRatio < 0.8) { score += 5; signals.push("缩量回调(良性)"); }

  // 换手率突变（如果 stock 有换手率数据）
  if (stock?.raw?.turnover) {
    const turnover = Number(stock.raw.turnover);
    if (turnover > 8) { score += 8; signals.push("换手率活跃"); }
    if (turnover > 20) { score -= 5; signals.push("换手率过高"); }
  }

  // 大单流入（代理：成交量持续放大 + 价格上涨）
  const last3Up = closes.slice(-4).every((c, i, arr) => i === 0 || c >= arr[i - 1]);
  const last3VolUp = volumes.slice(-4).every((v, i, arr) => i === 0 || v >= arr[i - 1] * 0.9);
  if (last3Up && last3VolUp) { score += 10; signals.push("连续放量上涨(资金流入)"); }

  return { score: clamp(round(score), 0, 100), signals };
}

// ── 4. 行业热度评分 (15%) ──

function scoreIndustryHeat(stock, limitupHistory) {
  let score = 50;
  const signals = [];

  const industry = stock.industry || "";
  const concepts = stock.concepts || [];

  // 优先行业加分
  const isPriority = PRIORITY_INDUSTRIES.some(kw =>
    industry.includes(kw) || concepts.some(c => c.includes(kw))
  );
  if (isPriority) { score += 20; signals.push("优先行业"); }

  // 排除行业减分
  const isExcluded = EXCLUDE_INDUSTRIES.some(kw => industry.includes(kw));
  if (isExcluded) { score -= 30; signals.push("排除行业"); }

  // 概念热度（从 Scope 评分体系）
  if (stock.conceptHeat > 70) { score += 10; signals.push("概念热门"); }
  if (stock.conceptHeat > 90) { score -= 5; signals.push("概念过热"); }

  // 板块涨停密度（同行业近期涨停多 = 板块轮动信号）
  if (limitupHistory?.daily_limitups) {
    const recentDates = Object.keys(limitupHistory.daily_limitups).sort().slice(-10);
    let sameIndustryCount = 0;
    for (const date of recentDates) {
      const stocks = limitupHistory.daily_limitups[date] || [];
      // 简单匹配行业名称
      sameIndustryCount += stocks.filter(s =>
        (s.name && stock.name && s.name !== stock.name) // 不计自己
      ).length;
    }
    if (sameIndustryCount > 20) { score += 10; signals.push("板块涨停活跃"); }
  }

  return { score: clamp(round(score), 0, 100), signals };
}

// ── 5. 安全边际评分 (10%) ──

function scoreSafety(stock) {
  let score = 50;
  const signals = [];

  if (!stock) return { score: 0, signals: ["无数据"] };

  // 估值
  if (stock.maoValuation) {
    const tier = stock.maoValuation.valuationTier;
    if (tier === "低估") { score += 25; signals.push("估值低估"); }
    else if (tier === "合理偏低") { score += 15; signals.push("估值合理偏低"); }
    else if (tier === "合理") { score += 5; }
    else if (tier === "偏高估") { score -= 10; signals.push("估值偏高"); }
    else if (tier === "明显高估") { score -= 25; signals.push("估值过高"); }

    // 安全边际
    const margin = stock.maoValuation.marginOfSafety;
    if (margin >= 0.10 && margin <= 0.20) { score += 15; signals.push(`安全边际${round(margin * 100)}%`); }
    else if (margin > 0.20 && margin <= 0.30) { score += 10; signals.push(`安全边际${round(margin * 100)}%`); }
    else if (margin > 0.30) { score += 5; }
  }

  // 核心分
  if (stock.scores?.core >= 78) { score += 10; signals.push("核心分优秀"); }
  else if (stock.scores?.core >= 65) { score += 5; }
  else if (stock.scores?.core < 55) { score -= 10; }

  // 风险标记
  const riskCount = stock.riskFlags?.length || 0;
  if (riskCount === 0) { score += 5; }
  else if (riskCount >= 3) { score -= 15; signals.push(`${riskCount}项风险标记`); }

  // 不为清单
  if (stock.stopDoingBlocked) { score = 0; signals.push("不为清单拦截"); }

  // 价格限制
  if (stock.price > 70) { score -= 20; signals.push("股价超70元"); }
  else if (stock.price <= 30) { score += 5; }

  return { score: clamp(round(score), 0, 100), signals };
}

// ── 综合预测评分 ──

/**
 * 计算单只股票的涨停预测分
 * @param {Object} stock - Scope 内部模型股票对象
 * @param {Object} technicals - 技术指标快照
 * @param {Array} bars - K线数据
 * @param {Object} limitupHistory - 全市场涨停历史数据
 * @returns {Object} 预测结果
 */
export function predictLimitup(stock, technicals, bars, limitupHistory) {
  const code = stock.code;

  // 硬性排除
  if (code.startsWith("688")) return null; // 科创板
  if (stock.stopDoingBlocked) return null;  // 不为清单

  // 获取该股涨停历史
  const stockLimitup = limitupHistory?.limitup_events?.[code] ||
    limitupHistory?.limitup_events?.[`sh.${code}`] ||
    limitupHistory?.limitup_events?.[`sz.${code}`];

  // 五维评分
  const techScore = scoreTechnicals(technicals, bars);
  const geneScore = scoreLimitupGene(code, stockLimitup);
  const momentumScore = scoreMomentum(stock, bars);
  const industryScore = scoreIndustryHeat(stock, limitupHistory);
  const safetyScore = scoreSafety(stock);

  // 加权总分
  const totalScore = round(
    techScore.score * 0.30 +
    geneScore.score * 0.25 +
    momentumScore.score * 0.20 +
    industryScore.score * 0.15 +
    safetyScore.score * 0.10
  );

  // 合并所有信号
  const allSignals = [
    ...techScore.signals,
    ...geneScore.signals,
    ...momentumScore.signals,
    ...industryScore.signals,
    ...safetyScore.signals,
  ];

  // 涨停概率等级
  let probability;
  if (totalScore >= 80) probability = "极高";
  else if (totalScore >= 65) probability = "高";
  else if (totalScore >= 50) probability = "中等";
  else if (totalScore >= 35) probability = "低";
  else probability = "极低";

  // 建议动作
  let action;
  if (totalScore >= 75 && safetyScore.score >= 60) action = "积极关注";
  else if (totalScore >= 60 && safetyScore.score >= 40) action = "纳入观察";
  else if (totalScore < 40) action = "暂不考虑";
  else action = "谨慎观望";

  return {
    code: stock.code,
    name: stock.name,
    type: stock.type || "stock",
    industry: stock.industry,
    concepts: (stock.concepts || []).slice(0, 3),
    price: stock.price,
    // 五维子分
    dimensions: {
      technicals: techScore.score,
      limitupGene: geneScore.score,
      momentum: momentumScore.score,
      industryHeat: industryScore.score,
      safety: safetyScore.score,
    },
    // 总分与预测
    totalScore,
    probability,
    action,
    // 信号
    signals: allSignals,
    // 安全边际
    safetyMargin: stock.maoValuation?.marginOfSafety ?? null,
    valuationTier: stock.maoValuation?.valuationTier ?? null,
    // 涨停历史摘要
    limitupCount: stockLimitup?.count || 0,
    recentLimitup: stockLimitup?.events?.slice(-3) || [],
  };
}

/**
 * 批量预测：对全市场股票评分并排序
 * @param {Array} snapshot - Scope 快照中的股票数组
 * @param {Map} technicalCache - 技术指标缓存
 * @param {Object} limitupHistory - 涨停历史数据
 * @param {Object} filters - 过滤条件
 * @returns {Array} 排序后的预测结果
 */
export function batchPredict(snapshot, technicalCache, limitupHistory, filters = {}) {
  const {
    maxPrice = 70,
    excludeStar = true,
    priorityOnly = false,
    minScore = 45,
    limit = 30,
  } = filters;

  const results = [];

  for (const stock of snapshot) {
    // 过滤
    if (excludeStar && stock.code?.startsWith("688")) continue;
    if (stock.price > maxPrice) continue;
    if (stock.price <= 0) continue;
    if (stock.stopDoingBlocked) continue;

    // 优先行业过滤
    if (priorityOnly) {
      const industry = stock.industry || "";
      const concepts = stock.concepts || [];
      const isPriority = PRIORITY_INDUSTRIES.some(kw =>
        industry.includes(kw) || concepts.some(c => c.includes(kw))
      );
      if (!isPriority) continue;
    }

    // 获取技术指标
    const tech = technicalCache?.get?.(stock.code);
    const technicals = tech?.snapshot || null;
    const bars = tech?.bars || null;

    const prediction = predictLimitup(stock, technicals, bars, limitupHistory);
    if (prediction && prediction.totalScore >= minScore) {
      results.push(prediction);
    }
  }

  // ── ETF/LOF 补充：从涨停历史中提取不在快照中的 ETF/LOF ──
  if (limitupHistory?.limitup_events) {
    const snapshotCodes = new Set(snapshot.map(s => s.code));
    for (const [fullCode, data] of Object.entries(limitupHistory.limitup_events)) {
      const instType = data.type || "stock";
      if (instType !== "etf" && instType !== "lof") continue;
      const pureCode = data.code || fullCode.split(".").pop();
      if (snapshotCodes.has(pureCode)) continue; // 已在快照中处理

      // 构造一个最小 stock 对象
      const etfStock = {
        code: pureCode,
        name: data.name,
        type: instType,
        price: data.events?.at(-1)?.close || 0,
        industry: "",
        concepts: [],
        stopDoingBlocked: false,
        maoValuation: null,
        scores: {},
        riskFlags: [],
      };

      if (etfStock.price > maxPrice || etfStock.price <= 0) continue;

      const tech = technicalCache?.get?.(pureCode);
      const prediction = predictLimitup(etfStock, tech?.snapshot || null, tech?.bars || null, limitupHistory);
      if (prediction && prediction.totalScore >= minScore) {
        results.push(prediction);
      }
    }
  }

  // 按总分排序
  results.sort((a, b) => b.totalScore - a.totalScore);

  // 分离 ETF/LOF 和股票，确保 ETF/LOF 在结果中可见
  const stockResults = results.filter(r => r.type === "stock");
  const etfResults = results.filter(r => r.type === "etf" || r.type === "lof");

  // 股票取 limit 个，ETF/LOF 全部附加
  return [...stockResults.slice(0, limit), ...etfResults];
}

/**
 * 加载涨停历史缓存
 */
export function loadLimitupHistory() {
  try {
    if (fs.existsSync(limitupCachePath)) {
      const raw = fs.readFileSync(limitupCachePath, "utf8");
      return JSON.parse(raw);
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * 获取涨停统计摘要
 */
export function getLimitupSummary(limitupHistory) {
  if (!limitupHistory) return null;

  return {
    total_stocks_processed: limitupHistory.total_stocks_processed,
    total_limitup_stocks: limitupHistory.total_limitup_stocks,
    total_limitup_events: limitupHistory.total_limitup_events,
    type_stats: limitupHistory.type_stats || {},
    generated_at: limitupHistory.generated_at,
    top20_freq: (limitupHistory.freq_ranking_top100 || []).slice(0, 20).map(s => ({
      code: s.code, name: s.name, type: s.type || "stock", count: s.count,
    })),
    pre_limit_features: limitupHistory.pre_limit_features,
    recent_daily_counts: (limitupHistory.daily_counts || []).slice(-20),
  };
}
